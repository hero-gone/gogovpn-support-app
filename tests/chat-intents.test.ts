import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type Detected = { refund: boolean; intent: string | null };
type Reply = { text: string; actions: Array<{ type: string; label: string; href?: string; primary?: boolean }> };

const sandbox: Record<string, unknown> = {};
vm.runInNewContext(readFileSync("extensions/support-widget/assets/support-chat-app.js", "utf8"), sandbox);
const api = sandbox.VanishedSupportIntents as {
  detectIntent: (t: string) => Detected;
  buildReply: (d: Detected, cfg: Record<string, string>) => Reply;
};

const cfg = {
  refundUrl: "/pages/refund-request",
  faqUrl: "/pages/faq",
  howtoUrl: "/pages/how-to-use",
  shopName: "gogoVPN",
  responseTime: "within 24 hours",
};

describe("refund keyword detection", () => {
  const refundMessages = [
    "I want a refund",
    "REFUND PLEASE",
    "can i get my money back?",
    "How do I get refunded",
    "I need a refound",
    "I'll file a chargeback",
    "I want to dispute this charge",
    "please cancel my order",
    "I want my money",
    "reimbursement please",
    "quiero un reembolso",
    "je veux un remboursement",
    "Ich möchte eine Rückerstattung",
    "我要退款",
    "the key doesn't work, I want a refund",
  ];
  it.each(refundMessages)("detects refund intent in %j", (msg) => {
    expect(api.detectIntent(msg).refund).toBe(true);
  });

  const nonRefund = [
    "hello",
    "How do I install on Android?",
    "My activation key doesn't work",
    "I can't connect to any server",
    "Is it compatible with my Mac?",
    "Where can I find the return key on the keyboard",
  ];
  it.each(nonRefund)("does not flag %j as refund", (msg) => {
    expect(api.detectIntent(msg).refund).toBe(false);
  });
});

describe("replies", () => {
  it("shows a primary Request a Refund button linking to the refund page", () => {
    const reply = api.buildReply(api.detectIntent("I want a refund"), cfg);
    const refund = reply.actions.find((a) => a.label === "Request a Refund");
    expect(refund).toMatchObject({ type: "link", href: "/pages/refund-request", primary: true });
  });

  it("offers technical help alongside the refund button when a problem is mentioned", () => {
    const reply = api.buildReply(api.detectIntent("my key is invalid, refund me"), cfg);
    expect(reply.text).toMatch(/troubleshoot/);
    expect(reply.actions.some((a) => a.label === "Request a Refund")).toBe(true);
  });

  it("never claims an agent is online or that a refund was processed", () => {
    const messages = ["I want a refund", "talk to a human", "random question about cats", "charged twice"];
    for (const m of messages) {
      const { text } = api.buildReply(api.detectIntent(m), cfg);
      expect(text).not.toMatch(/agent is online|online now|refund (has been|was) (issued|processed|approved)/i);
    }
  });

  it("routes common issues to the right intent", () => {
    expect(api.detectIntent("I didn't receive my activation key").intent).toBe("key_not_received");
    expect(api.detectIntent("my code is invalid").intent).toBe("key_not_working");
    expect(api.detectIntent("it keeps disconnecting").intent).toBe("connection");
    expect(api.detectIntent("how do I install it").intent).toBe("install");
    expect(api.detectIntent("does it work on iPhone").intent).toBe("compatibility");
    expect(api.detectIntent("I was charged twice").intent).toBe("billing");
    expect(api.detectIntent("can I talk to a human").intent).toBe("human");
  });
});
