import { describe, expect, it, vi } from "vitest";
import { verifyOrderOwnership, type AdminGraphqlClient } from "../app/lib/orders.server";
import { mockAdmin, orderNode } from "./helpers";

describe("verifyOrderOwnership", () => {
  it("matches when the order exists and the email matches (case-insensitive)", async () => {
    const admin = mockAdmin([orderNode({ name: "#1001", email: "Buyer@Example.com" })]);
    const result = await verifyOrderOwnership(admin, "#1001", "buyer@example.com");
    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.order.total).toBe("14.99");
      expect(result.order.productNames).toEqual(["Lifetime VPN Activation Key"]);
    }
  });

  it("returns not_matched (without order data) when the email differs", async () => {
    const admin = mockAdmin([orderNode({ name: "#1001", email: "owner@example.com" })]);
    const result = await verifyOrderOwnership(admin, "#1001", "attacker@example.com");
    expect(result).toEqual({ status: "not_matched" });
  });

  it("returns the same not_matched when the order does not exist", async () => {
    const admin = mockAdmin([]);
    expect(await verifyOrderOwnership(admin, "#9999", "a@b.co")).toEqual({ status: "not_matched" });
  });

  it("does not match a different order that merely contains the number", async () => {
    const admin = mockAdmin([orderNode({ name: "#10011", email: "a@b.co" })]);
    expect(await verifyOrderOwnership(admin, "#1001", "a@b.co")).toEqual({ status: "not_matched" });
  });

  it("passes the order name as a quoted search term", async () => {
    const admin = mockAdmin([]);
    await verifyOrderOwnership(admin, "#1001", "a@b.co");
    expect(admin.graphql).toHaveBeenCalledWith(expect.any(String), { variables: { query: 'name:"1001"' } });
  });

  it("reports unavailable when Shopify errors, instead of rejecting the customer", async () => {
    const admin: AdminGraphqlClient = { graphql: vi.fn().mockRejectedValue(new Error("Throttled")) };
    const result = await verifyOrderOwnership(admin, "#1001", "a@b.co");
    expect(result.status).toBe("unavailable");
  });

  it("reports unavailable without a Shopify session", async () => {
    expect((await verifyOrderOwnership(undefined, "#1001", "a@b.co")).status).toBe("unavailable");
  });
});
