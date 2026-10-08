/**
 * Shared Zod schemas for every API input in the PRD API table. Use the same schema on the client
 * (form) and in the route handler. Dates are 'YYYY-MM-DD', times 'HH:MM' (Manila).
 * Output field names are camelCase; map to snake_case columns in lib/queries.
 */
import { z } from 'zod';
import { normalizeContact, STAFF_CHANNELS, STAFF_SET_STATUSES } from './rules';
import { isValidDate, isValidTime, todayManila, toMinutes } from './time';

// No `new Function` JIT: the CSP (next.config.ts) has no 'unsafe-eval' in production, and Zod's
// eval probe would otherwise report a securitypolicyviolation in the browser. Parsing stays correct.
z.config({ jitless: true });

// ---------- primitives ----------

export const dateSchema = z
  .string()
  .trim()
  .refine((v) => isValidDate(v), { message: 'Use a valid date (YYYY-MM-DD)' });

/** 'HH:MM' (24-hour). 'HH:MM:SS' is rejected so the API stays uniform. */
export const timeSchema = z
  .string()
  .trim()
  .refine((v) => /^\d{2}:\d{2}$/.test(v) && isValidTime(v), { message: 'Use a valid time (HH:MM)' });

/** 'YYYY-MM' for report month pickers. */
export const monthSchema = z
  .string()
  .trim()
  .refine((v) => /^\d{4}-\d{2}$/.test(v) && isValidDate(`${v}-01`), { message: 'Use a valid month (YYYY-MM)' });

/** Positive integer id; accepts numeric strings (query params, form values). */
export const idSchema = z.coerce
  .number({ error: 'Must be a number' })
  .int({ error: 'Must be a whole number' })
  .positive({ error: 'Must be a positive id' });

/** 'any' or a dentist id (online form, GET /api/slots). */
export const dentistChoiceSchema = z.union([z.literal('any'), idSchema]);

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, { error: 'Enter the full name' })
  .max(150, { error: 'Name is too long (150 characters max)' });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(150, { error: 'Email is too long' })
  .pipe(z.email({ error: 'Enter a valid email address' }));

/** Optional email: '' / null / undefined -> null. */
export const optionalEmailSchema = z
  .union([z.literal(''), z.null(), emailSchema])
  .optional()
  .transform((v) => (v ? v : null));

/** FR9: normalized to digits only ('+63 917-555-0101' -> '09175550101'). */
export const contactNumberSchema = z
  .string()
  .trim()
  .max(30, { error: 'Contact number is too long' })
  .transform((v, ctx) => {
    const n = normalizeContact(v);
    if (!n) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a valid PH mobile (e.g. 0917 555 0101) or landline number',
      });
      return z.NEVER;
    }
    return n;
  });

/** Birthdate: a real date, not in the future (Manila), not before 1900. */
export const birthdateSchema = dateSchema.refine((v) => v >= '1900-01-01' && v <= todayManila(), {
  message: 'Enter a valid birthdate',
});

/** Optional free text: trimmed, '' -> null. */
const optionalText = (max: number) =>
  z
    .union([z.string(), z.null()])
    .optional()
    .transform((v) => (typeof v === 'string' ? v.trim() : ''))
    .refine((v) => v.length <= max, { message: `Too long (${max} characters max)` })
    .transform((v) => (v === '' ? null : v));

export const patientNoteSchema = optionalText(1000);
export const dentistNoteTextSchema = optionalText(2000);

export const staffChannelSchema = z.enum(STAFF_CHANNELS, { error: 'Pick phone, chat, or walk-in' });

const startBeforeEnd = (v: { startTime: string; endTime: string }) => toMinutes(v.endTime) > toMinutes(v.startTime);

// ---------- auth ----------

/** POST /api/auth/login */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, { error: 'Enter your email' }).max(150),
  password: z.string().min(1, { error: 'Enter your password' }).max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------- public booking ----------

/** GET /api/slots?date&serviceId&dentistId (dentistId = id or 'any') */
export const slotsQuerySchema = z.object({
  date: dateSchema,
  serviceId: idSchema,
  dentistId: dentistChoiceSchema,
});
export type SlotsQuery = z.infer<typeof slotsQuerySchema>;

/**
 * POST /api/requests (FR1). `consent` must be literally true (not stored).
 * `website` is the honeypot: the schema accepts it so the route can drop the submission
 * silently (check `honeypotTripped(body)` BEFORE parsing).
 */
export const bookingRequestSchema = z.object({
  serviceId: idSchema,
  dentistId: dentistChoiceSchema,
  date: dateSchema,
  start: timeSchema,
  fullName: fullNameSchema,
  contactNumber: contactNumberSchema,
  email: emailSchema,
  birthdate: birthdateSchema,
  patientNote: patientNoteSchema.optional(),
  consent: z.literal(true, { error: 'Please agree to the Data Privacy Act consent to continue' }),
  website: z.string().max(500).optional(),
});
export type BookingRequestInput = z.input<typeof bookingRequestSchema>;
export type BookingRequest = z.infer<typeof bookingRequestSchema>;

/** True when the honeypot field `website` is filled: drop the request without saving. */
export function honeypotTripped(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const w = (body as Record<string, unknown>).website;
  return typeof w === 'string' ? w.trim() !== '' : w !== undefined && w !== null;
}

// ---------- patients ----------

/** Inline new patient on staff booking (email optional here, unlike /book). */
export const newPatientSchema = z.object({
  fullName: fullNameSchema,
  contactNumber: contactNumberSchema,
  email: optionalEmailSchema,
  birthdate: birthdateSchema,
});
export type NewPatient = z.infer<typeof newPatientSchema>;

/** GET /api/patients?q= */
export const patientSearchSchema = z.object({
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
});
export type PatientSearch = z.infer<typeof patientSearchSchema>;

/** PATCH /api/patients/[id]: any subset, at least one field. Duplicate number -> 409 in route. */
export const patientPatchSchema = z
  .object({
    fullName: fullNameSchema.optional(),
    contactNumber: contactNumberSchema.optional(),
    email: optionalEmailSchema.optional(),
    birthdate: birthdateSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update' });
export type PatientPatch = z.infer<typeof patientPatchSchema>;

// ---------- staff appointments ----------

/** POST /api/appointments (FR3): exactly one of `patientId` or `newPatient`. Saves `scheduled`. */
export const staffBookingSchema = z
  .object({
    patientId: idSchema.optional(),
    newPatient: newPatientSchema.optional(),
    serviceId: idSchema,
    dentistId: idSchema,
    date: dateSchema,
    start: timeSchema,
    chairId: idSchema,
    channel: staffChannelSchema,
    patientNote: patientNoteSchema.optional(),
  })
  .refine((v) => (v.patientId === undefined) !== (v.newPatient === undefined), {
    message: 'Pick an existing patient or enter a new one',
    path: ['patientId'],
  });
export type StaffBookingInput = z.input<typeof staffBookingSchema>;
export type StaffBooking = z.infer<typeof staffBookingSchema>;

/** POST /api/appointments/[id]/confirm */
export const confirmSchema = z.object({ chairId: idSchema });
export type ConfirmInput = z.infer<typeof confirmSchema>;

/** POST /api/appointments/[id]/decline (no body; accepted for symmetry) */
export const declineSchema = z.object({}).strict();

/** POST /api/appointments/[id]/reschedule (Rule 11) */
export const rescheduleSchema = z.object({
  date: dateSchema,
  start: timeSchema,
  dentistId: idSchema,
  chairId: idSchema,
});
export type RescheduleInput = z.infer<typeof rescheduleSchema>;

/** POST /api/appointments/[id]/status (Rule 7 via canTransition) */
export const statusSchema = z.object({
  status: z.enum(STAFF_SET_STATUSES, { error: 'Status must be attended, cancelled, or no-show' }),
});
export type StatusInput = z.infer<typeof statusSchema>;

/** PATCH /api/appointments/[id]/note ('' clears the note) */
export const noteSchema = z.object({ dentistNote: dentistNoteTextSchema });
export type NoteInput = z.infer<typeof noteSchema>;

/** Route param `[id]` */
export const idParamSchema = z.object({ id: idSchema });

// ---------- setup (FR5) ----------

export const SETUP_ENTITIES = ['dentists', 'schedules', 'services', 'chairs'] as const;
export const setupEntitySchema = z.enum(SETUP_ENTITIES);
export type SetupEntity = z.infer<typeof setupEntitySchema>;

const dayOfWeekSchema = z.coerce.number().int().min(0).max(6);

/** One working-hours row (one per dentist per weekday; uq_dentist_day). */
export const scheduleEntrySchema = z
  .object({ dayOfWeek: dayOfWeekSchema, startTime: timeSchema, endTime: timeSchema })
  .refine(startBeforeEnd, { message: 'End time must be after start time', path: ['endTime'] });
export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>;

const weekSchema = z
  .array(scheduleEntrySchema)
  .max(7)
  .refine((rows) => new Set(rows.map((r) => r.dayOfWeek)).size === rows.length, {
    message: 'Each weekday can appear only once',
  });

/**
 * Weekly-grid form of the hours (Backend-B): exactly 7 entries, index 0 = Sunday, null = off.
 * Converted to `scheduleEntrySchema` rows with `weekToSchedules()`.
 */
const dayHoursSchema = z
  .object({ startTime: timeSchema, endTime: timeSchema })
  .refine(startBeforeEnd, { message: 'End time must be after start time', path: ['endTime'] });
export const weekHoursSchema = z.array(z.union([z.null(), dayHoursSchema])).length(7, { error: 'Give 7 days (null = off)' });
export type WeekHours = z.infer<typeof weekHoursSchema>;

export function weekToSchedules(week: WeekHours): ScheduleEntry[] {
  return week.flatMap((d, dayOfWeek) => (d ? [{ dayOfWeek, startTime: d.startTime, endTime: d.endTime }] : []));
}

export const dentistCreateSchema = z.object({
  dentistName: z.string().trim().min(2).max(100),
  /** Optional weekly hours; omitted days = not working. */
  schedules: weekSchema.optional(),
  /** Alternative to `schedules`: 7 entries, null = off (`schedules` wins if both are sent). */
  week: weekHoursSchema.optional(),
});
export const dentistUpdateSchema = z.object({
  id: idSchema,
  dentistName: z.string().trim().min(2).max(100).optional(),
  /** When present, replaces the dentist's whole week (blank day = off). */
  schedules: weekSchema.optional(),
  /** Alternative to `schedules`: 7 entries, null = off; replaces the whole week. */
  week: weekHoursSchema.optional(),
});

/** PATCH /api/setup/schedules replace form: `{ dentistId, schedules }` or `{ dentistId, week }`. */
export const scheduleReplaceSchema = z
  .object({ dentistId: idSchema, schedules: weekSchema.optional(), week: weekHoursSchema.optional() })
  .refine((v) => v.schedules !== undefined || v.week !== undefined, { message: 'Send schedules or week', path: ['week'] });
export type ScheduleReplace = z.infer<typeof scheduleReplaceSchema>;

export const scheduleCreateSchema = z
  .object({ dentistId: idSchema, dayOfWeek: dayOfWeekSchema, startTime: timeSchema, endTime: timeSchema })
  .refine(startBeforeEnd, { message: 'End time must be after start time', path: ['endTime'] });
export const scheduleUpdateSchema = z
  .object({ id: idSchema, startTime: timeSchema, endTime: timeSchema })
  .refine(startBeforeEnd, { message: 'End time must be after start time', path: ['endTime'] });

export const serviceCreateSchema = z.object({
  serviceName: z.string().trim().min(2).max(100),
  durationMinutes: z.coerce.number().int().min(5).max(480),
});
export const serviceUpdateSchema = z.object({
  id: idSchema,
  serviceName: z.string().trim().min(2).max(100).optional(),
  durationMinutes: z.coerce.number().int().min(5).max(480).optional(),
});

export const chairCreateSchema = z.object({ chairName: z.string().trim().min(1).max(50) });
export const chairUpdateSchema = z.object({ id: idSchema, chairName: z.string().trim().min(1).max(50) });

/** DELETE /api/setup/[entity] body or ?id= */
export const setupDeleteSchema = z.object({ id: idSchema });

/** Per-entity schemas for GET/POST/PATCH/DELETE /api/setup/[entity]. */
export const setupSchemas = {
  dentists: { create: dentistCreateSchema, update: dentistUpdateSchema },
  schedules: { create: scheduleCreateSchema, update: scheduleUpdateSchema },
  services: { create: serviceCreateSchema, update: serviceUpdateSchema },
  chairs: { create: chairCreateSchema, update: chairUpdateSchema },
} as const;

export type DentistCreate = z.infer<typeof dentistCreateSchema>;
export type DentistUpdate = z.infer<typeof dentistUpdateSchema>;
export type ScheduleCreate = z.infer<typeof scheduleCreateSchema>;
export type ScheduleUpdate = z.infer<typeof scheduleUpdateSchema>;
export type ServiceCreate = z.infer<typeof serviceCreateSchema>;
export type ServiceUpdate = z.infer<typeof serviceUpdateSchema>;
export type ChairCreate = z.infer<typeof chairCreateSchema>;
export type ChairUpdate = z.infer<typeof chairUpdateSchema>;

// ---------- reports / dashboard ----------

/** /reports?month=YYYY-MM&threshold=2 (threshold default from NO_SHOW_THRESHOLD in the route) */
export const reportQuerySchema = z.object({
  month: monthSchema,
  threshold: z.coerce.number().int().min(1).max(100).optional(),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

/** /dashboard?date=YYYY-MM-DD&view=dentist|chair */
export const dashboardQuerySchema = z.object({
  date: dateSchema.optional(),
  view: z.enum(['dentist', 'chair']).default('dentist'),
});

// ---------- error formatting ----------

/** Flatten Zod issues into `{ field: message }` for inline form errors. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_form';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
