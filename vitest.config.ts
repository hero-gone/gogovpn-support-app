import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: "./tests/global-setup.ts",
    fileParallelism: false,
    env: {
      DATABASE_URL: "file:./test.sqlite",
      SHOPIFY_API_KEY: "test-api-key",
      SHOPIFY_API_SECRET: "test-api-secret",
      SHOPIFY_APP_URL: "https://support-app.test",
      SCOPES: "read_orders",
      UPLOAD_DIR: "./storage/test-uploads",
      EMAIL_FROM: "Support <support@example.com>",
      ADMIN_NOTIFY_EMAIL: "owner@example.com",
      STORE_DISPLAY_NAME: "gogoVPN",
      REFUND_PAGE_URL: "https://example.com/pages/refund-request",
    },
  },
});
