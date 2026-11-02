import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { audit } from "./audit.server";
import { CLOSED_STATUSES, reasonLabel, topicLabel } from "./constants";
import { baseTemplateVars, renderTemplate, sendEmail } from "./email.server";
import { verifyOrderOwnership, type AdminGraphqlClient, type OrderSummary } from "./orders.server";
import { generatePublicId } from "./ticket-id.server";
import { deleteUpload, storeUpload, type ValidatedUpload } from "./uploads.server";
import type { RefundRequestInput, SupportTicketInput } from "./validation.server";

export type CreateResult =
  | { kind: "created"; publicId: string }
  | { kind: "duplicate"; publicId: string }
  | { kind: "order_not_matched" };

function orderFields(order: OrderSummary | null) {
  if (!order) return {};
  return {
    orderGid: order.gid,
    orderCreatedAt: new Date(order.createdAt),
    orderTotal: order.total,
    orderRefunded: order.refunded,
    orderCurrency: order.currency,
    orderFinancialStatus: order.financialStatus,
  };
}

async function createWithUniqueId<T>(
  type: "refund" | "support",
  create: (publicId: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await create(generatePublicId(type));
    } catch (error) {
      const isPublicIdCollision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        String(error.meta?.target ?? "").includes("publicId");
      if (!isPublicIdCollision) throw error;
    }
  }
  throw new Error("Could not allocate a unique ticket ID");
}

async function findByIdempotencyKey(shop: string, key: string | null) {
  if (!key) return null;
  return prisma.ticket.findUnique({
    where: { shop_idempotencyKey: { shop, idempotencyKey: key } },
    select: { publicId: true },
  });
}

function isIdempotencyRace(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    String(error.meta?.target ?? "").includes("idempotencyKey")
  );
}

export async function createRefundTicket(args: {
  shop: string;
  admin: AdminGraphqlClient | undefined;
  input: RefundRequestInput;
  uploads: ValidatedUpload[];
}): Promise<CreateResult> {
  const { shop, admin, input, uploads } = args;

  const existing = await findByIdempotencyKey(shop, input.idempotencyKey);
  if (existing) return { kind: "duplicate", publicId: existing.publicId };

  const ownership = await verifyOrderOwnership(admin, input.orderName, input.email);
  if (ownership.status === "not_matched" && !input.allowUnverified) {
    return { kind: "order_not_matched" };
  }
  if (ownership.status === "unavailable") {
    console.error("[tickets] order verification unavailable", ownership.error);
  }

  const openDuplicate = await prisma.ticket.findFirst({
    where: {
      shop,
      type: "refund",
      orderName: input.orderName,
      customerEmail: input.email,
      status: { notIn: [...CLOSED_STATUSES] },
    },
    select: { publicId: true },
  });
  if (openDuplicate) return { kind: "duplicate", publicId: openDuplicate.publicId };

  const order = ownership.status === "matched" ? ownership.order : null;

  const storedKeys: string[] = [];
  try {
    const attachments: Prisma.AttachmentCreateWithoutTicketInput[] = [];
    for (const upload of uploads) {
      const storageKey = await storeUpload(upload);
      storedKeys.push(storageKey);
      attachments.push({
        kind: upload.kind,
        storageKey,
        originalName: upload.originalName,
        mimeType: upload.mime,
        sizeBytes: upload.bytes.byteLength,
        sha256: upload.sha256,
      });
    }

    const ticket = await createWithUniqueId("refund", (publicId) =>
      prisma.ticket.create({
        data: {
          shop,
          publicId,
          type: "refund",
          source: "refund_form",
          customerEmail: input.email,
          orderName: input.orderName,
          orderVerified: Boolean(order),
          ...orderFields(order),
          productName: input.productName ?? order?.productNames.join(", ") ?? null,
          requestedAmount: input.requestedAmount,
          reason: input.reason,
          description: input.description,
          idempotencyKey: input.idempotencyKey,
          messages: {
            create: { author: "customer", authorLabel: input.email, body: input.description },
          },
          attachments: { create: attachments },
        },
      }),
    );

    await audit({
      shop,
      actor: "customer",
      action: "ticket.created",
      ticketId: ticket.id,
      details: {
        source: "refund_form",
        orderVerification: ownership.status,
        attachments: attachments.length,
      },
    });

    void notifyNewTicket(ticket.id);
    return { kind: "created", publicId: ticket.publicId };
  } catch (error) {
    await Promise.all(storedKeys.map((k) => deleteUpload(k).catch(() => {})));
    if (isIdempotencyRace(error)) {
      const raced = await findByIdempotencyKey(shop, input.idempotencyKey);
      if (raced) return { kind: "duplicate", publicId: raced.publicId };
    }
    throw error;
  }
}

export async function createSupportTicket(args: {
  shop: string;
  admin: AdminGraphqlClient | undefined;
  input: SupportTicketInput;
}): Promise<CreateResult> {
  const { shop, admin, input } = args;

  const existing = await findByIdempotencyKey(shop, input.idempotencyKey);
  if (existing) return { kind: "duplicate", publicId: existing.publicId };

  let order: OrderSummary | null = null;
  if (input.orderName) {
    const ownership = await verifyOrderOwnership(admin, input.orderName, input.email);
    if (ownership.status === "matched") order = ownership.order;
  }

  const body = input.transcript
    ? `${input.message}\n\n— Chat transcript —\n${input.transcript}`
    : input.message;

  try {
    const ticket = await createWithUniqueId("support", (publicId) =>
      prisma.ticket.create({
        data: {
          shop,
          publicId,
          type: "support",
          source: "chat",
          customerEmail: input.email,
          customerName: input.name,
          orderName: input.orderName,
          orderVerified: Boolean(order),
          ...orderFields(order),
          productName: order?.productNames.join(", ") ?? null,
          topic: input.topic,
          description: input.message,
          idempotencyKey: input.idempotencyKey,
          messages: {
            create: { author: "customer", authorLabel: input.email, body },
          },
        },
      }),
    );

    await audit({
      shop,
      actor: "customer",
      action: "ticket.created",
      ticketId: ticket.id,
      details: { source: "chat", topic: input.topic, orderVerified: Boolean(order) },
    });

    void notifyNewTicket(ticket.id);
    return { kind: "created", publicId: ticket.publicId };
  } catch (error) {
    if (isIdempotencyRace(error)) {
      const raced = await findByIdempotencyKey(shop, input.idempotencyKey);
      if (raced) return { kind: "duplicate", publicId: raced.publicId };
    }
    throw error;
  }
}

/** Sends the customer confirmation and the internal alert, recording each outcome. Never throws. */
export async function notifyNewTicket(ticketId: string) {
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) return;

    const vars = {
      ...baseTemplateVars(ticket.shop),
      customer_name: ticket.customerName || "there",
      ticket_id: ticket.publicId,
      order_number: ticket.orderName ?? "(not provided)",
      refund_amount: ticket.requestedAmount ? `${ticket.requestedAmount} ${ticket.orderCurrency ?? ""}`.trim() : "",
    };

    const customerKey = ticket.type === "refund" ? "refund_received" : "support_received";
    const customerEmail = await renderTemplate(ticket.shop, customerKey, vars);
    const customerResult = await sendEmail({ to: ticket.customerEmail, ...customerEmail });

    await prisma.ticketMessage.create({
      data: {
        ticketId,
        author: "system",
        authorLabel: "Automatic confirmation",
        body: `${customerEmail.subject}\n\n${customerEmail.text}`,
        emailStatus: customerResult.status,
      },
    });
    await audit({
      shop: ticket.shop,
      actor: "system",
      action: `email.customer_confirmation.${customerResult.status}`,
      ticketId,
      details: customerResult.error ? { error: customerResult.error } : undefined,
    });

    const adminTo = process.env.ADMIN_NOTIFY_EMAIL;
    if (adminTo) {
      const summary = [
        `Type: ${ticket.type === "refund" ? "Refund request" : "Support ticket (chat)"}`,
        `Customer email: ${ticket.customerEmail}`,
        `Order verified with Shopify: ${ticket.orderVerified ? "yes" : "no"}`,
        ticket.reason ? `Reason: ${reasonLabel(ticket.reason)}` : `Topic: ${topicLabel(ticket.topic)}`,
        ticket.requestedAmount ? `Requested amount: ${ticket.requestedAmount}` : null,
        "",
        ticket.description,
      ]
        .filter((l) => l !== null)
        .join("\n");
      const adminEmail = await renderTemplate(ticket.shop, "admin_new_request", {
        ...vars,
        customer_name: ticket.customerEmail,
        message: summary,
      });
      const adminResult = await sendEmail({ to: adminTo, ...adminEmail, replyTo: ticket.customerEmail });
      await audit({
        shop: ticket.shop,
        actor: "system",
        action: `email.admin_alert.${adminResult.status}`,
        ticketId,
        details: adminResult.error ? { error: adminResult.error } : undefined,
      });
    }
  } catch (error) {
    console.error("[tickets] notifyNewTicket failed", ticketId, error);
  }
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export async function getDashboardStats(shop: string) {
  const [byStatus, total, timing] = await Promise.all([
    prisma.ticket.groupBy({ by: ["status"], where: { shop }, _count: { _all: true } }),
    prisma.ticket.count({ where: { shop } }),
    prisma.ticket.findMany({
      where: { shop, OR: [{ firstResponseAt: { not: null } }, { resolvedAt: { not: null } }] },
      select: { createdAt: true, firstResponseAt: true, resolvedAt: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
  ]);

  const count = (status: string) => byStatus.find((s) => s.status === status)?._count._all ?? 0;

  const firstResponse = average(
    timing
      .filter((t) => t.firstResponseAt)
      .map((t) => t.firstResponseAt!.getTime() - t.createdAt.getTime()),
  );
  const resolution = average(
    timing.filter((t) => t.resolvedAt).map((t) => t.resolvedAt!.getTime() - t.createdAt.getTime()),
  );

  return {
    total,
    newCount: count("new"),
    waitingCustomer: count("waiting_customer"),
    refundApproved: count("refund_approved"),
    refundIssued: count("refund_issued"),
    avgFirstResponseMs: firstResponse,
    avgResolutionMs: resolution,
  };
}

export async function deleteTicketWithAttachments(ticketId: string) {
  const attachments = await prisma.attachment.findMany({
    where: { ticketId },
    select: { storageKey: true },
  });
  await prisma.ticket.delete({ where: { id: ticketId } });
  await Promise.all(attachments.map((a) => deleteUpload(a.storageKey).catch(() => {})));
}
