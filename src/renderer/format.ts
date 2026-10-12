// Display helpers. Option prices are shown per contract in dollars ($0.20 quote -> $20).

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

export function usd(n: number): string {
  return money.format(n);
}

export function signedUsd(n: number): string {
  return n > 0 ? `+${money.format(n)}` : money.format(n);
}

export function pnlClass(n: number): string {
  return n > 0 ? 'win' : n < 0 ? 'loss' : 'flat';
}

/** "2026-10-12T11:49:07" -> "11:49:07" */
export function timeOf(iso: string): string {
  return iso.slice(11, 19);
}

/** "2026-10-12" -> "Mon, Oct 12, 2026" */
export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

/** "2026-10-12" -> "10/12" */
export function shortDate(isoDate: string): string {
  return `${Number(isoDate.slice(5, 7))}/${Number(isoDate.slice(8, 10))}`;
}

export function holdTime(openIso: string, closeIso?: string): string {
  if (!closeIso) return 'open';
  const seconds = (Date.parse(closeIso) - Date.parse(openIso)) / 1000;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
  return `${Math.round(seconds / 86400)}d`;
}
