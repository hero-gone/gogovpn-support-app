import prisma from "../db.server";

export async function audit(entry: {
  shop: string;
  actor: string;
  action: string;
  ticketId?: string | null;
  details?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        shop: entry.shop,
        actor: entry.actor,
        action: entry.action,
        ticketId: entry.ticketId ?? null,
        details: entry.details ? JSON.stringify(entry.details) : null,
      },
    });
  } catch (error) {
    console.error("[audit] failed to write audit log", entry.action, error);
  }
}
