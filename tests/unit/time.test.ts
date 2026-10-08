import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMinutes,
  dayOfWeek,
  formatHuman,
  formatTime12,
  isValidDate,
  isValidTime,
  monthRange,
  nowManila,
  nowManilaDateTime,
  todayManila,
  toHHMM,
  toMinutes,
  tomorrowManila,
} from '@/lib/time';

describe('Manila clock (UTC+8, no DST)', () => {
  it('UTC 16:30 is already the next day in Manila', () => {
    const now = new Date('2026-10-08T16:30:00Z');
    expect(nowManila(now)).toEqual({ date: '2026-10-09', time: '00:30' });
    expect(todayManila(now)).toBe('2026-10-09');
    expect(tomorrowManila(now)).toBe('2026-10-10');
  });

  it('UTC 15:59 is still the same day (23:59 Manila)', () => {
    const now = new Date('2026-10-08T15:59:00Z');
    expect(nowManila(now)).toEqual({ date: '2026-10-08', time: '23:59' });
  });

  it('UTC 16:00 is Manila midnight', () => {
    expect(nowManila(new Date('2026-10-08T16:00:00Z'))).toEqual({ date: '2026-10-09', time: '00:00' });
  });

  it('cron at 01:00 UTC is 09:00 Manila; tomorrow is the next day', () => {
    const now = new Date('2026-10-14T01:00:00Z');
    expect(nowManila(now)).toEqual({ date: '2026-10-14', time: '09:00' });
    expect(tomorrowManila(now)).toBe('2026-10-15');
  });

  it('year rollover', () => {
    expect(nowManila(new Date('2026-12-31T16:05:00Z'))).toEqual({ date: '2027-01-01', time: '00:05' });
  });

  it('DATETIME string', () => {
    expect(nowManilaDateTime(new Date('2026-10-08T16:30:15Z'))).toBe('2026-10-09 00:30:15');
  });
});

describe('date arithmetic', () => {
  it('addDays across months, leap years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('dayOfWeek: 0 = Sunday', () => {
    expect(dayOfWeek('2026-10-11')).toBe(0);
    expect(dayOfWeek('2026-10-12')).toBe(1);
    expect(dayOfWeek('2026-10-17')).toBe(6);
  });

  it('validates dates', () => {
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-1-01')).toBe(false);
  });

  it('monthRange', () => {
    expect(monthRange('2026-10')).toEqual({ first: '2026-10-01', last: '2026-10-31' });
    expect(monthRange('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' });
    expect(monthRange('2026-12')).toEqual({ first: '2026-12-01', last: '2026-12-31' });
  });
});

describe('time of day', () => {
  it('HH:MM[:SS] arithmetic', () => {
    expect(toMinutes('09:30')).toBe(570);
    expect(toMinutes('09:30:59')).toBe(570);
    expect(toHHMM('13:05:00')).toBe('13:05');
    expect(addMinutes('09:45', 45)).toBe('10:30');
    expect(addMinutes('09:00', -15)).toBe('08:45');
    expect(() => addMinutes('23:30', 45)).toThrow();
  });

  it('validates times', () => {
    expect(isValidTime('09:00')).toBe(true);
    expect(isValidTime('23:59:59')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('9:00')).toBe(false);
  });
});

describe('display', () => {
  it("formatHuman('2026-10-15','10:00') -> 'Oct 15, 2026, 10:00 AM'", () => {
    expect(formatHuman('2026-10-15', '10:00')).toBe('Oct 15, 2026, 10:00 AM');
    expect(formatHuman('2026-10-15', '13:30:00')).toBe('Oct 15, 2026, 1:30 PM');
    expect(formatHuman('2026-10-15')).toBe('Oct 15, 2026');
  });
  it('12-hour edge cases', () => {
    expect(formatTime12('00:15')).toBe('12:15 AM');
    expect(formatTime12('12:00')).toBe('12:00 PM');
  });
});
