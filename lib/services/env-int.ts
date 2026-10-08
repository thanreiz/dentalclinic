/** Read a non-negative integer env var (read on every call, so tests and redeploys take effect); bad/blank -> fallback. */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}
