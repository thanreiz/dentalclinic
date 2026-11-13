/**
 * Spreadsheet export (panel revision): the clinic downloads report data as CSV or Excel (.xlsx).
 * A `Sheet` is a title, a header row, and data rows; csv.ts and xlsx.ts both render it. No
 * dependencies: .xlsx is a small hand-written OOXML package (zip, stored, no compression).
 */
export type Cell = string | number | null;
export type Sheet = { name: string; header: string[]; rows: Cell[][] };

/**
 * Spreadsheet formula injection guard (CWE-1236): a text cell starting with = + - @ (or tab/CR)
 * would run as a formula when opened in Excel. Prefix it with an apostrophe so it stays text.
 * Numbers are left alone.
 */
export function safeText(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}
