/**
 * /api/setup/[entity] (staff, FR5), entity = dentists | schedules | services | chairs.
 *   GET                 -> { items }
 *   POST   create       -> 201 { ok, id }
 *   PATCH  update       -> { ok }   (schedules: { id, startTime, endTime } OR replace a week:
 *                                     { dentistId, week: [7 x null|{startTime,endTime}] } / { dentistId, schedules })
 *   DELETE { id } or ?id -> { ok }  (409 in_use "In use by existing appointments")
 * Body shapes: lib/validation setupSchemas. See docs/CONTRACTS.md.
 */
import { NextResponse } from 'next/server';
import { jsonError, parseJsonBody, parseWith, requireStaffApi } from '@/lib/http';
import { errorResponse } from '@/lib/services/errors';
import * as setup from '@/lib/services/setup';
import { scheduleReplaceSchema, setupDeleteSchema, setupEntitySchema, setupSchemas, type SetupEntity } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ entity: string }> };

async function entityOf(ctx: Ctx): Promise<SetupEntity | null> {
  const r = setupEntitySchema.safeParse((await ctx.params).entity);
  return r.success ? r.data : null;
}

const unknownEntity = () => jsonError(404, 'not_found', { message: 'Unknown setup entity' });

export async function GET(req: Request, ctx: Ctx) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const entity = await entityOf(ctx);
  if (!entity) return unknownEntity();
  const dentistId = Number(new URL(req.url).searchParams.get('dentistId')) || undefined;
  try {
    return NextResponse.json({ items: await setup.listSetup(entity, dentistId) });
  } catch (err) {
    return errorResponse(err, `GET /api/setup/${entity}`);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const entity = await entityOf(ctx);
  if (!entity) return unknownEntity();
  try {
    let id: number;
    switch (entity) {
      case 'dentists': {
        const p = await parseJsonBody(req, setupSchemas.dentists.create);
        if (!p.ok) return p.response;
        id = await setup.createDentist(p.data);
        break;
      }
      case 'schedules': {
        const p = await parseJsonBody(req, setupSchemas.schedules.create);
        if (!p.ok) return p.response;
        id = await setup.createSchedule(p.data);
        break;
      }
      case 'services': {
        const p = await parseJsonBody(req, setupSchemas.services.create);
        if (!p.ok) return p.response;
        id = await setup.createService(p.data);
        break;
      }
      case 'chairs': {
        const p = await parseJsonBody(req, setupSchemas.chairs.create);
        if (!p.ok) return p.response;
        id = await setup.createChair(p.data);
        break;
      }
    }
    return NextResponse.json({ ok: true, id }, { status: 201 });
  } catch (err) {
    return errorResponse(err, `POST /api/setup/${entity}`);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const entity = await entityOf(ctx);
  if (!entity) return unknownEntity();
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError(400, 'invalid_json', { message: 'Request body must be JSON' });
  }
  try {
    switch (entity) {
      case 'dentists': {
        const p = parseWith(setupSchemas.dentists.update, raw);
        if (!p.ok) return p.response;
        await setup.updateDentist(p.data);
        break;
      }
      case 'schedules': {
        const isReplace = !!raw && typeof raw === 'object' && 'dentistId' in raw && !('id' in raw);
        if (isReplace) {
          const p = parseWith(scheduleReplaceSchema, raw);
          if (!p.ok) return p.response;
          await setup.replaceSchedules(p.data);
        } else {
          const p = parseWith(setupSchemas.schedules.update, raw);
          if (!p.ok) return p.response;
          await setup.updateSchedule(p.data);
        }
        break;
      }
      case 'services': {
        const p = parseWith(setupSchemas.services.update, raw);
        if (!p.ok) return p.response;
        await setup.updateService(p.data);
        break;
      }
      case 'chairs': {
        const p = parseWith(setupSchemas.chairs.update, raw);
        if (!p.ok) return p.response;
        await setup.updateChair(p.data);
        break;
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, `PATCH /api/setup/${entity}`);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const auth = await requireStaffApi(req);
  if (!auth.ok) return auth.response;
  const entity = await entityOf(ctx);
  if (!entity) return unknownEntity();
  let raw: unknown = { id: new URL(req.url).searchParams.get('id') ?? undefined };
  const text = await req.text();
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      return jsonError(400, 'invalid_json', { message: 'Request body must be JSON' });
    }
  }
  const p = parseWith(setupDeleteSchema, raw);
  if (!p.ok) return p.response;
  try {
    const del = { dentists: setup.deleteDentist, schedules: setup.deleteSchedule, services: setup.deleteService, chairs: setup.deleteChair }[entity];
    await del(p.data.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err, `DELETE /api/setup/${entity}`);
  }
}
