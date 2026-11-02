import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import type { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { requireStaff } from "../lib/staff.server";
import { getDashboardStats } from "../lib/tickets.server";
import {
  REFUND_REASONS,
  TICKET_STATUSES,
  TICKET_TYPES,
  isTicketStatus,
  reasonLabel,
  statusMeta,
  topicLabel,
} from "../lib/constants";
import { formatDateTime, formatDuration } from "../lib/format";

const PAGE_SIZE = 25;

const SORTS = {
  newest: { createdAt: "desc" },
  oldest: { createdAt: "asc" },
  updated: { updatedAt: "desc" },
} as const satisfies Record<string, Prisma.TicketOrderByWithRelationInput>;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await requireStaff(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const status = url.searchParams.get("status") ?? "";
  const type = url.searchParams.get("type") ?? "";
  const reason = url.searchParams.get("reason") ?? "";
  const sortParam = url.searchParams.get("sort") ?? "newest";
  const sort = (sortParam in SORTS ? sortParam : "newest") as keyof typeof SORTS;
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);

  const where: Prisma.TicketWhereInput = { shop };
  if (status === "open") where.status = { notIn: ["refund_issued", "resolved", "declined"] };
  else if (isTicketStatus(status)) where.status = status;
  if (TICKET_TYPES.some((t) => t.value === type)) where.type = type;
  if (REFUND_REASONS.some((r) => r.value === reason)) where.reason = reason;
  if (q) {
    where.OR = [
      { publicId: { contains: q.toUpperCase() } },
      { orderName: { contains: q.replace(/^#/, "").toUpperCase() } },
      { customerEmail: { contains: q.toLowerCase() } },
    ];
  }

  const [rows, stats] = await Promise.all([
    prisma.ticket.findMany({
      where,
      orderBy: SORTS[sort],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
      select: {
        id: true,
        publicId: true,
        type: true,
        status: true,
        customerEmail: true,
        orderName: true,
        orderVerified: true,
        reason: true,
        topic: true,
        createdAt: true,
        assignedTo: true,
      },
    }),
    getDashboardStats(shop),
  ]);

  return {
    tickets: rows.slice(0, PAGE_SIZE),
    hasNextPage: rows.length > PAGE_SIZE,
    page,
    filters: { q, status, type, reason, sort },
    stats,
  };
};

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base" background="base">
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{String(value)}</s-heading>
        {hint ? <s-text color="subdued">{hint}</s-text> : null}
      </s-stack>
    </s-box>
  );
}

export default function RequestsDashboard() {
  const { tickets, hasNextPage, page, filters, stats } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const loading = navigation.state === "loading";

  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && params.set(k, v));
    params.set("page", String(target));
    return `/app?${params.toString()}`;
  };

  const hasFilters = Boolean(filters.q || filters.status || filters.type || filters.reason);

  return (
    <s-page heading="Support & Refunds">
      <s-section heading="Overview">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
          <StatCard label="Total requests" value={stats.total} />
          <StatCard label="New — awaiting review" value={stats.newCount} />
          <StatCard label="Waiting for customer" value={stats.waitingCustomer} />
          <StatCard label="Refunds approved" value={stats.refundApproved} />
          <StatCard label="Refunds issued" value={stats.refundIssued} />
          <StatCard label="Avg. first response" value={formatDuration(stats.avgFirstResponseMs)} />
          <StatCard label="Avg. resolution time" value={formatDuration(stats.avgResolutionMs)} />
          <StatCard label="Later became chargebacks" value="—" hint="Tracked in Phase 4" />
        </s-grid>
      </s-section>

      <s-section heading="Requests" padding="none">
        <s-box padding="base">
          <Form method="get">
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(170px, 1fr))" gap="base" alignItems="end">
              <s-search-field
                label="Search"
                name="q"
                placeholder="Request ID, order # or email"
                value={filters.q}
              />
              <s-select label="Status" name="status" value={filters.status}>
                <s-option value="">All statuses</s-option>
                <s-option value="open">All open</s-option>
                {TICKET_STATUSES.map((s) => (
                  <s-option key={s.value} value={s.value}>
                    {s.label}
                  </s-option>
                ))}
              </s-select>
              <s-select label="Type" name="type" value={filters.type}>
                <s-option value="">All types</s-option>
                {TICKET_TYPES.map((t) => (
                  <s-option key={t.value} value={t.value}>
                    {t.label}
                  </s-option>
                ))}
              </s-select>
              <s-select label="Refund reason" name="reason" value={filters.reason}>
                <s-option value="">All reasons</s-option>
                {REFUND_REASONS.map((r) => (
                  <s-option key={r.value} value={r.value}>
                    {r.label}
                  </s-option>
                ))}
              </s-select>
              <s-select label="Sort" name="sort" value={filters.sort}>
                <s-option value="newest">Newest first</s-option>
                <s-option value="oldest">Oldest first</s-option>
                <s-option value="updated">Recently updated</s-option>
              </s-select>
              <s-stack direction="inline" gap="small-200">
                <s-button type="submit" variant="primary" {...(loading ? { loading: true } : {})}>
                  Apply
                </s-button>
                {hasFilters ? (
                  <s-button href="/app" variant="tertiary">
                    Clear
                  </s-button>
                ) : null}
              </s-stack>
            </s-grid>
          </Form>
        </s-box>

        {tickets.length === 0 ? (
          <s-box padding="large-200">
            <s-stack direction="block" gap="small-200" alignItems="center">
              <s-heading>{hasFilters ? "No requests match these filters" : "No requests yet"}</s-heading>
              <s-paragraph color="subdued">
                {hasFilters
                  ? "Try a different search or clear the filters."
                  : "Refund requests and chat tickets from your storefront will appear here."}
              </s-paragraph>
            </s-stack>
          </s-box>
        ) : (
          <s-table {...(loading ? { loading: true } : {})}>
            <s-table-header-row>
              <s-table-header listSlot="primary">Request</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
              <s-table-header>Type</s-table-header>
              <s-table-header listSlot="secondary">Customer</s-table-header>
              <s-table-header>Order</s-table-header>
              <s-table-header>Reason / topic</s-table-header>
              <s-table-header>Assigned</s-table-header>
              <s-table-header>Created</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {tickets.map((t) => {
                const meta = statusMeta(t.status);
                return (
                  <s-table-row key={t.id} clickDelegate={`ticket-${t.id}`}>
                    <s-table-cell>
                      <s-link id={`ticket-${t.id}`} href={`/app/tickets/${t.id}`}>
                        {t.publicId}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={meta.tone}>{meta.label}</s-badge>
                    </s-table-cell>
                    <s-table-cell>{t.type === "refund" ? "Refund" : "Support"}</s-table-cell>
                    <s-table-cell>{t.customerEmail}</s-table-cell>
                    <s-table-cell>
                      {t.orderName ? (
                        <s-stack direction="inline" gap="small-200" alignItems="center">
                          <s-text>{t.orderName}</s-text>
                          {t.orderVerified ? (
                            <s-badge tone="success" size="base">Verified</s-badge>
                          ) : (
                            <s-badge tone="warning" size="base">Unverified</s-badge>
                          )}
                        </s-stack>
                      ) : (
                        "—"
                      )}
                    </s-table-cell>
                    <s-table-cell>{t.reason ? reasonLabel(t.reason) : topicLabel(t.topic)}</s-table-cell>
                    <s-table-cell>{t.assignedTo ?? "—"}</s-table-cell>
                    <s-table-cell>{formatDateTime(t.createdAt)}</s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}

        {(page > 1 || hasNextPage) && (
          <s-box padding="base">
            <s-stack direction="inline" gap="base" justifyContent="center">
              {page > 1 ? <s-button href={pageHref(page - 1)}>Previous</s-button> : null}
              <s-text color="subdued">Page {page}</s-text>
              {hasNextPage ? <s-button href={pageHref(page + 1)}>Next</s-button> : null}
            </s-stack>
          </s-box>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
