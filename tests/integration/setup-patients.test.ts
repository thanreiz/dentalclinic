/** /api/setup/[entity] (FR5) and /api/patients (FR9/FR10 edits). */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PATCH as patchPatient } from '@/app/api/patients/[id]/route';
import { GET as searchRoute } from '@/app/api/patients/route';
import { DELETE as del, GET as list, PATCH as patch, POST as create } from '@/app/api/setup/[entity]/route';
import { GET as slotsRoute } from '@/app/api/slots/route';
import { queryOne } from '@/lib/db';
import { entityCtx, idCtx, req, staffCookie, workday } from './api-helpers';
import { resetTestDb } from './helpers';

let cookie = '';
beforeAll(async () => {
  await resetTestDb();
  cookie = await staffCookie();
});
// Leave dental_test as seeded for suites that don't reset (e.g. seed-report).
afterAll(async () => {
  await resetTestDb();
});

const call = async (fn: typeof create, method: string, entity: string, body?: unknown, qs = '') => {
  const res = await fn(req(method, `/api/setup/${entity}${qs}`, body, cookie), entityCtx(entity));
  return { status: res.status, body: await res.json() };
};

describe('/api/setup/[entity]', () => {
  it('auth + unknown entity', async () => {
    expect((await list(req('GET', '/api/setup/chairs'), entityCtx('chairs'))).status).toBe(401);
    expect((await call(list, 'GET', 'users')).status).toBe(404);
  });

  it('GET lists', async () => {
    expect((await call(list, 'GET', 'dentists')).body.items).toHaveLength(2);
    expect((await call(list, 'GET', 'services')).body.items).toHaveLength(3);
    expect((await call(list, 'GET', 'chairs')).body.items).toHaveLength(2);
    expect((await call(list, 'GET', 'schedules', undefined, '?dentistId=1')).body.items).toHaveLength(6);
  });

  it('dentist with a 7-entry week appears in slot results right away; PATCH week replaces it', async () => {
    const date = workday(0);
    const week = [null, ...Array(6).fill({ startTime: '08:00', endTime: '12:00' })];
    const c = await call(create, 'POST', 'dentists', { dentistName: 'Dr. Cruz', week });
    expect(c.status).toBe(201);
    const id = c.body.id;
    const slots = await (await slotsRoute(req('GET', `/api/slots?date=${date}&serviceId=1&dentistId=${id}`))).json();
    expect(slots.slots[0]).toEqual({ start: '08:00', end: '08:30', dentistIds: [id] });
    expect(slots.slots).toHaveLength(8);

    const off = Array(7).fill(null);
    expect((await call(patch, 'PATCH', 'schedules', { dentistId: id, week: off })).status).toBe(200);
    expect((await call(list, 'GET', 'schedules', undefined, `?dentistId=${id}`)).body.items).toEqual([]);
    expect((await call(patch, 'PATCH', 'dentists', { id, dentistName: 'Dr. Cruz Jr.', schedules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }] })).status).toBe(200);
    const d = (await call(list, 'GET', 'dentists')).body.items.find((x: { dentistId: number }) => x.dentistId === id);
    expect(d).toMatchObject({ dentistName: 'Dr. Cruz Jr.', week: [null, { start: '09:00', end: '10:00' }, null, null, null, null, null] });

    // no appointments -> delete works (schedules go with it)
    expect((await call(del, 'DELETE', 'dentists', { id })).status).toBe(200);
    expect((await call(del, 'DELETE', 'dentists', { id })).status).toBe(404);
  });

  it('schedules: create, duplicate day 409, CHECK/zod 400, update, delete', async () => {
    const c = await call(create, 'POST', 'schedules', { dentistId: 1, dayOfWeek: 0, startTime: '09:00', endTime: '12:00' });
    expect(c.status).toBe(201);
    const dup = await call(create, 'POST', 'schedules', { dentistId: 1, dayOfWeek: 0, startTime: '13:00', endTime: '15:00' });
    expect(dup).toMatchObject({ status: 409, body: { error: 'duplicate_day', message: 'That dentist already has hours on that day' } });
    expect((await call(create, 'POST', 'schedules', { dentistId: 1, dayOfWeek: 0, startTime: '12:00', endTime: '09:00' })).status).toBe(400);
    expect((await call(create, 'POST', 'schedules', { dentistId: 99, dayOfWeek: 0, startTime: '09:00', endTime: '10:00' })).status).toBe(400);
    expect((await call(patch, 'PATCH', 'schedules', { id: c.body.id, startTime: '10:00', endTime: '11:00' })).status).toBe(200);
    expect((await call(patch, 'PATCH', 'schedules', { id: 9999, startTime: '10:00', endTime: '11:00' })).status).toBe(404);
    expect((await call(del, 'DELETE', 'schedules', undefined, `?id=${c.body.id}`)).status).toBe(200);
  });

  it('RESTRICT: deleting a dentist/service/chair in use -> 409 "In use by existing appointments"', async () => {
    for (const entity of ['dentists', 'services', 'chairs']) {
      const r = await call(del, 'DELETE', entity, { id: 1 });
      expect(r).toEqual({ status: 409, body: { error: 'in_use', message: 'In use by existing appointments' } });
    }
    // dentist 1's schedules survived the failed delete (rolled back)
    expect((await call(list, 'GET', 'schedules', undefined, '?dentistId=1')).body.items.length).toBeGreaterThanOrEqual(6);
  });

  it('services and chairs: create, duplicate name 409, update, delete unused', async () => {
    const s = await call(create, 'POST', 'services', { serviceName: 'Whitening', durationMinutes: 90 });
    expect(s.status).toBe(201);
    expect((await call(create, 'POST', 'services', { serviceName: 'Whitening', durationMinutes: 30 })).body.error).toBe('duplicate_name');
    expect((await call(create, 'POST', 'services', { serviceName: 'Zero', durationMinutes: 0 })).status).toBe(400);
    expect((await call(patch, 'PATCH', 'services', { id: s.body.id, durationMinutes: 75 })).status).toBe(200);
    expect((await call(patch, 'PATCH', 'services', { id: s.body.id, serviceName: 'Oral prophylaxis' })).status).toBe(409);
    expect((await call(del, 'DELETE', 'services', { id: s.body.id })).status).toBe(200);

    const ch = await call(create, 'POST', 'chairs', { chairName: 'Chair 3' });
    expect(ch.status).toBe(201);
    expect((await call(create, 'POST', 'chairs', { chairName: 'Chair 3' })).status).toBe(409);
    expect((await call(patch, 'PATCH', 'chairs', { id: ch.body.id, chairName: 'Chair 1' })).body.error).toBe('duplicate_name');
    expect((await call(patch, 'PATCH', 'chairs', { id: ch.body.id, chairName: 'Chair Three' })).status).toBe(200);
    expect((await call(del, 'DELETE', 'chairs', { id: ch.body.id })).status).toBe(200);
    expect((await call(del, 'DELETE', 'chairs', { id: 'x' })).status).toBe(400);
  });
});

describe('/api/patients', () => {
  it('search by name or number, 401 without session', async () => {
    expect((await searchRoute(req('GET', '/api/patients?q=maria'))).status).toBe(401);
    const r = await (await searchRoute(req('GET', '/api/patients?q=0918-555', undefined, cookie))).json();
    expect(r.rows.map((p: { fullName: string }) => p.fullName)).toEqual(['Jose Ramos']);
    expect(r).toMatchObject({ total: 1, page: 1, pageSize: 20 });
  });

  it('PATCH edits with normalization; duplicate contact -> 409', async () => {
    const ok = await patchPatient(req('PATCH', '/api/patients/2', { contactNumber: '+63 918 555 9999', email: '' }, cookie), idCtx(2));
    expect(ok.status).toBe(200);
    expect((await ok.json()).patient).toMatchObject({ contactNumber: '09185559999', email: null });
    const dup = await patchPatient(req('PATCH', '/api/patients/2', { contactNumber: '0917 555 0101' }, cookie), idCtx(2));
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: 'duplicate_contact', message: 'Contact number already used by another patient' });
    // own number is not a duplicate
    expect((await patchPatient(req('PATCH', '/api/patients/1', { contactNumber: '09175550101', fullName: 'Maria S. Santos' }, cookie), idCtx(1))).status).toBe(200);
    expect((await queryOne<{ full_name: string }>('SELECT full_name FROM patients WHERE patient_id = 1'))?.full_name).toBe('Maria S. Santos');
    expect((await patchPatient(req('PATCH', '/api/patients/999', { fullName: 'Nobody Here' }, cookie), idCtx(999))).status).toBe(404);
    expect((await patchPatient(req('PATCH', '/api/patients/1', {}, cookie), idCtx(1))).status).toBe(400);
    expect((await patchPatient(req('PATCH', '/api/patients/1', { birthdate: '2999-01-01' }, cookie), idCtx(1))).status).toBe(400);
  });
});
