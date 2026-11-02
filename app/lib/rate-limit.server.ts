import { createHash } from "node:crypto";
import prisma from "../db.server";

export interface RateRule {
  key: string;
  limit: number;
  windowMs: number;
}

export function hashKey(value: string): string {
  return createHash("sha256")
    .update(`${process.env.SHOPIFY_API_SECRET ?? ""}:${value}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Returns true when every rule is under its limit, and records a hit for each.
 * Backed by the database so limits hold across restarts and multiple instances.
 */
export async function consumeRateLimits(rules: RateRule[]): Promise<boolean> {
  const now = Date.now();
  for (const rule of rules) {
    const count = await prisma.rateLimitHit.count({
      where: { key: rule.key, createdAt: { gte: new Date(now - rule.windowMs) } },
    });
    if (count >= rule.limit) return false;
  }
  await prisma.rateLimitHit.createMany({
    data: rules.map((r) => ({ key: r.key })),
  });
  return true;
}

export async function pruneRateLimitHits(olderThanMs = 1000 * 60 * 60 * 48) {
  await prisma.rateLimitHit.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - olderThanMs) } },
  });
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
