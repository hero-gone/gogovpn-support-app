export interface EmailTemplateDefinition {
  key: string;
  name: string;
  audience: "customer" | "internal";
  /** Status a reply with this template suggests moving the ticket to. */
  suggestedStatus?: string;
  subject: string;
  body: string;
}

export const TEMPLATE_PLACEHOLDERS = [
  "customer_name",
  "ticket_id",
  "order_number",
  "store_name",
  "support_email",
  "refund_amount",
  "message",
  "refund_page_url",
] as const;

export const DEFAULT_TEMPLATES: EmailTemplateDefinition[] = [
  {
    key: "refund_received",
    name: "Refund request received",
    audience: "customer",
    subject: "We received your refund request {{ticket_id}}",
    body: `Hi {{customer_name}},

Thank you for contacting {{store_name}}. We have received your refund request for order {{order_number}}.

Your request ID is {{ticket_id}}. Please keep it for your records.

What happens next:
- A member of our team will review your request, usually within 1–2 business days.
- If we need more details, or if we can fix a technical problem for you, we will email you.
- We will let you know the outcome by email. No refund has been issued yet.

You can reply to this email at any time to add information.

Kind regards,
{{store_name}} Support`,
  },
  {
    key: "support_received",
    name: "Support ticket received (chat)",
    audience: "customer",
    subject: "Your support ticket {{ticket_id}}",
    body: `Hi {{customer_name}},

Thanks for reaching out to {{store_name}}. We've created support ticket {{ticket_id}} and a member of our team will reply by email.

If you'd like to add details or screenshots, simply reply to this email.

If you would like to request a refund, you can do so here: {{refund_page_url}}

Kind regards,
{{store_name}} Support`,
  },
  {
    key: "need_info",
    name: "We need additional information",
    audience: "customer",
    suggestedStatus: "waiting_customer",
    subject: "More information needed for {{ticket_id}}",
    body: `Hi {{customer_name}},

Thank you for your patience. To continue reviewing request {{ticket_id}} (order {{order_number}}), we need a little more information:

{{message}}

Please reply to this email with the details above. For your security, please never send us your payment card number or passwords.

Kind regards,
{{store_name}} Support`,
  },
  {
    key: "troubleshooting",
    name: "Technical troubleshooting assistance",
    audience: "customer",
    suggestedStatus: "troubleshooting",
    subject: "Let's get your VPN working — {{ticket_id}}",
    body: `Hi {{customer_name}},

We're sorry you've had trouble. Many activation and connection problems can be fixed quickly, so we'd like to help before reaching a decision on your request {{ticket_id}}.

{{message}}

If these steps don't solve the problem, just reply and let us know. Your refund request stays open while we troubleshoot, and trying these steps does not affect your eligibility.

Kind regards,
{{store_name}} Support`,
  },
  {
    key: "refund_approved",
    name: "Refund approved",
    audience: "customer",
    suggestedStatus: "refund_approved",
    subject: "Your refund for order {{order_number}} has been approved",
    body: `Hi {{customer_name}},

Good news — we have approved a refund of {{refund_amount}} for order {{order_number}} (request {{ticket_id}}).

We will process it shortly and send you a separate confirmation once the refund has been issued.

{{message}}

Kind regards,
{{store_name}} Support`,
  },
  {
    key: "refund_processed",
    name: "Refund successfully processed",
    audience: "customer",
    suggestedStatus: "refund_issued",
    subject: "Your refund for order {{order_number}} has been issued",
    body: `Hi {{customer_name}},

We have issued a refund of {{refund_amount}} for order {{order_number}} (request {{ticket_id}}) to your original payment method.

Depending on your bank or card provider, it usually takes 5–10 business days for the refund to appear on your statement.

{{message}}

Thank you for giving us the opportunity to make this right.

Kind regards,
{{store_name}} Support`,
  },
  {
    key: "refund_declined",
    name: "Refund request declined (with explanation)",
    audience: "customer",
    suggestedStatus: "declined",
    subject: "Update on your refund request {{ticket_id}}",
    body: `Hi {{customer_name}},

Thank you for your patience while we reviewed your refund request {{ticket_id}} for order {{order_number}}.

After careful review, we are unable to approve a refund in this case. Here is why:

{{message}}

We still want to help you get the product working. If you have information we haven't seen, or if the problem continues, please reply to this email and we will take another look.

Kind regards,
{{store_name}} Support`,
  },
  {
    key: "resolved",
    name: "Request resolved",
    audience: "customer",
    suggestedStatus: "resolved",
    subject: "Your request {{ticket_id}} has been resolved",
    body: `Hi {{customer_name}},

We're marking request {{ticket_id}} as resolved.

{{message}}

If anything else comes up, just reply to this email and we'll reopen it.

Kind regards,
{{store_name}} Support`,
  },
  {
    key: "follow_up",
    name: "Follow-up (no customer response)",
    audience: "customer",
    subject: "Following up on {{ticket_id}}",
    body: `Hi {{customer_name}},

We're following up on your request {{ticket_id}} for order {{order_number}}. We haven't heard back yet and want to make sure your issue is taken care of.

{{message}}

When you have a moment, please reply to this email so we can continue.

Kind regards,
{{store_name}} Support`,
  },
  {
    key: "admin_new_request",
    name: "Internal: new request alert",
    audience: "internal",
    subject: "[{{ticket_id}}] New request — order {{order_number}}",
    body: `A new request was submitted.

Request ID: {{ticket_id}}
Order: {{order_number}}
Customer: {{customer_name}}

{{message}}

Open the Support & Refunds app in Shopify Admin to review it.`,
  },
];

export function getDefaultTemplate(key: string) {
  return DEFAULT_TEMPLATES.find((t) => t.key === key);
}

export type TemplateVars = Partial<Record<(typeof TEMPLATE_PLACEHOLDERS)[number], string | null | undefined>>;

export function renderTemplateText(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key: string) => {
      const value = vars[key as keyof TemplateVars];
      return value == null || value === "" ? "" : String(value);
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function textToHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => {
      const escaped = escapeHtml(p).replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" style="color:#2563eb">$1</a>',
      );
      return `<p style="margin:0 0 16px">${escaped.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;color:#0f172a;font-size:15px;line-height:1.6"><div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">${paragraphs}</div></body></html>`;
}
