import { safeText, type Cell, type Sheet } from './sheets';

function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  const s = safeText(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One CSV file. Several sheets become sections: a title line, the header, the rows, then a blank
 * line. Starts with a UTF-8 BOM and uses CRLF so Excel opens names like "Peñaflor" correctly.
 */
export function toCsv(sheets: Sheet[]): string {
  const lines: string[] = [];
  sheets.forEach((sh, i) => {
    if (sheets.length > 1) {
      if (i > 0) lines.push('');
      lines.push(csvCell(sh.name));
    }
    lines.push(sh.header.map(csvCell).join(','));
    for (const r of sh.rows) lines.push(r.map(csvCell).join(','));
  });
  return '﻿' + lines.join('\r\n') + '\r\n';
}
