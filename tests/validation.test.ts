import { describe, expect, it } from "vitest";
import {
  detectBot,
  isValidEmail,
  normalizeAmount,
  normalizeOrderName,
  redactCardNumbers,
  validateRefundRequest,
  validateSupportTicket,
} from "../app/lib/validation.server";

function refundForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  const base: Record<string, string> = {
    order_number: "#1001",
    email: "Buyer@Example.com",
    product_name: "Lifetime VPN Key",
    refund_amount: "",
    reason: "key_not_working",
    description: "The key says invalid on my iPhone in every app I tried.",
    confirm_accurate: "on",
    idempotency_key: "8f14e45f-ceea-4f6a-9c9b-1a2b3c4d5e6f",
  };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) form.set(k, v);
  return form;
}

describe("field normalizers", () => {
  it("normalizes order numbers", () => {
    expect(normalizeOrderName("1001")).toBe("#1001");
    expect(normalizeOrderName(" ##1001 ")).toBe("#1001");
    expect(normalizeOrderName("ab-12")).toBe("#AB-12");
    expect(normalizeOrderName("")).toBeNull();
    expect(normalizeOrderName("1001; DROP TABLE")).toBeNull();
    expect(normalizeOrderName("<script>")).toBeNull();
  });

  it("validates emails", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
    expect(isValidEmail("<x>@y.com")).toBe(false);
  });

  it("normalizes amounts", () => {
    expect(normalizeAmount("14.99")).toBe("14.99");
    expect(normalizeAmount("$14,99")).toBe("14.99");
    expect(normalizeAmount("0")).toBeNull();
    expect(normalizeAmount("1.999")).toBeNull();
    expect(normalizeAmount("abc")).toBeNull();
  });

  it("redacts Luhn-valid card numbers but keeps other numbers", () => {
    expect(redactCardNumbers("my card 4242 4242 4242 4242 was charged")).toBe(
      "my card [redacted card number] was charged",
    );
    expect(redactCardNumbers("order 1001 and phone 5551234567")).toBe("order 1001 and phone 5551234567");
  });
});

describe("validateRefundRequest", () => {
  it("accepts a valid submission and lowercases email", () => {
    const result = validateRefundRequest(refundForm());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.email).toBe("buyer@example.com");
      expect(result.data.orderName).toBe("#1001");
      expect(result.data.requestedAmount).toBeNull();
      expect(result.data.allowUnverified).toBe(false);
    }
  });

  it("reports every invalid field", () => {
    const result = validateRefundRequest(
      refundForm({ order_number: "", email: "nope", reason: "free_money", description: "short", confirm_accurate: "", refund_amount: "lots" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(
        ["confirm_accurate", "description", "email", "order_number", "reason", "refund_amount"].sort(),
      );
    }
  });

  it("drops malformed idempotency keys", () => {
    const result = validateRefundRequest(refundForm({ idempotency_key: "short" }));
    expect(result.ok && result.data.idempotencyKey).toBeNull();
  });

  it("truncates very long descriptions", () => {
    const result = validateRefundRequest(refundForm({ description: "x".repeat(20000) }));
    expect(result.ok && result.data.description.length).toBe(5000);
  });
});

describe("validateSupportTicket", () => {
  it("allows a missing order number but rejects a malformed one", () => {
    const form = new FormData();
    form.set("email", "a@b.co");
    form.set("message", "How do I install on Android?");
    form.set("topic", "installation");
    expect(validateSupportTicket(form).ok).toBe(true);
    form.set("order_number", "not an order!");
    const bad = validateSupportTicket(form);
    expect(bad.ok).toBe(false);
  });
});

describe("detectBot", () => {
  const now = 1_000_000_000;
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    Object.entries(fields).forEach(([k, v]) => f.set(k, v));
    return f;
  };
  it("flags honeypot, missing/too-fast timestamps", () => {
    expect(detectBot(form({ website: "spam.com", started_at: String(now - 60000) }), now)).toBe("honeypot");
    expect(detectBot(form({}), now)).toBe("missing_timestamp");
    expect(detectBot(form({ started_at: String(now - 500) }), now)).toBe("too_fast");
  });
  it("passes a normal human submission", () => {
    expect(detectBot(form({ website: "", started_at: String(now - 45000) }), now)).toBeNull();
  });
});
