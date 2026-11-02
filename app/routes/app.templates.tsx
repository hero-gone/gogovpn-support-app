import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { audit } from "../lib/audit.server";
import { requireStaff } from "../lib/staff.server";
import { DEFAULT_TEMPLATES, TEMPLATE_PLACEHOLDERS, getDefaultTemplate } from "../lib/email-templates";

type ActionResult = { ok: boolean; message: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await requireStaff(request);
  const overrides = await prisma.emailTemplate.findMany({ where: { shop: session.shop } });
  return {
    templates: DEFAULT_TEMPLATES.map((t) => {
      const o = overrides.find((x) => x.key === t.key);
      return {
        key: t.key,
        name: t.name,
        audience: t.audience,
        subject: o?.subject ?? t.subject,
        body: o?.body ?? t.body,
        customized: Boolean(o),
        updatedBy: o?.updatedBy ?? null,
      };
    }),
  };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<ActionResult> => {
  const { session, staff } = await requireStaff(request);
  const form = await request.formData();
  const key = String(form.get("key") ?? "");
  if (!getDefaultTemplate(key)) return { ok: false, message: "Unknown template." };
  const actor = staff.email ?? staff.label;

  if (form.get("intent") === "reset") {
    await prisma.emailTemplate.deleteMany({ where: { shop: session.shop, key } });
    await audit({ shop: session.shop, actor, action: "template.reset", details: { key } });
    return { ok: true, message: "Template reset to default." };
  }

  const subject = String(form.get("subject") ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const body = String(form.get("body") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 10000);
  if (!subject || !body) return { ok: false, message: "Subject and body are required." };

  await prisma.emailTemplate.upsert({
    where: { shop_key: { shop: session.shop, key } },
    create: { shop: session.shop, key, subject, body, updatedBy: actor },
    update: { subject, body, updatedBy: actor },
  });
  await audit({ shop: session.shop, actor, action: "template.updated", details: { key } });
  return { ok: true, message: "Template saved." };
};

function TemplateEditor({ template }: { template: ReturnType<typeof useLoaderData<typeof loader>>["templates"][number] }) {
  const fetcher = useFetcher<ActionResult>();
  const shopify = useAppBridge();
  useEffect(() => {
    if (fetcher.data?.message) shopify.toast.show(fetcher.data.message, { isError: !fetcher.data.ok });
  }, [fetcher.data, shopify]);

  return (
    <s-section heading={template.name}>
      <s-stack direction="block" gap="base">
        <s-stack direction="inline" gap="small-200">
          {template.audience === "internal" ? <s-badge>Internal</s-badge> : <s-badge tone="info">Customer</s-badge>}
          {template.customized ? <s-badge tone="success">Customized</s-badge> : <s-badge>Default</s-badge>}
        </s-stack>
        <fetcher.Form method="post" key={`${template.key}-${template.customized}-${template.subject}`}>
          <input type="hidden" name="key" value={template.key} />
          <input type="hidden" name="intent" value="save" />
          <s-stack direction="block" gap="base">
            <s-text-field label="Subject" name="subject" defaultValue={template.subject} />
            <s-text-area label="Body" name="body" rows={12} defaultValue={template.body} />
            <s-button type="submit" variant="primary" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
              Save
            </s-button>
          </s-stack>
        </fetcher.Form>
        {template.customized ? (
          <fetcher.Form method="post">
            <input type="hidden" name="key" value={template.key} />
            <input type="hidden" name="intent" value="reset" />
            <s-button type="submit" variant="tertiary">
              Reset to default
            </s-button>
          </fetcher.Form>
        ) : null}
      </s-stack>
    </s-section>
  );
}

export default function Templates() {
  const { templates } = useLoaderData<typeof loader>();
  return (
    <s-page heading="Email templates">
      <s-section slot="aside" heading="Placeholders">
        <s-stack direction="block" gap="small-200">
          <s-paragraph color="subdued">These are replaced when an email is sent:</s-paragraph>
          {TEMPLATE_PLACEHOLDERS.map((p) => (
            <s-text key={p}>{`{{${p}}}`}</s-text>
          ))}
          <s-paragraph color="subdued">
            Keep a respectful, helpful tone. Offer troubleshooting before declining, and never discourage customers from
            contacting their bank or payment provider.
          </s-paragraph>
        </s-stack>
      </s-section>
      {templates.map((t) => (
        <TemplateEditor key={t.key} template={t} />
      ))}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
