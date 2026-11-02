import {
  REFUND_REASONS,
  SUPPORT_TOPICS,
  type RefundReason,
  type SupportTopic,
} from "./constants";

export type FieldErrors = Record<string, string>;

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldErrors };

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

// Card numbers (13–19 digits, optionally separated) must never be stored.
const CARD_NUMBER_RE = /\b\d(?:[ -]?\d){12,18}\b/;

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && EMAIL_RE.test(email);
}

/** Accepts "1001", "#1001", " #1001 " and returns "#1001". */
export function normalizeOrderName(raw: unknown): string | null {
  const value = String(raw ?? "").trim().replace(/^#+/, "");
  if (!/^[A-Za-z0-9-]{1,32}$/.test(value)) return null;
  return `#${value.toUpperCase()}`;
}

export function normalizeAmount(raw: unknown): string | null {
  const value = String(raw ?? "").trim().replace(/[^0-9.,]/g, "").replace(",", ".");
  if (!value) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num.toFixed(2);
}

function cleanText(raw: unknown, max: number): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
}

export function redactCardNumbers(text: string): string {
  return text.replace(new RegExp(CARD_NUMBER_RE.source, "g"), (match) => {
    const digits = match.replace(/\D/g, "");
    return luhnValid(digits) ? "[redacted card number]" : match;
  });
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

export interface RefundRequestInput {
  orderName: string;
  email: string;
  productName: string | null;
  requestedAmount: string | null;
  reason: RefundReason;
  description: string;
  allowUnverified: boolean;
  idempotencyKey: string | null;
}

export function validateRefundRequest(
  form: FormData,
): ValidationResult<RefundRequestInput> {
  const errors: FieldErrors = {};

  const orderName = normalizeOrderName(form.get("order_number"));
  if (!orderName) errors.order_number = "Enter the order number from your confirmation email (for example #1001).";

  const email = normalizeEmail(form.get("email"));
  if (!email) errors.email = "Enter the email address you used at checkout.";
  else if (!isValidEmail(email)) errors.email = "Enter a valid email address.";

  const productName = cleanText(form.get("product_name"), 200) || null;

  const rawAmount = cleanText(form.get("refund_amount"), 20);
  const requestedAmount = rawAmount ? normalizeAmount(rawAmount) : null;
  if (rawAmount && !requestedAmount) errors.refund_amount = "Enter an amount such as 14.99, or leave it blank.";

  const reason = String(form.get("reason") ?? "");
  if (!REFUND_REASONS.some((r) => r.value === reason)) errors.reason = "Choose the reason that best describes the problem.";

  const description = redactCardNumbers(cleanText(form.get("description"), 5000));
  if (description.length < 20) errors.description = "Please describe the problem in at least 20 characters so we can help.";

  if (form.get("confirm_accurate") !== "on" && form.get("confirm_accurate") !== "true") {
    errors.confirm_accurate = "Please confirm that the information is accurate.";
  }

  const idem = String(form.get("idempotency_key") ?? "").trim();
  const idempotencyKey = /^[A-Za-z0-9-]{16,64}$/.test(idem) ? idem : null;

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      orderName: orderName!,
      email,
      productName,
      requestedAmount,
      reason: reason as RefundReason,
      description,
      allowUnverified: form.get("allow_unverified") === "true",
      idempotencyKey,
    },
  };
}

export interface SupportTicketInput {
  email: string;
  name: string | null;
  orderName: string | null;
  topic: SupportTopic;
  message: string;
  transcript: string | null;
  idempotencyKey: string | null;
}

export function validateSupportTicket(
  form: FormData,
): ValidationResult<SupportTicketInput> {
  const errors: FieldErrors = {};

  const email = normalizeEmail(form.get("email"));
  if (!email) errors.email = "Enter your email so we can reply.";
  else if (!isValidEmail(email)) errors.email = "Enter a valid email address.";

  const rawOrder = cleanText(form.get("order_number"), 40);
  const orderName = rawOrder ? normalizeOrderName(rawOrder) : null;
  if (rawOrder && !orderName) errors.order_number = "That doesn't look like an order number (for example #1001).";

  const topic = String(form.get("topic") ?? "other");
  if (!SUPPORT_TOPICS.some((t) => t.value === topic)) errors.topic = "Choose a topic.";

  const message = redactCardNumbers(cleanText(form.get("message"), 4000));
  if (message.length < 10) errors.message = "Please write at least 10 characters.";

  const name = cleanText(form.get("name"), 100) || null;
  const transcript = redactCardNumbers(cleanText(form.get("transcript"), 8000)) || null;

  const idem = String(form.get("idempotency_key") ?? "").trim();
  const idempotencyKey = /^[A-Za-z0-9-]{16,64}$/.test(idem) ? idem : null;

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      email,
      name,
      orderName,
      topic: topic as SupportTopic,
      message,
      transcript,
      idempotencyKey,
    },
  };
}

/** Honeypot + minimum fill time. Returns a reason string when the submission looks automated. */
export function detectBot(form: FormData, now = Date.now()): string | null {
  if (String(form.get("website") ?? "").trim() !== "") return "honeypot";
  const started = Number(form.get("started_at"));
  if (!Number.isFinite(started) || started <= 0) return "missing_timestamp";
  const elapsed = now - started;
  if (elapsed < 3000) return "too_fast";
  if (elapsed > 1000 * 60 * 60 * 24) return "stale_form";
  return null;
}
