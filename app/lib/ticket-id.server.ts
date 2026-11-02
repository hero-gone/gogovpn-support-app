import { randomInt } from "node:crypto";

// No 0/O/1/I/L so IDs can be read out over email or phone without confusion.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function generatePublicId(type: "refund" | "support"): string {
  const prefix = type === "refund" ? "RR" : "ST";
  let body = "";
  for (let i = 0; i < 8; i++) body += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${body}`;
}
