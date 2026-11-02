export type BadgeTone =
  | "info"
  | "success"
  | "warning"
  | "critical"
  | "caution"
  | "neutral";

export const TICKET_STATUSES = [
  { value: "new", label: "New", tone: "info" },
  { value: "under_review", label: "Under Review", tone: "caution" },
  { value: "waiting_customer", label: "Waiting for Customer", tone: "warning" },
  { value: "troubleshooting", label: "Troubleshooting", tone: "caution" },
  { value: "refund_approved", label: "Refund Approved", tone: "success" },
  { value: "refund_issued", label: "Refund Issued", tone: "success" },
  { value: "resolved", label: "Resolved", tone: "neutral" },
  { value: "declined", label: "Declined with Explanation", tone: "critical" },
] as const satisfies ReadonlyArray<{
  value: string;
  label: string;
  tone: BadgeTone;
}>;

export type TicketStatus = (typeof TICKET_STATUSES)[number]["value"];

export const CLOSED_STATUSES: ReadonlyArray<TicketStatus> = [
  "refund_issued",
  "resolved",
  "declined",
];

export const REFUND_REASONS = [
  { value: "key_not_received", label: "VPN activation key not received" },
  { value: "key_not_working", label: "Activation key does not work" },
  { value: "connection_problem", label: "VPN connection problem" },
  { value: "compatibility", label: "Device or operating system compatibility issue" },
  { value: "not_as_described", label: "Product does not match its description" },
  { value: "duplicate_purchase", label: "Duplicate purchase" },
  { value: "accidental_purchase", label: "Accidental purchase" },
  { value: "billing_issue", label: "Subscription or billing issue" },
  { value: "other", label: "Other" },
] as const;

export type RefundReason = (typeof REFUND_REASONS)[number]["value"];

export const SUPPORT_TOPICS = [
  { value: "purchase", label: "Purchase or order" },
  { value: "activation", label: "Activation key" },
  { value: "installation", label: "Installation / setup" },
  { value: "connectivity", label: "Connection problem" },
  { value: "compatibility", label: "Device compatibility" },
  { value: "billing", label: "Billing" },
  { value: "refund", label: "Refund" },
  { value: "other", label: "Something else" },
] as const;

export type SupportTopic = (typeof SUPPORT_TOPICS)[number]["value"];

export const TICKET_TYPES = [
  { value: "refund", label: "Refund request" },
  { value: "support", label: "Support ticket" },
] as const;

export type TicketType = (typeof TICKET_TYPES)[number]["value"];

export function statusMeta(status: string) {
  return (
    TICKET_STATUSES.find((s) => s.value === status) ?? {
      value: status,
      label: status,
      tone: "neutral" as BadgeTone,
    }
  );
}

export function reasonLabel(reason: string | null | undefined) {
  if (!reason) return "—";
  return REFUND_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

export function topicLabel(topic: string | null | undefined) {
  if (!topic) return "—";
  return SUPPORT_TOPICS.find((t) => t.value === topic)?.label ?? topic;
}

export function isTicketStatus(value: string): value is TicketStatus {
  return TICKET_STATUSES.some((s) => s.value === value);
}

export const UPLOAD_LIMITS = {
  imageMaxBytes: 5 * 1024 * 1024,
  videoMaxBytes: 20 * 1024 * 1024,
  requestMaxBytes: 26 * 1024 * 1024,
} as const;
