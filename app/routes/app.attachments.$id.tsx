import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { audit } from "../lib/audit.server";
import { requireStaff } from "../lib/staff.server";
import { readUpload } from "../lib/uploads.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session, staff } = await requireStaff(request);

  const attachment = await prisma.attachment.findFirst({
    where: { id: params.id, ticket: { shop: session.shop } },
    select: { id: true, ticketId: true, storageKey: true, mimeType: true, originalName: true },
  });
  if (!attachment) throw new Response("Not found", { status: 404 });

  let file: Buffer;
  try {
    file = await readUpload(attachment.storageKey);
  } catch (error) {
    console.error("[attachments] file missing", attachment.id, error);
    throw new Response("File not available", { status: 410 });
  }

  await audit({
    shop: session.shop,
    actor: staff.email ?? staff.label,
    action: "attachment.viewed",
    ticketId: attachment.ticketId,
    details: { attachmentId: attachment.id },
  });

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(file.byteLength),
      "Content-Disposition": `inline; filename="${attachment.originalName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
};
