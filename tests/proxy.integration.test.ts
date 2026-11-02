import { createHmac, randomUUID } from "node:crypto";
import type { Transporter } from "nodemailer";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { orderNode } from "./helpers";

const SHOP = "test-shop.myshopify.com";
const SECRET = "test-api-secret";

/* Shopify Admin API double: answers order lookups with whatever `shopOrders` holds. */
let shopOrders: ReturnType<typeof orderNode>[] = [];
let shopifyDown = false;
const realFetch = globalThis.fetch;
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith(`https://${SHOP}/admin/api/`)) {
    if (shopifyDown) return new Response("Service unavailable", { status: 503 });
    return Response.json({ data: { orders: { nodes: shopOrders } } });
  }
  return realFetch(input, init);
});

const sentMail: Array<{ to: string; subject: string; text: string }> = [];
let mailShouldFail = false;
const fakeTransport = {
  sendMail: vi.fn(async (msg: { to: string; subject: string; text: string }) => {
    if (mailShouldFail) throw new Error("SMTP connection refused");
    sentMail.push(msg);
    return {};
  }),
} as unknown as Transporter;

const { default: prisma } = await import("../app/db.server");
const { setTransporterForTesting } = await import("../app/lib/email.server");
const refundRoute = await import("../app/routes/proxy.refund");
const ticketRoute = await import("../app/routes/proxy.ticket");

function signedUrl(path: string, extra: Record<string, string> = {}) {
  const params: Record<string, string> = {
    shop: SHOP,
    path_prefix: "/apps/support",
    timestamp: String(Math.floor(Date.now() / 1000)),
    logged_in_customer_id: "",
    ...extra,
  };
  const message = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("");
  const signature = createHmac("sha256", SECRET).update(message).digest("hex");
  return `https://support-app.test/proxy/${path}?${new URLSearchParams({ ...params, signature })}`;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function refundForm(overrides: Record<string, string | File> = {}) {
  const form = new FormData();
  const base: Record<string, string | File> = {
    order_number: "#1001",
    email: "buyer@example.com",
    reason: "key_not_working",
    description: "My activation key shows 'invalid code' on Windows 11 in the app.",
    confirm_accurate: "on",
    website: "",
    started_at: String(Date.now() - 60_000),
    idempotency_key: randomUUID(),
    allow_unverified: "false",
  };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) form.set(k, v);
  return form;
}

async function postRefund(form: FormData, opts: { url?: string; ip?: string } = {}) {
  const request = new Request(opts.url ?? signedUrl("refund"), {
    method: "POST",
    body: form,
    headers: { "x-forwarded-for": opts.ip ?? `203.0.113.${Math.floor(Math.random() * 250)}` },
  });
  try {
    return (await refundRoute.action({ request, params: {}, context: {} } as never)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

async function waitForMail(count: number) {
  await vi.waitFor(() => expect(sentMail.length).toBeGreaterThanOrEqual(count), { timeout: 3000 });
}

beforeAll(async () => {
  await prisma.session.create({
    data: {
      id: `offline_${SHOP}`,
      shop: SHOP,
      state: "",
      isOnline: false,
      scope: "read_orders",
      accessToken: "shpat_test",
    },
  });
  setTransporterForTesting(fakeTransport);
});

beforeEach(async () => {
  await prisma.ticket.deleteMany();
  await prisma.rateLimitHit.deleteMany();
  await prisma.auditLog.deleteMany();
  sentMail.length = 0;
  mailShouldFail = false;
  shopifyDown = false;
  shopOrders = [orderNode({ name: "#1001", email: "buyer@example.com" })];
});

afterAll(async () => {
  setTransporterForTesting(undefined);
  await prisma.$disconnect();
});

describe("POST /apps/support/refund", () => {
  it("rejects requests without a valid Shopify proxy signature", async () => {
    const url = signedUrl("refund").replace(/signature=[a-f0-9]+/, "signature=" + "0".repeat(64));
    const res = await postRefund(refundForm(), { url });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(await prisma.ticket.count()).toBe(0);
  });

  it("creates a verified ticket, stores order details, and sends both emails", async () => {
    const res = await postRefund(refundForm({ screenshot: new File([PNG], "error.png", { type: "image/png" }) }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, duplicate: false });
    expect(body.ticketId).toMatch(/^RR-[2-9A-HJKMNP-Z]{8}$/);
    expect(JSON.stringify(body)).not.toContain("14.99");

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { publicId: body.ticketId },
      include: { attachments: true, messages: true },
    });
    expect(ticket).toMatchObject({
      shop: SHOP,
      type: "refund",
      status: "new",
      orderVerified: true,
      orderTotal: "14.99",
      orderCurrency: "USD",
      productName: "Lifetime VPN Activation Key",
    });
    expect(ticket.attachments).toHaveLength(1);
    expect(ticket.attachments[0]!.mimeType).toBe("image/png");

    await waitForMail(2);
    const customer = sentMail.find((m) => m.to === "buyer@example.com")!;
    const owner = sentMail.find((m) => m.to === "owner@example.com")!;
    expect(customer.subject).toContain(body.ticketId);
    expect(customer.text).toContain("No refund has been issued yet");
    expect(owner.subject).toContain(body.ticketId);
  });

  it("does not reveal order data when the email doesn't match, and can be submitted for manual review", async () => {
    const res = await postRefund(refundForm({ email: "someone-else@example.com" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("order_not_matched");
    expect(JSON.stringify(body)).not.toMatch(/buyer@example|14\.99|Lifetime/);
    expect(await prisma.ticket.count()).toBe(0);

    const retry = await postRefund(refundForm({ email: "someone-else@example.com", allow_unverified: "true" }));
    expect(retry.status).toBe(201);
    const ticket = await prisma.ticket.findFirstOrThrow();
    expect(ticket.orderVerified).toBe(false);
    expect(ticket.orderTotal).toBeNull();
  });

  it("returns the same error for an order number that doesn't exist", async () => {
    shopOrders = [];
    const res = await postRefund(refundForm({ order_number: "#9999" }));
    expect((await res.json()).error).toBe("order_not_matched");
  });

  it("still accepts the request (unverified) if Shopify is unavailable", async () => {
    shopifyDown = true;
    const res = await postRefund(refundForm());
    expect(res.status).toBe(201);
    expect((await prisma.ticket.findFirstOrThrow()).orderVerified).toBe(false);
  });

  it("is idempotent: a retried submission returns the same ticket ID", async () => {
    const key = randomUUID();
    const first = await (await postRefund(refundForm({ idempotency_key: key }))).json();
    const second = await (await postRefund(refundForm({ idempotency_key: key }))).json();
    expect(second).toEqual({ ok: true, ticketId: first.ticketId, duplicate: true });
    expect(await prisma.ticket.count()).toBe(1);
  });

  it("returns the existing open request for the same order and email instead of creating another", async () => {
    const first = await (await postRefund(refundForm())).json();
    const second = await (await postRefund(refundForm())).json();
    expect(second.ticketId).toBe(first.ticketId);
    expect(second.duplicate).toBe(true);
    expect(await prisma.ticket.count()).toBe(1);
  });

  it("rejects disguised malicious uploads and saves nothing", async () => {
    const html = new TextEncoder().encode("<html><script>alert(document.cookie)</script></html>");
    const res = await postRefund(refundForm({ screenshot: new File([html], "proof.png", { type: "image/png" }) }));
    expect(res.status).toBe(422);
    expect((await res.json()).fieldErrors.screenshot).toBeTruthy();
    expect(await prisma.ticket.count()).toBe(0);
  });

  it("rejects bot submissions (honeypot / too fast)", async () => {
    expect((await postRefund(refundForm({ website: "http://spam.example" }))).status).toBe(400);
    expect((await postRefund(refundForm({ started_at: String(Date.now()) }))).status).toBe(400);
    expect(await prisma.ticket.count()).toBe(0);
  });

  it("returns field errors for invalid input", async () => {
    const res = await postRefund(refundForm({ email: "not-an-email", description: "bad" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(Object.keys(body.fieldErrors).sort()).toEqual(["description", "email"]);
  });

  it("rate-limits repeated submissions from the same email", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await postRefund(refundForm())).status);
    expect(statuses.slice(0, 5).every((s) => s === 200 || s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("keeps the ticket and records the failure when email delivery fails", async () => {
    mailShouldFail = true;
    const res = await postRefund(refundForm());
    expect(res.status).toBe(201);
    const ticket = await prisma.ticket.findFirstOrThrow();
    await vi.waitFor(
      async () => {
        const failed = await prisma.auditLog.findFirst({ where: { ticketId: ticket.id, action: "email.customer_confirmation.failed" } });
        expect(failed).not.toBeNull();
      },
      { timeout: 3000 },
    );
    const systemMsg = await prisma.ticketMessage.findFirst({ where: { ticketId: ticket.id, author: "system" } });
    expect(systemMsg?.emailStatus).toBe("failed");
  });
});

describe("POST /apps/support/ticket (chat)", () => {
  async function postTicket(fields: Record<string, string>) {
    const form = new FormData();
    const base = {
      email: "visitor@example.com",
      topic: "installation",
      message: "How do I enter the activation code on Android?",
      transcript: "Customer: how do I install\nAssistant: Our setup guide…",
      website: "",
      started_at: String(Date.now() - 20_000),
      idempotency_key: randomUUID(),
    };
    Object.entries({ ...base, ...fields }).forEach(([k, v]) => form.set(k, v));
    const request = new Request(signedUrl("ticket"), { method: "POST", body: form });
    return (await ticketRoute.action({ request, params: {}, context: {} } as never)) as Response;
  }

  it("creates a support ticket with an ST- ID and stores the transcript", async () => {
    const res = await postTicket({});
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ticketId).toMatch(/^ST-/);
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { publicId: body.ticketId }, include: { messages: true } });
    expect(ticket.source).toBe("chat");
    expect(ticket.messages[0]!.body).toContain("Chat transcript");
    await waitForMail(2);
    expect(sentMail.find((m) => m.to === "visitor@example.com")?.text).toContain("/pages/refund-request");
  });

  it("verifies an optional order number without blocking on mismatch", async () => {
    const res = await postTicket({ order_number: "1001", email: "visitor@example.com" });
    expect(res.status).toBe(201);
    expect((await prisma.ticket.findFirstOrThrow()).orderVerified).toBe(false);
  });

  it("redacts card numbers typed into chat", async () => {
    await postTicket({ message: "I paid with 4242 4242 4242 4242 and got charged twice" });
    const ticket = await prisma.ticket.findFirstOrThrow();
    expect(ticket.description).not.toContain("4242 4242");
    expect(ticket.description).toContain("[redacted card number]");
  });
});
