import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import express from "express";
import { createRequestHandler } from "@react-router/express";

const root = import.meta.dirname;
const require = createRequire(import.meta.url);

// SQLite creates the database file but not its parent folder.
const dbUrl = process.env.DATABASE_URL ?? "";
if (!dbUrl) console.error("[server] DATABASE_URL is not set.");
if (dbUrl.startsWith("file:/")) {
  try {
    mkdirSync(path.dirname(dbUrl.slice("file:".length)), { recursive: true });
  } catch (error) {
    console.error(`[server] Could not create the database folder: ${error.message}`);
  }
}

// Hosts like Passenger don't put npm/npx on PATH, so run the Prisma CLI with this
// Node binary, and pipe its output into console.* so it reaches the host's log.
function migrate() {
  const cli = require.resolve("prisma/build/index.js");
  const schema = ["prisma/schema.prisma", "build/prisma/schema.prisma"]
    .map((p) => path.join(root, p))
    .find((p) => existsSync(p));
  if (!schema) {
    console.error("[server] Database migration failed: no prisma/schema.prisma or build/prisma/schema.prisma found.");
    return false;
  }
  const result = spawnSync(process.execPath, [cli, "migrate", "deploy", "--schema", schema], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status === 0) {
    console.log(`[server] Database migrations applied.\n${output}`);
    return true;
  }
  console.error(
    `[server] Database migration failed (exit ${result.status ?? "none"}): ${result.error?.message ?? ""}\n${output}`,
  );
  return false;
}

if (process.env.SKIP_MIGRATIONS !== "true" && !migrate()) {
  console.error("[server] Starting anyway so the error above is visible; database requests will fail until it is fixed.");
}

const build = await import(path.join(root, "build/server/index.js"));

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);

app.use(
  "/assets",
  express.static(path.join(root, "build/client/assets"), { immutable: true, maxAge: "1y" }),
);
app.use(express.static(path.join(root, "build/client"), { maxAge: "1h" }));
app.use(createRequestHandler({ build, mode: process.env.NODE_ENV }));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`[server] Support & Refunds app listening on port ${port}`);
});
