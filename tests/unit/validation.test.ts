import { describe, expect, it } from 'vitest';
import {
  bookingRequestSchema,
  fieldErrors,
  honeypotTripped,
  loginSchema,
  noteSchema,
  patientPatchSchema,
  rescheduleSchema,
  scheduleCreateSchema,
  slotsQuerySchema,
  staffBookingSchema,
  statusSchema,
} from '@/lib/validation';

const validRequest = {
  serviceId: 1,
  dentistId: 'any',
  date: '2026-10-20',
  start: '10:00',
  fullName: 'Juan Dela Cruz',
  contactNumber: '+63 917-555-0199',
  email: 'Juan@Example.com ',
  birthdate: '1990-05-01',
  consent: true,
};

describe('bookingRequestSchema (POST /api/requests)', () => {
  it('accepts a valid request and normalizes contact + email', () => {
    const r = bookingRequestSchema.parse(validRequest);
    expect(r.contactNumber).toBe('09175550199');
    expect(r.email).toBe('juan@example.com');
    expect(r.dentistId).toBe('any');
    expect(r.patientNote ?? null).toBeNull();
  });

  it('dentistId may be a numeric string', () => {
    expect(bookingRequestSchema.parse({ ...validRequest, dentistId: '2' }).dentistId).toBe(2);
  });

  it('requires consent === true', () => {
    for (const consent of [false, 'true', undefined, 1]) {
      const r = bookingRequestSchema.safeParse({ ...validRequest, consent });
      expect(r.success).toBe(false);
      if (!r.success) expect(fieldErrors(r.error).consent).toMatch(/consent/i);
    }
  });

  it('requires email on the public form', () => {
    expect(bookingRequestSchema.safeParse({ ...validRequest, email: '' }).success).toBe(false);
  });

  it('rejects bad contact, date, time', () => {
    expect(bookingRequestSchema.safeParse({ ...validRequest, contactNumber: '12345' }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...validRequest, date: '2026-02-30' }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...validRequest, start: '10:00:00' }).success).toBe(false);
    expect(bookingRequestSchema.safeParse({ ...validRequest, birthdate: '2999-01-01' }).success).toBe(false);
  });

  it('honeypot', () => {
    expect(honeypotTripped({ ...validRequest, website: '' })).toBe(false);
    expect(honeypotTripped(validRequest)).toBe(false);
    expect(honeypotTripped({ ...validRequest, website: 'http://spam' })).toBe(true);
    // PRD: any submission that fills it is dropped -> whitespace-only counts as filled (QA N5)
    expect(honeypotTripped({ ...validRequest, website: ' ' })).toBe(true);
    expect(honeypotTripped({ ...validRequest, website: '\t\n' })).toBe(true);
  });
});

describe('staffBookingSchema (POST /api/appointments)', () => {
  const base = { serviceId: 1, dentistId: 1, date: '2026-10-20', start: '09:00', chairId: 1, channel: 'phone' };
  it('exactly one of patientId / newPatient', () => {
    expect(staffBookingSchema.safeParse({ ...base, patientId: 3 }).success).toBe(true);
    expect(
      staffBookingSchema.safeParse({
        ...base,
        newPatient: { fullName: 'Ana Cruz', contactNumber: '0917 555 0188', birthdate: '1990-01-01' },
      }).success,
    ).toBe(true);
    expect(staffBookingSchema.safeParse(base).success).toBe(false);
    expect(
      staffBookingSchema.safeParse({
        ...base,
        patientId: 3,
        newPatient: { fullName: 'Ana Cruz', contactNumber: '09175550188', birthdate: '1990-01-01' },
      }).success,
    ).toBe(false);
  });
  it('new patient email optional ("" -> null)', () => {
    const r = staffBookingSchema.parse({
      ...base,
      newPatient: { fullName: 'Ana Cruz', contactNumber: '09175550188', email: '', birthdate: '1990-01-01' },
    });
    expect(r.newPatient?.email).toBeNull();
  });
  it('online is not a staff channel', () => {
    expect(staffBookingSchema.safeParse({ ...base, patientId: 1, channel: 'online' }).success).toBe(false);
  });
});

describe('other schemas', () => {
  it('slots query coerces ids', () => {
    expect(slotsQuerySchema.parse({ date: '2026-10-20', serviceId: '2', dentistId: 'any' })).toEqual({
      date: '2026-10-20',
      serviceId: 2,
      dentistId: 'any',
    });
  });
  it('status only allows attended/cancelled/no-show', () => {
    expect(statusSchema.safeParse({ status: 'no-show' }).success).toBe(true);
    expect(statusSchema.safeParse({ status: 'scheduled' }).success).toBe(false);
  });
  it('reschedule requires chair', () => {
    expect(rescheduleSchema.safeParse({ date: '2026-10-20', start: '09:00', dentistId: 1 }).success).toBe(false);
  });
  it('note: empty clears', () => {
    expect(noteSchema.parse({ dentistNote: '  ' }).dentistNote).toBeNull();
    expect(noteSchema.parse({ dentistNote: ' ok ' }).dentistNote).toBe('ok');
  });
  it('patient patch needs at least one field', () => {
    expect(patientPatchSchema.safeParse({}).success).toBe(false);
    expect(patientPatchSchema.parse({ contactNumber: '0918-555-0102' }).contactNumber).toBe('09185550102');
  });
  it('schedule end after start', () => {
    expect(scheduleCreateSchema.safeParse({ dentistId: 1, dayOfWeek: 1, startTime: '17:00', endTime: '09:00' }).success).toBe(false);
  });
  it('login lowercases email', () => {
    expect(loginSchema.parse({ email: ' Staff@Clinic.test ', password: 'x' }).email).toBe('staff@clinic.test');
  });
});

describe('optional fields', () => {
  it('missing email on new patient -> null; missing patch email stays undefined', () => {
    const r = staffBookingSchema.parse({
      serviceId: 1, dentistId: 1, date: '2026-10-20', start: '09:00', chairId: 1, channel: 'walk-in',
      newPatient: { fullName: 'Ana Cruz', contactNumber: '09175550188', birthdate: '1990-01-01' },
    });
    expect(r.newPatient?.email).toBeNull();
    expect(patientPatchSchema.parse({ fullName: 'Ana Cruz' }).email).toBeUndefined();
    expect(patientPatchSchema.parse({ email: '' }).email).toBeNull();
  });
});
