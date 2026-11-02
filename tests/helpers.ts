import { vi } from "vitest";
import type { AdminGraphqlClient } from "../app/lib/orders.server";

export function orderNode(overrides: Partial<{ name: string; email: string | null; total: string; refunded: string }> = {}) {
  return {
    id: "gid://shopify/Order/5550001",
    legacyResourceId: "5550001",
    name: overrides.name ?? "#1001",
    email: overrides.email === undefined ? "buyer@example.com" : overrides.email,
    createdAt: "2026-10-10T08:00:00Z",
    displayFinancialStatus: "PAID",
    refundable: true,
    totalPriceSet: { shopMoney: { amount: overrides.total ?? "14.99", currencyCode: "USD" } },
    totalRefundedSet: { shopMoney: { amount: overrides.refunded ?? "0.0", currencyCode: "USD" } },
    lineItems: { nodes: [{ title: "Lifetime VPN Activation Key", quantity: 1 }] },
  };
}

export function mockAdmin(nodes: ReturnType<typeof orderNode>[]) {
  return {
    graphql: vi.fn(async () => Response.json({ data: { orders: { nodes } } })),
  } satisfies AdminGraphqlClient;
}
