export interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export interface OrderSummary {
  gid: string;
  legacyId: string;
  name: string;
  email: string | null;
  createdAt: string;
  financialStatus: string | null;
  total: string;
  refunded: string;
  currency: string;
  refundable: boolean;
  productNames: string[];
}

const ORDER_LOOKUP_QUERY = `#graphql
  query SupportOrderLookup($query: String!) {
    orders(first: 5, query: $query, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id
        legacyResourceId
        name
        email
        createdAt
        displayFinancialStatus
        refundable
        totalPriceSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount currencyCode } }
        lineItems(first: 10) { nodes { title quantity } }
      }
    }
  }
`;

interface OrderNode {
  id: string;
  legacyResourceId: string;
  name: string;
  email: string | null;
  createdAt: string;
  displayFinancialStatus: string | null;
  refundable: boolean;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: { nodes: Array<{ title: string; quantity: number }> };
}

export class OrderLookupError extends Error {}

export async function findOrderByName(
  admin: AdminGraphqlClient,
  orderName: string,
): Promise<OrderSummary | null> {
  const bare = orderName.replace(/^#/, "");
  let json: { data?: { orders?: { nodes: OrderNode[] } }; errors?: unknown };
  try {
    const response = await admin.graphql(ORDER_LOOKUP_QUERY, {
      variables: { query: `name:${JSON.stringify(bare)}` },
    });
    json = await response.json();
  } catch (error) {
    throw new OrderLookupError(
      `Shopify order lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!json.data?.orders) {
    throw new OrderLookupError(`Shopify order lookup returned no data: ${JSON.stringify(json.errors ?? null).slice(0, 300)}`);
  }

  const node = json.data.orders.nodes.find(
    (o) => o.name.replace(/^#/, "").toUpperCase() === bare.toUpperCase(),
  );
  if (!node) return null;

  return {
    gid: node.id,
    legacyId: node.legacyResourceId,
    name: node.name,
    email: node.email,
    createdAt: node.createdAt,
    financialStatus: node.displayFinancialStatus,
    total: node.totalPriceSet.shopMoney.amount,
    refunded: node.totalRefundedSet.shopMoney.amount,
    currency: node.totalPriceSet.shopMoney.currencyCode,
    refundable: node.refundable,
    productNames: node.lineItems.nodes.map((li) =>
      li.quantity > 1 ? `${li.title} × ${li.quantity}` : li.title,
    ),
  };
}

export type OwnershipResult =
  | { status: "matched"; order: OrderSummary }
  | { status: "not_matched" }
  | { status: "unavailable"; error: string };

/**
 * Never reveals to the caller whether the order exists when the email doesn't match:
 * both cases return "not_matched".
 */
export async function verifyOrderOwnership(
  admin: AdminGraphqlClient | undefined,
  orderName: string,
  email: string,
): Promise<OwnershipResult> {
  if (!admin) return { status: "unavailable", error: "No Shopify session for this shop" };
  try {
    const order = await findOrderByName(admin, orderName);
    if (!order || !order.email) return { status: "not_matched" };
    if (order.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
      return { status: "not_matched" };
    }
    return { status: "matched", order };
  } catch (error) {
    return {
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
