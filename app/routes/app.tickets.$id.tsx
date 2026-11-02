import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { requireStaff } from "../lib/staff.server";
import { audit } from "../lib/audit.server";
import {
  CLOSED_STATUSES,
  TICKET_STATUSES,
  isTicketStatus,
  reasonLabel,
  statusMeta,
  topicLabel,
} from "../lib/constants";
import { DEFAULT_TEMPLATES, getDefaultTemplate } from "../lib/email-templates";
import { baseTemplateVars, renderTemplate, sendEmail } from "../lib/email.server";
import { findOrderByName } from "../lib/orders.server";
import { deleteTicketWithAttachments } from "../lib/tickets.server";
import { formatDateTime, formatMoney, legacyIdFromGid } from "../lib/format";

type ActionResult = { ok: boolean; message: string; intent: string };

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await requireStaff(request);
  const shop = session.shop;

  const ticket = await prisma.ticket.findFirst({
    where: { id: params.id, shop },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
      attachments: {
        select: { id: true, kind: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true },
      },
    },
  });
  if (!ticket) throw new Response("Request not found", { status: 404 });

  const [related, auditLog, staffSessions, overrides] = await Promise.all([
    prisma.ticket.findMany({
      where: { shop, customerEmail: ticket.customerEmail, id: { not: ticket.id } },
      select: { id: true, publicId: true, type: true, status: true, createdAt: true, orderName: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.auditLog.findMany({
      where: { shop, ticketId: ticket.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.session.findMany({
      where: { shop, isOnline: true, email: { not: null } },
      select: { email: true, firstName: true, lastName: true },
      distinct: ["email"],
    }),
    prisma.emailTemplate.findMany({ where: { shop } }),
  ]);

  const templates = DEFAULT_TEMPLATES.filter((t) => t.audience === "customer" && t.key !== "refund_received" && t.key !== "support_received").map((t) => {
    const o = overrides.find((x) => x.key === t.key);
    return { key: t.key, name: t.name, suggestedStatus: t.suggestedStatus ?? null, body: o?.body ?? t.body };
  });

  return {
    ticket: { ...ticket, idempotencyKey: undefined },
    related,
    auditLog,
    templates,
    staffOptions: staffSessions.map((s) => s.email!).filter(Boolean),
    shopHandle: shop.replace(/\.myshopify\.com$/, ""),
  };
};

function clean(value: FormDataEntryValue | null, max: number) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

export const action = async ({ request, params }: ActionFunctionArgs): Promise<ActionResult | Response> => {
  const { session, admin, staff } = await requireStaff(request);
  const shop = session.shop;
  const ticket = await prisma.ticket.findFirst({ where: { id: params.id, shop } });
  if (!ticket) throw new Response("Request not found", { status: 404 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const actor = staff.email ?? staff.label;

  switch (intent) {
    case "status": {
      const status = String(form.get("status") ?? "");
      if (!isTicketStatus(status)) return { ok: false, intent, message: "Choose a valid status." };
      if (status === "refund_issued" && form.get("confirm_refund_issued") !== "on") {
        return {
          ok: false,
          intent,
          message: "Confirm that the refund was actually issued in Shopify before marking it as Refund Issued.",
        };
      }
      const closing = CLOSED_STATUSES.includes(status);
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status, resolvedAt: closing ? (ticket.resolvedAt ?? new Date()) : null },
      });
      await audit({ shop, actor, action: "ticket.status_changed", ticketId: ticket.id, details: { from: ticket.status, to: status } });
      return { ok: true, intent, message: `Status changed to ${statusMeta(status).label}.` };
    }

    case "assign": {
      const assignee = clean(form.get("assignee"), 254) || null;
      await prisma.ticket.update({ where: { id: ticket.id }, data: { assignedTo: assignee } });
      await audit({ shop, actor, action: "ticket.assigned", ticketId: ticket.id, details: { from: ticket.assignedTo, to: assignee } });
      return { ok: true, intent, message: assignee ? `Assigned to ${assignee}.` : "Unassigned." };
    }

    case "note": {
      const body = clean(form.get("note"), 5000);
      if (!body) return { ok: false, intent, message: "Write a note first." };
      await prisma.ticketNote.create({ data: { ticketId: ticket.id, author: staff.label, body } });
      await audit({ shop, actor, action: "ticket.note_added", ticketId: ticket.id });
      return { ok: true, intent, message: "Internal note added." };
    }

    case "reply": {
      const key = String(form.get("template") ?? "");
      const def = getDefaultTemplate(key);
      if (!def || def.audience !== "customer") return { ok: false, intent, message: "Choose an email template." };
      const message = clean(form.get("message"), 5000);
      if (!message && ["need_info", "troubleshooting", "refund_declined"].includes(key)) {
        return { ok: false, intent, message: "This template needs a message (for example the steps or the explanation)." };
      }

      const rendered = await renderTemplate(shop, key, {
        ...baseTemplateVars(shop),
        customer_name: ticket.customerName || "there",
        ticket_id: ticket.publicId,
        order_number: ticket.orderName ?? "",
        refund_amount: ticket.requestedAmount
          ? formatMoney(ticket.requestedAmount, ticket.orderCurrency)
          : ticket.orderTotal
            ? formatMoney(ticket.orderTotal, ticket.orderCurrency)
            : "",
        message,
      });
      const result = await sendEmail({ to: ticket.customerEmail, ...rendered });

      await prisma.ticketMessage.create({
        data: {
          ticketId: ticket.id,
          author: "staff",
          authorLabel: staff.label,
          body: `${rendered.subject}\n\n${rendered.text}`,
          emailStatus: result.status,
        },
      });

      const updates: { firstResponseAt?: Date; status?: string; resolvedAt?: Date | null } = {};
      if (result.status === "sent" && !ticket.firstResponseAt) updates.firstResponseAt = new Date();

      let statusNote = "";
      const suggested = def.suggestedStatus;
      if (form.get("apply_status") === "on" && suggested && isTicketStatus(suggested)) {
        if (suggested === "refund_issued" && form.get("confirm_refund_issued") !== "on") {
          statusNote = " Status was not changed: confirm the refund was issued in Shopify first.";
        } else {
          updates.status = suggested;
          updates.resolvedAt = CLOSED_STATUSES.includes(suggested) ? (ticket.resolvedAt ?? new Date()) : null;
          statusNote = ` Status set to ${statusMeta(suggested).label}.`;
        }
      }
      if (Object.keys(updates).length) await prisma.ticket.update({ where: { id: ticket.id }, data: updates });

      await audit({
        shop,
        actor,
        action: `ticket.reply.${result.status}`,
        ticketId: ticket.id,
        details: { template: key, statusChange: updates.status ?? null, error: result.error ?? null },
      });

      if (result.status !== "sent") {
        return {
          ok: false,
          intent,
          message: `The email was NOT sent (${result.error ?? result.status}). It's saved in the conversation so you can send it manually.${statusNote}`,
        };
      }
      return { ok: true, intent, message: `Email sent to ${ticket.customerEmail}.${statusNote}` };
    }

    case "refresh_order": {
      if (!ticket.orderName) return { ok: false, intent, message: "This request has no order number." };
      try {
        const order = await findOrderByName(admin, ticket.orderName);
        if (!order) {
          await audit({ shop, actor, action: "order.refresh_not_found", ticketId: ticket.id });
          return { ok: false, intent, message: `Order ${ticket.orderName} was not found in Shopify.` };
        }
        const emailMatches = order.email?.toLowerCase() === ticket.customerEmail.toLowerCase();
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: {
            orderGid: order.gid,
            orderVerified: emailMatches,
            orderCreatedAt: new Date(order.createdAt),
            orderTotal: order.total,
            orderRefunded: order.refunded,
            orderCurrency: order.currency,
            orderFinancialStatus: order.financialStatus,
            productName: ticket.productName ?? order.productNames.join(", "),
          },
        });
        await audit({ shop, actor, action: "order.refreshed", ticketId: ticket.id, details: { emailMatches } });
        return {
          ok: true,
          intent,
          message: emailMatches
            ? "Order details refreshed from Shopify."
            : "Order refreshed, but the order email does not match the customer's email. Review carefully.",
        };
      } catch (error) {
        console.error("[tickets] refresh_order failed", error);
        return { ok: false, intent, message: "Couldn't reach Shopify to refresh the order. Try again shortly." };
      }
    }

    case "delete": {
      if (clean(form.get("confirm"), 10) !== "DELETE") {
        return { ok: false, intent, message: 'Type DELETE to confirm.' };
      }
      await audit({
        shop,
        actor,
        action: "ticket.deleted",
        ticketId: null,
        details: { publicId: ticket.publicId, orderName: ticket.orderName },
      });
      await deleteTicketWithAttachments(ticket.id);
      return redirect("/app");
    }

    default:
      return { ok: false, intent, message: "Unknown action." };
  }
};

/* ───────────────────────── UI ───────────────────────── */

function useToastOnResult(data: ActionResult | undefined) {
  const shopify = useAppBridge();
  useEffect(() => {
    if (data?.message) shopify.toast.show(data.message, { isError: !data.ok, duration: data.ok ? 3000 : 8000 });
  }, [data, shopify]);
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <s-grid gridTemplateColumns="160px 1fr" gap="base">
      <s-text color="subdued">{label}</s-text>
      <s-text>{children}</s-text>
    </s-grid>
  );
}

function AttachmentPreview({ id, kind, name }: { id: string; kind: string; name: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    fetch(`/app/attachments/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.blob();
      })
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setError(true));
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  if (error) return <s-text tone="critical">Couldn&apos;t load {name}.</s-text>;
  if (!url) return <s-spinner accessibilityLabel={`Loading ${name}`} />;
  return kind === "image" ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img src={url} alt={name} style={{ maxWidth: "100%", maxHeight: 360, borderRadius: 8, display: "block" }} />
    </a>
  ) : (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <video src={url} controls style={{ maxWidth: "100%", maxHeight: 360, borderRadius: 8 }} />
  );
}

export default function TicketDetail() {
  const { ticket, related, auditLog, templates, staffOptions, shopHandle } = useLoaderData<typeof loader>();
  const meta = statusMeta(ticket.status);
  const orderLegacyId = legacyIdFromGid(ticket.orderGid);

  const statusFetcher = useFetcher<ActionResult>();
  const assignFetcher = useFetcher<ActionResult>();
  const noteFetcher = useFetcher<ActionResult>();
  const replyFetcher = useFetcher<ActionResult>();
  const orderFetcher = useFetcher<ActionResult>();
  const deleteFetcher = useFetcher<ActionResult>();
  useToastOnResult(statusFetcher.data);
  useToastOnResult(assignFetcher.data);
  useToastOnResult(noteFetcher.data);
  useToastOnResult(replyFetcher.data);
  useToastOnResult(orderFetcher.data);
  useToastOnResult(deleteFetcher.data);

  const [templateKey, setTemplateKey] = useState(templates[0]?.key ?? "");
  const [pendingStatus, setPendingStatus] = useState(ticket.status);
  const templateSelect = useRef<HTMLElementTagNameMap["s-select"]>(null);
  const statusSelect = useRef<HTMLElementTagNameMap["s-select"]>(null);
  const noteForm = useRef<HTMLFormElement>(null);
  const replyForm = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const el = templateSelect.current;
    if (!el) return;
    const onChange = () => setTemplateKey(el.value ?? "");
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const el = statusSelect.current;
    if (!el) return;
    const onChange = () => setPendingStatus(el.value ?? "");
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (noteFetcher.state === "idle" && noteFetcher.data?.ok) noteForm.current?.reset();
  }, [noteFetcher.state, noteFetcher.data]);
  useEffect(() => {
    if (replyFetcher.state === "idle" && replyFetcher.data?.ok) replyForm.current?.reset();
  }, [replyFetcher.state, replyFetcher.data]);

  const selectedTemplate = templates.find((t) => t.key === templateKey);
  const busy = (f: { state: string }) => (f.state !== "idle" ? { loading: true } : {});

  return (
    <s-page heading={`${ticket.publicId} · ${ticket.type === "refund" ? "Refund request" : "Support ticket"}`}>
      <s-link slot="breadcrumb-actions" href="/app">
        Requests
      </s-link>

      {!ticket.orderVerified && ticket.orderName ? (
        <s-banner tone="warning" heading="Order not verified">
          The order number and email could not be matched in Shopify when this was submitted. Check the order manually
          before taking action.
        </s-banner>
      ) : null}

      <s-section heading="Request">
        <s-stack direction="block" gap="small-300">
          <Row label="Status">
            <s-badge tone={meta.tone}>{meta.label}</s-badge>
          </Row>
          <Row label="Customer email">{ticket.customerEmail}</Row>
          {ticket.customerName ? <Row label="Customer name">{ticket.customerName}</Row> : null}
          <Row label="Reason">{ticket.reason ? reasonLabel(ticket.reason) : topicLabel(ticket.topic)}</Row>
          <Row label="Requested amount">
            {ticket.requestedAmount ? formatMoney(ticket.requestedAmount, ticket.orderCurrency) : ticket.type === "refund" ? "Full refund (not specified)" : "—"}
          </Row>
          <Row label="Submitted">{formatDateTime(ticket.createdAt)}</Row>
          <Row label="First response">{formatDateTime(ticket.firstResponseAt)}</Row>
          <Row label="Resolved">{formatDateTime(ticket.resolvedAt)}</Row>
        </s-stack>
        <s-box paddingBlockStart="base">
          <s-heading>Customer description</s-heading>
          <s-box padding="base" background="subdued" borderRadius="base">
            <s-paragraph>
              <span style={{ whiteSpace: "pre-wrap" }}>{ticket.description}</span>
            </s-paragraph>
          </s-box>
        </s-box>
      </s-section>

      <s-section heading="Order">
        <s-stack direction="block" gap="small-300">
          <Row label="Order number">
            {ticket.orderName ?? "—"}{" "}
            {ticket.orderName ? (
              ticket.orderVerified ? <s-badge tone="success">Email matches order</s-badge> : <s-badge tone="warning">Unverified</s-badge>
            ) : null}
          </Row>
          <Row label="Product">{ticket.productName ?? "—"}</Row>
          <Row label="Purchase date">{formatDateTime(ticket.orderCreatedAt)}</Row>
          <Row label="Order total">{formatMoney(ticket.orderTotal, ticket.orderCurrency)}</Row>
          <Row label="Already refunded">{formatMoney(ticket.orderRefunded, ticket.orderCurrency)}</Row>
          <Row label="Payment status">{ticket.orderFinancialStatus ?? "—"}</Row>
        </s-stack>
        <s-box paddingBlockStart="base">
          <s-stack direction="inline" gap="small-200">
            {orderLegacyId ? (
              <s-button href={`https://admin.shopify.com/store/${shopHandle}/orders/${orderLegacyId}`} target="_blank">
                Open order in Shopify
              </s-button>
            ) : null}
            {ticket.orderName ? (
              <orderFetcher.Form method="post">
                <input type="hidden" name="intent" value="refresh_order" />
                <s-button type="submit" variant="secondary" {...busy(orderFetcher)}>
                  Refresh from Shopify
                </s-button>
              </orderFetcher.Form>
            ) : null}
          </s-stack>
          <s-paragraph color="subdued">
            Issue refunds from the Shopify order page for now. In-app refunds with duplicate protection come in Phase 3.
          </s-paragraph>
        </s-box>
      </s-section>

      <s-section heading={`Evidence (${ticket.attachments.length})`}>
        {ticket.attachments.length === 0 ? (
          <s-paragraph color="subdued">No files were uploaded.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {ticket.attachments.map((a) => (
              <s-box key={a.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small-200">
                  <s-text>
                    {a.originalName} · {(a.sizeBytes / 1024 / 1024).toFixed(1)} MB
                  </s-text>
                  <AttachmentPreview id={a.id} kind={a.kind} name={a.originalName} />
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
        <s-paragraph color="subdued">
          Activation and delivery records will appear here once the activation backend is connected (Phase 3).
        </s-paragraph>
      </s-section>

      <s-section heading="Conversation">
        <s-stack direction="block" gap="base">
          {ticket.messages.map((m) => (
            <s-box
              key={m.id}
              padding="base"
              borderRadius="base"
              borderWidth="base"
              background={m.author === "customer" ? "base" : "subdued"}
            >
              <s-stack direction="block" gap="small-200">
                <s-stack direction="inline" gap="small-200" alignItems="center">
                  <s-text type="strong">
                    {m.author === "customer" ? "Customer" : m.author === "staff" ? m.authorLabel ?? "Staff" : m.authorLabel ?? "System"}
                  </s-text>
                  <s-text color="subdued">{formatDateTime(m.createdAt)}</s-text>
                  {m.emailStatus ? (
                    <s-badge tone={m.emailStatus === "sent" ? "success" : m.emailStatus === "failed" ? "critical" : "warning"}>
                      {m.emailStatus === "sent" ? "Email sent" : m.emailStatus === "failed" ? "Email failed" : "Email not sent"}
                    </s-badge>
                  ) : null}
                </s-stack>
                <span style={{ whiteSpace: "pre-wrap" }}>{m.body}</span>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>

      <s-section heading="Reply to customer">
        <replyFetcher.Form method="post" ref={replyForm}>
          <input type="hidden" name="intent" value="reply" />
          <s-stack direction="block" gap="base">
            <s-select label="Template" name="template" value={templateKey} ref={templateSelect}>
              {templates.map((t) => (
                <s-option key={t.key} value={t.key}>
                  {t.name}
                </s-option>
              ))}
            </s-select>
            {selectedTemplate ? (
              <s-box padding="base" background="subdued" borderRadius="base">
                <s-text color="subdued">
                  <span style={{ whiteSpace: "pre-wrap" }}>{selectedTemplate.body}</span>
                </s-text>
              </s-box>
            ) : null}
            <s-text-area
              label="Your message"
              name="message"
              rows={6}
              details="Replaces {{message}} in the template. Be specific and respectful. Never ask for card numbers or passwords."
            />
            {selectedTemplate?.suggestedStatus ? (
              <s-checkbox
                name="apply_status"
                label={`Also set status to "${statusMeta(selectedTemplate.suggestedStatus).label}"`}
                defaultChecked
              />
            ) : null}
            {selectedTemplate?.suggestedStatus === "refund_issued" ? (
              <s-checkbox
                name="confirm_refund_issued"
                label="I confirm the refund was successfully issued in Shopify"
              />
            ) : null}
            <s-stack direction="inline" gap="base">
              <s-button type="submit" variant="primary" {...busy(replyFetcher)}>
                Send email
              </s-button>
            </s-stack>
          </s-stack>
        </replyFetcher.Form>
      </s-section>

      <s-section slot="aside" heading="Manage">
        <s-stack direction="block" gap="base">
          <statusFetcher.Form method="post">
            <input type="hidden" name="intent" value="status" />
            <s-stack direction="block" gap="small-200">
              <s-select label="Status" name="status" value={ticket.status} ref={statusSelect}>
                {TICKET_STATUSES.map((s) => (
                  <s-option key={s.value} value={s.value}>
                    {s.label}
                  </s-option>
                ))}
              </s-select>
              {pendingStatus === "refund_issued" ? (
                <s-checkbox name="confirm_refund_issued" label="I confirm the refund was successfully issued in Shopify" />
              ) : null}
              <s-button type="submit" {...busy(statusFetcher)}>
                Update status
              </s-button>
            </s-stack>
          </statusFetcher.Form>

          <s-divider />

          <assignFetcher.Form method="post">
            <input type="hidden" name="intent" value="assign" />
            <s-stack direction="block" gap="small-200">
              <s-select label="Assigned administrator" name="assignee" value={ticket.assignedTo ?? ""}>
                <s-option value="">Unassigned</s-option>
                {Array.from(new Set([...staffOptions, ...(ticket.assignedTo ? [ticket.assignedTo] : [])])).map((email) => (
                  <s-option key={email} value={email}>
                    {email}
                  </s-option>
                ))}
              </s-select>
              <s-button type="submit" {...busy(assignFetcher)}>
                Save assignment
              </s-button>
            </s-stack>
          </assignFetcher.Form>
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Internal notes">
        <noteFetcher.Form method="post" ref={noteForm}>
          <input type="hidden" name="intent" value="note" />
          <s-stack direction="block" gap="small-200">
            <s-text-area label="Add a note" labelAccessibilityVisibility="exclusive" name="note" rows={3} placeholder="Only visible to staff" />
            <s-button type="submit" {...busy(noteFetcher)}>
              Add note
            </s-button>
          </s-stack>
        </noteFetcher.Form>
        <s-box paddingBlockStart="base">
          <s-stack direction="block" gap="small-300">
            {ticket.notes.length === 0 ? <s-text color="subdued">No notes yet.</s-text> : null}
            {ticket.notes.map((n) => (
              <s-box key={n.id} padding="small-300" background="subdued" borderRadius="base">
                <s-stack direction="block" gap="small-100">
                  <s-text color="subdued">
                    {n.author} · {formatDateTime(n.createdAt)}
                  </s-text>
                  <span style={{ whiteSpace: "pre-wrap" }}>{n.body}</span>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        </s-box>
      </s-section>

      <s-section slot="aside" heading="Other requests from this customer">
        {related.length === 0 ? (
          <s-text color="subdued">None.</s-text>
        ) : (
          <s-stack direction="block" gap="small-200">
            {related.map((r) => (
              <s-stack key={r.id} direction="inline" gap="small-200" alignItems="center">
                <s-link href={`/app/tickets/${r.id}`}>{r.publicId}</s-link>
                <s-badge tone={statusMeta(r.status).tone}>{statusMeta(r.status).label}</s-badge>
                <s-text color="subdued">{formatDateTime(r.createdAt)}</s-text>
              </s-stack>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section slot="aside" heading="Activity log">
        <s-stack direction="block" gap="small-200">
          {auditLog.map((a) => (
            <s-text key={a.id} color="subdued">
              {formatDateTime(a.createdAt)} — {a.actor}: {a.action}
            </s-text>
          ))}
        </s-stack>
      </s-section>

      <s-section slot="aside" heading="Delete request">
        <deleteFetcher.Form method="post">
          <input type="hidden" name="intent" value="delete" />
          <s-stack direction="block" gap="small-200">
            <s-paragraph color="subdued">
              Permanently deletes this request, its messages and uploaded files (for data-deletion requests).
            </s-paragraph>
            <s-text-field label="Type DELETE to confirm" name="confirm" autocomplete="off" />
            <s-button type="submit" tone="critical" {...busy(deleteFetcher)}>
              Delete permanently
            </s-button>
          </s-stack>
        </deleteFetcher.Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
