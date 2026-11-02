import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

export default function setup() {
  rmSync("prisma/test.sqlite", { force: true });
  rmSync("storage/test-uploads", { recursive: true, force: true });
  execSync("npx prisma migrate deploy", {
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: "file:./test.sqlite" },
  });
  return () => {
    rmSync("prisma/test.sqlite", { force: true });
    rmSync("prisma/test.sqlite-journal", { force: true });
    rmSync("storage/test-uploads", { recursive: true, force: true });
  };
}
