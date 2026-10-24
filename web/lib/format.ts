export const money = (cents: number | bigint) => `$${(Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const moneyShort = (cents: number | bigint) => {
  const d = Number(cents) / 100;
  if (Math.abs(d) >= 1e6) return `$${(d / 1e6).toFixed(1)}M`;
  if (Math.abs(d) >= 1e4) return `$${(d / 1e3).toFixed(0)}k`;
  return `$${d.toFixed(0)}`;
};
export const int = (n: number | bigint) => Number(n).toLocaleString("en-US");
export const pct = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
export const agentLabel = (id: number) => `A-${String(id).padStart(5, "0")}`;
export const businessLabel = (id: number) => `B-${String(id).padStart(3, "0")}`;
export const patternLabel = (id: number) => `FR-${String(id).padStart(3, "0")}`;
export const refundLabel = (id: bigint | number) => `R-${id}`;
export const claimLabel = (id: bigint | number) => `C-${id}`;
export const titleCase = (s: string) => s.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase());
export const timeAgo = (ms: number) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h`;
};
