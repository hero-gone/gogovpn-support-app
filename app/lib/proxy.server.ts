import type { FieldErrors } from "./validation.server";

export type ProxyResponseBody =
  | { ok: true; ticketId: string; duplicate: boolean }
  | { ok: false; error: string; message: string; fieldErrors?: FieldErrors };

export function proxyJson(body: ProxyResponseBody, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function proxyError(
  status: number,
  error: string,
  message: string,
  fieldErrors?: FieldErrors,
) {
  return proxyJson({ ok: false, error, message, ...(fieldErrors ? { fieldErrors } : {}) }, status);
}

export const GENERIC_FAILURE =
  "Something went wrong on our side and your request was not saved. Please try again in a few minutes, or email us directly.";
