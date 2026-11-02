// Hosts that publish only the build output (e.g. Hostinger) would otherwise drop the
// schema and migrations that `prisma migrate deploy` needs at startup.
import { cpSync, rmSync } from "node:fs";

rmSync("build/prisma", { recursive: true, force: true });
cpSync("prisma", "build/prisma", {
  recursive: true,
  filter: (src) => !/\.sqlite(-journal|-wal|-shm)?$/.test(src),
});
console.log("Copied prisma/ to build/prisma");
