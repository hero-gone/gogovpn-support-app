import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { UPLOAD_LIMITS } from "../lib/constants";
import { GENERIC_FAILURE, proxyError, proxyJson } from "../lib/proxy.server";
import { clientIp, consumeRateLimits, hashKey, type RateRule } from "../lib/rate-limit.server";
import { createRefundTicket } from "../lib/tickets.server";
import { validateUpload, type ValidatedUpload } from "../lib/uploads.server";
import { detectBot, validateRefundRequest } from "../lib/validation.server";

const HOUR = 60 * 60 * 1000;

export const loader = () => proxyError(405, "method_not_allowed", "Use POST.");

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return proxyError(405, "method_not_allowed", "Use POST.");

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > UPLOAD_LIMITS.requestMaxBytes) {
    return proxyError(413, "too_large", "Your files are too large. Screenshots can be up to 5 MB and videos up to 20 MB.");
  }

  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session) {
    return proxyError(503, "not_installed", GENERIC_FAILURE);
  }
  const shop = session.shop;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return proxyError(400, "bad_request", "We couldn't read your submission. Please try again.");
  }

  const bot = detectBot(form);
  if (bot) {
    console.warn("[proxy.refund] rejected automated submission", { shop, bot });
    return proxyError(400, "verification_failed", "Please wait a few seconds and submit the form again.");
  }

  const parsed = validateRefundRequest(form);
  if (!parsed.ok) {
    return proxyError(422, "invalid", "Please fix the highlighted fields.", parsed.errors);
  }
  const input = parsed.data;

  const uploads: ValidatedUpload[] = [];
  const fieldErrors: Record<string, string> = {};
  for (const [field, kind] of [["screenshot", "image"], ["video", "video"]] as const) {
    const result = await validateUpload(form.get(field), kind);
    if (!result.ok) fieldErrors[field] = result.error;
    else if (result.file) uploads.push(result.file);
  }
  if (Object.keys(fieldErrors).length) {
    return proxyError(422, "invalid_upload", "Please check your attachments.", fieldErrors);
  }

  const ip = clientIp(request);
  const rules: RateRule[] = [
    { key: `refund:email:${hashKey(input.email)}`, limit: 5, windowMs: 24 * HOUR },
    { key: `refund:shop:${shop}`, limit: 300, windowMs: HOUR },
  ];
  if (ip !== "unknown") rules.push({ key: `refund:ip:${hashKey(ip)}`, limit: 8, windowMs: HOUR });
  if (!(await consumeRateLimits(rules))) {
    return proxyError(429, "rate_limited", "You've sent several requests recently. Please wait an hour, or email us directly.");
  }

  try {
    const result = await createRefundTicket({ shop, admin, input, uploads });
    switch (result.kind) {
      case "created":
        return proxyJson({ ok: true, ticketId: result.publicId, duplicate: false }, 201);
      case "duplicate":
        return proxyJson({ ok: true, ticketId: result.publicId, duplicate: true });
      case "order_not_matched":
        return proxyError(
          422,
          "order_not_matched",
          "We couldn't find an order with that order number and email address. Please check your order confirmation email. If the details are correct, you can still submit your request for manual review.",
        );
    }
  } catch (error) {
    console.error("[proxy.refund] failed to create ticket", { shop }, error);
    return proxyError(500, "server_error", GENERIC_FAILURE);
  }
};
