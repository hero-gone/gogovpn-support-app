import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { GENERIC_FAILURE, proxyError, proxyJson } from "../lib/proxy.server";
import { clientIp, consumeRateLimits, hashKey, type RateRule } from "../lib/rate-limit.server";
import { createSupportTicket } from "../lib/tickets.server";
import { detectBot, validateSupportTicket } from "../lib/validation.server";

const HOUR = 60 * 60 * 1000;

export const loader = () => proxyError(405, "method_not_allowed", "Use POST.");

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return proxyError(405, "method_not_allowed", "Use POST.");

  if (Number(request.headers.get("content-length") ?? 0) > 64 * 1024) {
    return proxyError(413, "too_large", "Your message is too long.");
  }

  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session) return proxyError(503, "not_installed", GENERIC_FAILURE);
  const shop = session.shop;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return proxyError(400, "bad_request", "We couldn't read your message. Please try again.");
  }

  const bot = detectBot(form);
  if (bot) {
    console.warn("[proxy.ticket] rejected automated submission", { shop, bot });
    return proxyError(400, "verification_failed", "Please wait a few seconds and send again.");
  }

  const parsed = validateSupportTicket(form);
  if (!parsed.ok) return proxyError(422, "invalid", "Please fix the highlighted fields.", parsed.errors);

  const ip = clientIp(request);
  const rules: RateRule[] = [
    { key: `ticket:email:${hashKey(parsed.data.email)}`, limit: 6, windowMs: 24 * HOUR },
    { key: `ticket:shop:${shop}`, limit: 300, windowMs: HOUR },
  ];
  if (ip !== "unknown") rules.push({ key: `ticket:ip:${hashKey(ip)}`, limit: 10, windowMs: HOUR });
  if (!(await consumeRateLimits(rules))) {
    return proxyError(429, "rate_limited", "You've sent several messages recently. Please wait a while, or email us directly.");
  }

  try {
    const result = await createSupportTicket({ shop, admin, input: parsed.data });
    if (result.kind === "order_not_matched") throw new Error("unexpected order_not_matched for support ticket");
    return proxyJson(
      { ok: true, ticketId: result.publicId, duplicate: result.kind === "duplicate" },
      result.kind === "created" ? 201 : 200,
    );
  } catch (error) {
    console.error("[proxy.ticket] failed to create ticket", { shop }, error);
    return proxyError(500, "server_error", GENERIC_FAILURE);
  }
};
