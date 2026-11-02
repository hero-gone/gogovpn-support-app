# gogoVPN Support & Refunds

Private Shopify app for **gogoVPN** (vpn-vanish store). Chat + refund tickets.

Deploy: see [`docs/DEPLOY-HOSTINGER.md`](docs/DEPLOY-HOSTINGER.md).

---

# Original notes (VPN Vanished)

A private (single-store) Shopify app that gives customers an easy, trustworthy way to get help or request a refund **before** they go to their bank, and gives staff one place to manage every request.

It has three parts:

| Part | Where it runs | What it does |
|---|---|---|
| **Support chat** (theme app embed) | Every storefront page | Floating "Help" button. Automated assistant answers common questions; detects refund wording ("refund", "money back", "chargeback", "reembolso", "退款"…) and shows a **Request a Refund** button. Customers can create a support ticket (gets an `ST-` ID). |
| **Refund request form** (theme app block) | `/pages/refund-request` | Order #, email, product, amount, reason, description, optional screenshot/video, accuracy checkbox. Verifies order + email against Shopify on the server. Gives an `RR-` request ID. |
| **Admin dashboard** (embedded app) | Shopify Admin → Apps → Support & Refunds | Summary metrics, search/filter/sort, ticket detail with order data, private evidence viewer, conversation, internal notes, assignment, 8 statuses, templated email replies, audit log, permanent delete. |

Storefront → app traffic goes through a **Shopify app proxy** (`https://vpnvanished.com/apps/support/*`). Shopify signs every proxied request; the app verifies the signature. No Shopify token ever reaches the browser.

```
Customer browser ──► vpnvanished.com/apps/support/refund ──(signed by Shopify)──► this app /proxy/refund
                                                                                  │  verify signature
                                                                                  │  validate + rate-limit + spam checks
                                                                                  │  Admin API: order exists & email matches?
                                                                                  │  save ticket + private files
                                                                                  └► email customer + admin
Staff ──► Shopify Admin (embedded app, session-token auth) ──► dashboard / ticket actions (audited)
```

## Status by phase

| Phase | Scope | Status |
|---|---|---|
| 1 | Refund page, secure submission, email notifications, admin ticket management | **Built & tested** (see Testing) |
| 2 | Purchase-email link, support chat, order lookup | **Built** — email snippet must be pasted manually (Shopify doesn't allow apps to edit notification templates) |
| 3 | In-app Shopify refunds with duplicate protection; activation/delivery evidence | Not started — refunds are issued from the Shopify order page (button in each ticket). Needs `write_orders` and details of how keys are delivered. |
| 4 | Chargeback analytics | Not started — needs `read_shopify_payments_disputes`. Dashboard shows "—" for chargeback metrics until then. |

## Setup (first time)

Requirements: Node **22** (`brew install node@22`, then `export PATH=/opt/homebrew/opt/node@22/bin:$PATH`), Shopify CLI, a Shopify Partner / Dev Dashboard account with access to the store.

```bash
npm install
cp .env.example .env            # fill in at least DATABASE_URL (already set for local)
npx prisma migrate deploy
npm run config:link             # create/link the app in the Shopify Dev Dashboard (fills client_id)
npm run dev                     # opens a tunnel, installs on your dev/live store
```

Then in **Shopify Admin**:

1. **Install & approve** the app (scopes: `read_orders`). In the Dev Dashboard, under *API access → Protected customer data*, request access to **Email** (needed to match the order email). For a single-store custom app this is self-service.
2. **Enable the chat:** Online Store → Themes → Customize → *App embeds* → turn on **Support chat**. Set support hours / response time.
3. **Create the refund page:** Online Store → Pages → Add page. Title "Request a Refund", handle `refund-request`, template **`page.refund-request`** (included in the theme changes).
4. **Add the form:** Customize → switch to the *Request a Refund* page → in the *Content page* section, *Add block* → Apps → **Refund request form**. Drag it where you want it.
5. **Purchase email:** paste [`docs/order-confirmation-snippet.liquid`](docs/order-confirmation-snippet.liquid) into Settings → Notifications → *Order confirmation* (instructions in the file). Send yourself a test email.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES` | yes | Set automatically by `shopify app dev`; set manually in production (`SCOPES=read_orders`) |
| `DATABASE_URL` | yes | `file:dev.sqlite` locally; `file:/data/prod.sqlite` on a persistent volume in production |
| `SMTP_URL` | for email | Any SMTP provider, e.g. `smtps://resend:re_xxx@smtp.resend.com:465` |
| `EMAIL_FROM` | for email | Verified sender, e.g. `VPN Vanished Support <support@vpnvanished.com>` |
| `SUPPORT_REPLY_TO` | optional | Where customer replies go |
| `ADMIN_NOTIFY_EMAIL` | recommended | Who gets new-request alerts |
| `STORE_DISPLAY_NAME`, `REFUND_PAGE_URL` | recommended | Used in email text |
| `ADMIN_ALLOWED_EMAILS` | optional | Restrict the dashboard to these staff emails (comma-separated) |
| `UPLOAD_DIR` | yes in prod | Private, persistent, **not web-served** directory for screenshots/videos |

If SMTP isn't configured, tickets are still saved; each email attempt is recorded as *sent / failed / not sent* in the ticket and the audit log, so nothing is silently lost.

## Deploying

**Hostinger (GitHub → Node.js app):** follow [`docs/DEPLOY-HOSTINGER.md`](docs/DEPLOY-HOSTINGER.md). `npm run build` then `npm start` (runs `server.mjs`: creates the data folder, applies migrations, serves on `PORT`).

**Docker hosts (Fly.io, Railway, VPS):** at this volume a single small container with SQLite on a persistent volume is reliable and cheapest (~US$3–6/month on Fly.io or Railway). The included `Dockerfile` runs migrations on start.

```bash
fly launch --no-deploy                       # or your host's equivalent
fly volumes create data --size 3
# mount the volume at /data in fly.toml, then:
fly secrets set SHOPIFY_API_KEY=... SHOPIFY_API_SECRET=... SHOPIFY_APP_URL=https://<app>.fly.dev \
  SCOPES=read_orders DATABASE_URL=file:/data/prod.sqlite UPLOAD_DIR=/data/uploads \
  SMTP_URL=... EMAIL_FROM=... ADMIN_NOTIFY_EMAIL=...
fly deploy
npm run deploy                               # pushes app config + theme extension to Shopify
```

Keep **one** instance while on SQLite. Enable volume snapshots/backups. To move to Postgres later, change `provider` in `prisma/schema.prisma` and regenerate migrations.

## Security & privacy

- **Order privacy:** customers never receive order data from the server. A wrong email and a non-existent order produce the same response. Mismatches can still be submitted "for manual review" and are flagged **Unverified** for staff.
- **Uploads:** type detected from file bytes (PNG/JPEG/WebP, MP4/MOV/WebM only; SVG/HTML rejected even if renamed), size-limited (5 MB / 20 MB), random filenames, stored outside the web root with `0600` permissions, served only to authenticated staff of the same shop with `no-store`, `nosniff` and a sandbox CSP. Each view is audit-logged.
- **Abuse:** Shopify proxy signature, honeypot, minimum fill-time, per-email / per-IP / per-shop rate limits (DB-backed), idempotency keys (retries return the same ID), one open refund request per order+email.
- **Sensitive data:** forms tell customers never to send card numbers/passwords; Luhn-valid card numbers are automatically redacted.
- **Staff access:** embedded-app session tokens (no cookies → CSRF-resistant), online tokens identify each staff member for the audit log; optional email allowlist. Marking a ticket *Refund Issued* requires confirming the refund was actually issued in Shopify.
- **Output encoding:** storefront widgets build DOM with `textContent` only; admin is React (auto-escaped); emails escape all values.
- **Data deletion:** "Delete permanently" on a ticket removes messages, notes and files (audit entry kept without customer content).

## Maintenance

- Tests: `npm test` (uses a throwaway SQLite DB). Lint/types: `npm run lint && npm run typecheck`.
- Edit email wording in the app: **Email templates** page (per-shop overrides, reset to default anytime).
- Retention: decide a retention period (e.g. 24 months after resolution) and delete old tickets from the dashboard; automated purge is a planned addition. The `RateLimitHit` table only needs the last 48 hours (`pruneRateLimitHits()` in `app/lib/rate-limit.server.ts`).
- Logs: server logs are prefixed `[proxy.refund]`, `[proxy.ticket]`, `[email]`, `[tickets]`, `[audit]`.

## Testing

`npm test` runs 68 automated tests, including end-to-end tests of the proxy endpoints with real Shopify-style signatures and a stubbed Admin API:

- invalid signature rejected; valid submission → verified ticket, stored order details, attachment, customer + admin emails
- mismatched email / unknown order → identical error with no order data; manual-review path → unverified ticket
- Shopify outage → request still accepted (unverified)
- idempotent retries, duplicate open requests, honeypot / too-fast bots, invalid fields, rate limiting
- disguised HTML-as-PNG upload rejected; SVG rejected; path-traversal storage keys rejected
- SMTP failure → ticket kept, failure recorded
- chat refund-keyword detection in several languages and phrasing; no false "agent online"/"refund processed" claims

The storefront chat and refund form were also rendered in headless Chrome at phone/tablet/desktop sizes against the live theme CSS.

**Not yet verified (needs your Shopify account):** running inside Shopify Admin (embedded dashboard UI), the live app proxy on vpnvanished.com (including how large a video Shopify's proxy will pass through), real email delivery from your SMTP provider, and Protected Customer Data approval. Test these on the store after `npm run dev` before announcing the page.
