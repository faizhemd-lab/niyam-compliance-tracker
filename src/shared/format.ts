/** Date and money helpers shared by the rules engine, the calendar and the UI. */

const DAY = 86_400_000

/** Parse an ISO date-only string as UTC midnight, so timezones cannot shift a deadline. */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1))
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function addDays(iso: string, days: number): string {
  return toIso(new Date(parseDate(iso).getTime() + days * DAY))
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / DAY)
}

export function makeDate(year: number, month: number, day: number): string {
  // Clamp to the last day of the month, so "31 September" becomes 30 September.
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return toIso(new Date(Date.UTC(year, month - 1, Math.min(day, last))))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDate(iso: string | null): string {
  if (!iso) return 'On event'
  const d = parseDate(iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return `${formatDate(d.toISOString().slice(0, 10))}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

/** Indian digit grouping: ₹12,34,567. */
export function formatRupees(value: number, withSymbol = true): string {
  const rounded = Math.round(value)
  const s = String(Math.abs(rounded))
  const last3 = s.slice(-3)
  const rest = s.slice(0, -3)
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3
  return `${rounded < 0 ? '-' : ''}${withSymbol ? '₹' : ''}${grouped}`
}

/** Short form for copy: ₹60 lakh, ₹2 crore. */
export function formatTurnover(value: number): string {
  if (value >= 10_000_000) return `${Number((value / 10_000_000).toFixed(2))} crore`
  if (value >= 100_000) return `${Number((value / 100_000).toFixed(2))} lakh`
  return formatRupees(value)
}

/** Financial year (April to March) that a date falls in, e.g. FY2026-27. */
export function financialYear(iso: string): string {
  const d = parseDate(iso)
  const start = d.getUTCMonth() + 1 >= 4 ? d.getUTCFullYear() : d.getUTCFullYear() - 1
  return `FY${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}
