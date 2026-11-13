import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/export/csv';
import { columnName, crc32, toXlsx } from '@/lib/export/xlsx';
import { mismatchFlag, splitBookedBy, withBookedBy } from '@/lib/patient-note';

describe('csv', () => {
  it('quotes, guards formulas, BOM + CRLF', () => {
    const out = toCsv([{ name: 'S', header: ['a', 'b'], rows: [['x,y', '=HYPERLINK("e")'], [1, null]] }]);
    expect(out).toBe('﻿a,b\r\n"x,y","\'=HYPERLINK(""e"")"\r\n1,\r\n');
  });
});

describe('xlsx', () => {
  it('column names and crc32', () => {
    expect([0, 25, 26, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'ZZ', 'AAA']);
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });
  it('is a zip with the workbook parts', () => {
    const z = toXlsx([{ name: 'By dentist', header: ['Dentist'], rows: [['Dr. Ñ & <b>']] }]);
    expect([...z.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const text = new TextDecoder().decode(z);
    expect(text).toContain('xl/worksheets/sheet1.xml');
    expect(text).toContain('Dr. Ñ &amp; &lt;b&gt;');
  });
});

describe('patient note lines', () => {
  it('booked-by round trip', () => {
    const n = withBookedBy({ name: 'Ana Cruz', relation: 'Parent', contactNumber: '09170001111' }, 'hi');
    expect(splitBookedBy(n)).toEqual({ bookedBy: 'Ana Cruz (Parent), 09170001111', note: 'hi' });
    expect(splitBookedBy('plain')).toEqual({ bookedBy: null, note: 'plain' });
  });
  it('mismatch flag includes a different contact number', () => {
    const rec = { fullName: 'A B', email: 'a@b.c', birthdate: '1990-01-01', contactNumber: '09170000000' };
    expect(mismatchFlag(rec, { ...rec, contactNumber: '09171111111' })).toContain('contact number 09171111111');
    expect(mismatchFlag(rec, rec)).toBeNull();
  });
});
