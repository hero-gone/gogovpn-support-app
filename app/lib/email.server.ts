import nodemailer, { type Transporter } from "nodemailer";
import prisma from "../db.server";
import {
  getDefaultTemplate,
  renderTemplateText,
  textToHtml,
  type TemplateVars,
} from "./email-templates";

export type EmailStatus = "sent" | "failed" | "skipped";

export interface EmailResult {
  status: EmailStatus;
  error?: string;
}

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const url = process.env.SMTP_URL;
  transporter = url ? nodemailer.createTransport(url) : null;
  if (!transporter) {
    console.warn("[email] SMTP_URL is not set — emails will be skipped and logged.");
  }
  return transporter;
}

/** For tests. */
export function setTransporterForTesting(t: Transporter | null | undefined) {
  transporter = t;
}

export async function sendEmail(message: {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<EmailResult> {
  const t = getTransporter();
  const from = process.env.EMAIL_FROM;
  if (!t || !from) return { status: "skipped", error: "Email is not configured" };

  try {
    await t.sendMail({
      from,
      to: message.to,
      replyTo: message.replyTo ?? process.env.SUPPORT_REPLY_TO ?? undefined,
      subject: message.subject.replace(/[\r\n]+/g, " "),
      text: message.text,
      html: textToHtml(message.text),
    });
    return { status: "sent" };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[email] send failed", msg);
    return { status: "failed", error: msg.slice(0, 300) };
  }
}

export async function loadTemplate(shop: string, key: string) {
  const override = await prisma.emailTemplate.findUnique({
    where: { shop_key: { shop, key } },
  });
  const fallback = getDefaultTemplate(key);
  if (!override && !fallback) throw new Error(`Unknown email template: ${key}`);
  return {
    subject: override?.subject ?? fallback!.subject,
    body: override?.body ?? fallback!.body,
  };
}

export async function renderTemplate(shop: string, key: string, vars: TemplateVars) {
  const tpl = await loadTemplate(shop, key);
  return {
    subject: renderTemplateText(tpl.subject, vars),
    text: renderTemplateText(tpl.body, vars),
  };
}

export function baseTemplateVars(shop: string): TemplateVars {
  return {
    store_name: process.env.STORE_DISPLAY_NAME || shop.replace(/\.myshopify\.com$/, ""),
    support_email: process.env.SUPPORT_REPLY_TO || process.env.EMAIL_FROM || "",
    refund_page_url: process.env.REFUND_PAGE_URL || "",
  };
}
