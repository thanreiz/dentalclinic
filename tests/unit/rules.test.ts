import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  APPOINTMENT_STATUSES,
  canTransition,
  CHANNELS,
  computeEndTime,
  formatContact,
  formatRate,
  hoursForDate,
  isInPast,
  isWithinHours,
  normalizeContact,
  noShowRate,
  openSlots,
  overlaps,
  overlapsAny,
  unionSlots,
  type AppointmentStatus,
} from '@/lib/rules';

const FUTURE_NOW = { date: '2026-10-01', time: '08:00' }; // "now" before every test date below

describe('ENUM constants match Listing 3.2', () => {
  it('statuses and channels', () => {
    expect(APPOINTMENT_STATUSES).toEqual(['pending', 'scheduled', 'attended', 'cancelled', 'declined', 'no-show']);
    expect(CHANNELS).toEqual(['online', 'phone', 'chat', 'walk-in']);
  });
});

describe('Rule 4: computeEndTime', () => {
  it.each([
    ['09:00', 30, '09:30'],
    ['10:00', 60, '11:00'],
    ['09:30', 45, '10:15'],
    ['16:15', 45, '17:00'],
    ['10:00:00', 45, '10:45'],
  ])('%s + %i min = %s', (start, mins, end) => {
    expect(computeEndTime(start, mins)).toBe(end);
  });
  it('rejects non-positive durations', () => {
    expect(() => computeEndTime('09:00', 0)).toThrow();
    expect(() => computeEndTime('09:00', -5)).toThrow();
  });
});

// Overlap test table (PRD Table 3.17): existing appointment 10:00–11:00.
describe('Rule 1: overlaps (Table 3.17 overlap cases)', () => {
  const existing = { start: '10:00', end: '11:00' };
  it.each([
    ['09:00', '10:00', false, 'back-to-back before'],
    ['11:00', '11:30', false, 'back-to-back after (PRD example)'],
    ['09:00', '09:45', false, 'entirely before'],
    ['11:15', '12:00', false, 'entirely after'],
    ['09:30', '10:30', true, 'overlaps the start'],
    ['10:30', '11:30', true, 'overlaps the end'],
    ['10:00', '11:00', true, 'identical'],
    ['10:15', '10:45', true, 'inside'],
    ['09:00', '12:00', true, 'covers'],
    ['10:59', '11:30', true, 'one minute overlap'],
  ])('new %s–%s -> %s (%s)', (start, end, expected) => {
    expect(overlaps({ start, end }, existing)).toBe(expected);
    // symmetric
    expect(overlaps(existing, { start, end })).toBe(expected);
  });

  it('back-to-back chain 10:00–11:00 then 11:00–11:30 is allowed', () => {
    expect(overlapsAny({ start: '11:00', end: '11:30' }, [{ start: '10:00', end: '11:00' }])).toBe(false);
  });

  it('accepts HH:MM:SS from MySQL', () => {
    expect(overlaps({ start: '10:30', end: '11:00' }, { start: '10:00:00', end: '11:00:00' })).toBe(true);
  });
});

describe('Rule 2: isWithinHours', () => {
  const hours = { start: '09:00', end: '17:00' };
  it.each([
    ['09:00', '09:30', true],
    ['16:30', '17:00', true],
    ['08:30', '09:30', false],
    ['16:30', '17:15', false],
    ['17:00', '17:30', false],
  ])('%s–%s -> %s', (start, end, expected) => {
    expect(isWithinHours({ start, end }, hours)).toBe(expected);
  });
  it('no schedule row = not working', () => {
    expect(isWithinHours({ start: '10:00', end: '10:30' }, null)).toBe(false);
  });
  it('hoursForDate picks the weekday row (0 = Sunday)', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((d) => ({ day_of_week: d, start_time: '09:00:00', end_time: '17:00:00' }));
    expect(hoursForDate(rows, '2026-10-12')?.day_of_week).toBe(1); // Monday
    expect(hoursForDate(rows, '2026-10-11')).toBeNull(); // Sunday
  });
});

describe('Rule 3: isInPast (Manila)', () => {
  const now = { date: '2026-10-09', time: '10:00' };
  it.each([
    ['2026-10-08', '16:00', true],
    ['2026-10-09', '09:30', true],
    ['2026-10-09', '10:00', true], // exactly now is not "later than now"
    ['2026-10-09', '10:30', false],
    ['2026-10-10', '09:00', false],
  ])('%s %s -> %s', (date, start, expected) => {
    expect(isInPast(date, start, now)).toBe(expected);
  });
});

// Slot test table (PRD Table 3.18): Rule 5 worked example.
describe('Rule 5: openSlots (Table 3.18 slot cases)', () => {
  const base = {
    date: '2026-10-12',
    hours: { start: '09:00', end: '12:00' },
    durationMinutes: 45,
    existing: [{ start: '10:00', end: '11:00' }],
    now: FUTURE_NOW,
    intervalMinutes: 30,
  };

  it('hours 09:00–12:00, existing 10:00–11:00, 45 min -> 09:00 and 11:00 open', () => {
    expect(openSlots(base)).toEqual([
      { start: '09:00', end: '09:45' },
      { start: '11:00', end: '11:45' },
    ]);
  });

  it.each([
    ['09:00', true, 'ends 09:45, before the booking'],
    ['09:30', false, 'ends 10:15, overlaps 10:00–11:00'],
    ['10:00', false, 'inside the booking'],
    ['10:30', false, 'overlaps the booking'],
    ['11:00', true, 'back-to-back after the booking'],
    ['11:30', false, 'ends 12:15, past closing'],
  ])('start %s -> open=%s (%s)', (start, open) => {
    expect(openSlots(base).some((s) => s.start === start)).toBe(open);
  });

  it('back-to-back: a 30-min service fits 09:30–10:00 right before the booking', () => {
    const slots = openSlots({ ...base, durationMinutes: 30 }).map((s) => s.start);
    expect(slots).toEqual(['09:00', '09:30', '11:00', '11:30']);
  });

  it('no booking -> every interval start whose end fits', () => {
    const slots = openSlots({ ...base, existing: [] }).map((s) => s.start);
    expect(slots).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00']);
  });

  it('today drops starts at or before now', () => {
    const slots = openSlots({ ...base, existing: [], now: { date: '2026-10-12', time: '09:30' } }).map((s) => s.start);
    expect(slots).toEqual(['10:00', '10:30', '11:00']);
  });

  it('past date -> no slots', () => {
    expect(openSlots({ ...base, now: { date: '2026-10-13', time: '08:00' } })).toEqual([]);
  });

  it('not working (no schedule row) -> no slots', () => {
    expect(openSlots({ ...base, hours: null })).toEqual([]);
  });

  it('uses SLOT_INTERVAL_MINUTES when no interval is passed', () => {
    const prev = process.env.SLOT_INTERVAL_MINUTES;
    process.env.SLOT_INTERVAL_MINUTES = '60';
    try {
      const { intervalMinutes: _i, ...noInterval } = base;
      void _i;
      expect(openSlots({ ...noInterval, existing: [] }).map((s) => s.start)).toEqual(['09:00', '10:00', '11:00']);
    } finally {
      if (prev === undefined) delete process.env.SLOT_INTERVAL_MINUTES;
      else process.env.SLOT_INTERVAL_MINUTES = prev;
    }
  });

  it('unionSlots merges dentists for "any", ids ascending', () => {
    const merged = unionSlots([
      { dentistId: 2, slots: [{ start: '09:00', end: '09:45' }, { start: '10:00', end: '10:45' }] },
      { dentistId: 1, slots: [{ start: '09:00', end: '09:45' }, { start: '11:00', end: '11:45' }] },
    ]);
    expect(merged).toEqual([
      { start: '09:00', end: '09:45', dentistIds: [1, 2] },
      { start: '10:00', end: '10:45', dentistIds: [2] },
      { start: '11:00', end: '11:45', dentistIds: [1] },
    ]);
  });
});

describe('Rule 7: canTransition (Table 3.21) full matrix', () => {
  const allowedBefore: Record<AppointmentStatus, AppointmentStatus[]> = {
    pending: ['scheduled', 'declined'],
    scheduled: ['cancelled'],
    attended: [],
    cancelled: [],
    declined: [],
    'no-show': [],
  };
  const allowedAfter: Record<AppointmentStatus, AppointmentStatus[]> = {
    pending: ['scheduled', 'declined'],
    scheduled: ['attended', 'cancelled', 'no-show'],
    attended: [],
    cancelled: [],
    declined: [],
    'no-show': [],
  };

  for (const from of APPOINTMENT_STATUSES) {
    for (const to of APPOINTMENT_STATUSES) {
      it(`${from} -> ${to}`, () => {
        expect(canTransition(from, to, { startPassed: false })).toBe(allowedBefore[from].includes(to));
        expect(canTransition(from, to, { startPassed: true })).toBe(allowedAfter[from].includes(to));
      });
    }
  }

  it('attended and no-show are refused before the start time', () => {
    expect(canTransition('scheduled', 'attended', { startPassed: false })).toBe(false);
    expect(canTransition('scheduled', 'no-show', { startPassed: false })).toBe(false);
  });

  it('allowedTransitions lists buttons', () => {
    expect(allowedTransitions('scheduled', { startPassed: false })).toEqual(['cancelled']);
    expect(allowedTransitions('scheduled', { startPassed: true })).toEqual(['attended', 'cancelled', 'no-show']);
    expect(allowedTransitions('declined', { startPassed: true })).toEqual([]);
  });
});

describe('FR9: normalizeContact / formatContact', () => {
  it.each([
    ['+63 917-555-0101', '09175550101'],
    ['09175550101', '09175550101'],
    ['0917 555 0101', '09175550101'],
    ['0917-555-0101', '09175550101'],
    ['(0917) 555.0101', '09175550101'],
    ['639175550101', '09175550101'],
    ['+639175550101', '09175550101'],
    ['  0918 555 0102  ', '09185550102'],
    ['(02) 8123 4567', '0281234567'],
    ['+63 2 8123 4567', '0281234567'],
    ['8123 4567', '81234567'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeContact(raw)).toBe(expected);
  });

  it.each([
    [''],
    ['abc'],
    ['0917555010'], // 10-digit "mobile" typo
    ['091755501011'], // 12 digits
    ['12345'],
    ['+1 415 555 0101'],
    ['0917-555-01O1'], // letter O
  ])('rejects %j', (raw) => {
    expect(normalizeContact(raw)).toBeNull();
  });

  it('formats for display', () => {
    expect(formatContact('09175550101')).toBe('0917 555 0101');
    expect(formatContact('0281234567')).toBe('(02) 8123 4567');
    expect(formatContact('81234567')).toBe('81234567');
  });
});

describe('FR15: no-show rate', () => {
  it('Table 3.22 numbers', () => {
    expect(formatRate(noShowRate(18, 2))).toBe('10.0%');
    expect(formatRate(noShowRate(12, 3))).toBe('20.0%');
    expect(formatRate(noShowRate(30, 5))).toBe('14.3%');
    expect(noShowRate(0, 0)).toBeNull();
  });
});
