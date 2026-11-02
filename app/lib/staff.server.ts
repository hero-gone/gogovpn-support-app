import { authenticate } from "../shopify.server";

export interface StaffIdentity {
  id: string;
  email: string | null;
  label: string;
}

function allowedEmails(): string[] {
  return (process.env.ADMIN_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Authenticates an embedded-admin request and returns the staff member behind it.
 * Shopify already limits app access to staff with permission for this app; when
 * ADMIN_ALLOWED_EMAILS is set, access is further restricted to those staff emails.
 */
export async function requireStaff(request: Request) {
  const context = await authenticate.admin(request);
  const user = context.session.onlineAccessInfo?.associated_user;

  const email = user?.email?.toLowerCase() ?? null;
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ");
  const staff: StaffIdentity = {
    id: user?.id ? String(user.id) : "unknown",
    email,
    label: name || email || (user?.id ? `Staff ${user.id}` : "Staff"),
  };

  const allow = allowedEmails();
  if (allow.length && (!email || !allow.includes(email))) {
    throw new Response("You don't have access to Support & Refunds. Ask the store owner to add your email to ADMIN_ALLOWED_EMAILS.", {
      status: 403,
    });
  }

  return { ...context, staff };
}
