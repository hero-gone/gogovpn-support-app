export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatMoney(amount: string | null | undefined, currency: string | null | undefined): string {
  if (!amount) return "—";
  const num = Number(amount);
  if (!Number.isFinite(num)) return amount;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency ?? ""}`.trim();
  }
}

export function legacyIdFromGid(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const match = gid.match(/\/(\d+)$/);
  return match ? match[1]! : null;
}
