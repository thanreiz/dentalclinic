/**
 * Service-layer errors and their JSON mapping. Services throw `ServiceError` for expected
 * outcomes (409 slot taken, 404, ...); routes call `errorResponse(err)` in their catch.
 * Unknown errors are logged server-side and returned as a generic 500 (never SQL text or stacks).
 */
import { jsonError } from '../http';

export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export const notFound = (what = 'Appointment') => new ServiceError(404, 'not_found', `${what} not found`);

type MysqlErr = { code?: string; errno?: number };

export function mysqlCode(err: unknown): string | undefined {
  return (err as MysqlErr | null)?.code;
}

export function isDeadlock(err: unknown): boolean {
  const e = err as MysqlErr | null;
  return e?.code === 'ER_LOCK_DEADLOCK' || e?.errno === 1213;
}

/** Map any thrown error to the standard JSON error response. */
export function errorResponse(err: unknown, context = 'api') {
  if (err instanceof ServiceError) {
    return jsonError(err.status, err.code, { message: err.message, ...err.extra });
  }
  const code = mysqlCode(err);
  if (code === 'ER_ROW_IS_REFERENCED_2' || code === 'ER_ROW_IS_REFERENCED') {
    return jsonError(409, 'in_use', { message: 'In use by existing appointments' });
  }
  if (code === 'ER_NO_REFERENCED_ROW_2' || code === 'ER_NO_REFERENCED_ROW') {
    return jsonError(400, 'unknown_reference', { message: 'A linked record does not exist' });
  }
  if (code === 'ER_DUP_ENTRY') {
    return jsonError(409, 'duplicate', { message: 'That value is already used' });
  }
  if (code === 'ER_CHECK_CONSTRAINT_VIOLATED' || (err as MysqlErr | null)?.errno === 3819) {
    return jsonError(400, 'check_violation', { message: 'Some values are out of range (check times and durations)' });
  }
  console.error(`[${context}] unexpected error`, safeErrorSummary(err));
  return jsonError(500, 'server_error', { message: 'Something went wrong. Please try again.' });
}

/**
 * What to log for an unexpected error (SECURITY-REVIEW L4). mysql2 errors carry `sql` with the
 * parameter VALUES inlined (names, numbers, emails), so for those only the code/errno/sqlState/
 * sqlMessage are logged, never `sql` or the error object itself. `sqlMessage` can quote a value
 * for a few codes (e.g. "Duplicate entry '0917…'"), so it is cut at the first quote.
 * Other errors: name, message and stack (our own code; no request data is put in messages).
 */
export function safeErrorSummary(err: unknown): Record<string, unknown> {
  const e = (err ?? {}) as { name?: string; code?: unknown; errno?: unknown; sqlState?: unknown; sqlMessage?: unknown; message?: unknown; stack?: unknown };
  if (typeof e.code === 'string' && (e.sqlState !== undefined || e.errno !== undefined)) {
    const msg = typeof e.sqlMessage === 'string' ? e.sqlMessage.split("'")[0].trim() : undefined;
    return { code: e.code, errno: e.errno, sqlState: e.sqlState, sqlMessage: msg };
  }
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { message: String(err) };
}
