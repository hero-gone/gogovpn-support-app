# Deploy gogoVPN Support & Refunds (GitHub → Hostinger)

Use a **new private GitHub repo** and a **new Hostinger Node.js site**. Do not push this to the old vpnvanished GitHub repo — that store’s auto-deploy would break.

The theme stays on Shopify. This app is only chat + refund tickets.

## 1. Push to GitHub

1. github.com → **New repository** → `gogovpn-support-app` → **Private** → do not add a README.
2. On your Mac:

```bash
cd "/Users/Apple/Projects/shopify vpn/gogovpn-support-app"
git remote add origin https://github.com/YOUR-USER/gogovpn-support-app.git
git branch -M main
git push -u origin main
```

`.env` and uploads are git-ignored. Secrets go only in Hostinger.

## 2. Create the Shopify app in the **vpn-vanish** org

1. Log into **vpn-vanish** admin.
2. **Settings → Apps → Develop apps → Build apps in Dev Dashboard**.
3. **Create app** → name `gogoVPN Support & Refunds`.
4. Copy **Client ID** and **Client secret** (secret once).

On your Mac:

```bash
cd "/Users/Apple/Projects/shopify vpn/gogovpn-support-app"
shopify app config link --reset
```

Pick the **vpn-vanish** organization and this new app (not badrshop).

## 3. Hostinger Node.js site (new site is OK; same account)

hPanel → **Websites → Add website → Node.js**:

| Setting | Value |
|---|---|
| Node.js | **22.x** |
| Git repo | your private `gogovpn-support-app` |
| Branch | `main` |
| Build | `npm run build` |
| Start | `npm start` |

Use the Hostinger URL you get (example `https://something.hostingersite.com`) **or** a subdomain like `support.yourdomain.com`.

## 4. Hostinger environment variables

Replace paths with your Hostinger home path (`/home/uXXXXXX`):

```
NODE_ENV=production
SHOPIFY_API_KEY=<new Client ID>
SHOPIFY_API_SECRET=<new Client secret>
SHOPIFY_APP_URL=https://YOUR-HOSTINGER-URL
SCOPES=read_orders
DATABASE_URL=file:/home/uXXXXXX/gogovpn-support-data/prod.sqlite
UPLOAD_DIR=/home/uXXXXXX/gogovpn-support-data/uploads
SMTP_URL=
EMAIL_FROM=gogoVPN Support <support@yourdomain.com>
SUPPORT_REPLY_TO=support@yourdomain.com
ADMIN_NOTIFY_EMAIL=you@example.com
STORE_DISPLAY_NAME=gogoVPN
REFUND_PAGE_URL=https://YOUR-SHOP.myshopify.com/pages/refund-request
```

Restart the Node app.

## 5. Point Shopify at Hostinger

Edit `shopify.app.toml` and replace `REPLACE-WITH-HOSTINGER-URL` with the real `https://` URL (no trailing slash). Then:

```bash
cd "/Users/Apple/Projects/shopify vpn/gogovpn-support-app"
shopify app deploy
git add shopify.app.toml
git commit -m "Set Hostinger production URLs"
git push
```

App proxy must stay:

- prefix `apps`
- subpath `support`

## 6. Install on vpn-vanish

Dev Dashboard → **Overview → Installs → Install app** on vpn-vanish. Approve `read_orders`. Request **Protected customer data → Email**.

Theme: upload gogoVPN theme, create page handle `refund-request` with template `page.refund-request`, enable Support chat.

## Test

Open `https://YOUR-HOSTINGER-URL/proxy/refund` — you should see JSON like `method_not_allowed`, not a 404.

Then test Help chat and the refund form on the storefront.
