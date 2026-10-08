/**
 * Which routes are public (PRD API section). Edge-safe; used by middleware.ts and tests.
 *
 * Public (method-specific):
 *   pages  /book (and /book/*), /login
 *   GET    /api/slots
 *   POST   /api/requests
 *   POST   /api/auth/login
 *   GET    /api/cron/reminders   (the route checks CRON_SECRET itself)
 */
export const PUBLIC_API: Record<string, readonly string[]> = {
  '/api/slots': ['GET', 'HEAD'],
  '/api/requests': ['POST'],
  '/api/auth/login': ['POST'],
  '/api/cron/reminders': ['GET', 'HEAD'],
};

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

export function isPublicPage(pathname: string): boolean {
  const p = stripTrailingSlash(pathname);
  return p === '/book' || p.startsWith('/book/') || p === '/login';
}

export function isPublicApi(pathname: string, method: string): boolean {
  const allowed = PUBLIC_API[stripTrailingSlash(pathname)];
  return !!allowed && allowed.includes(method.toUpperCase());
}

/** True if the request needs no staff session. */
export function isPublicRoute(pathname: string, method: string): boolean {
  return isApiPath(pathname) ? isPublicApi(pathname, method) : isPublicPage(pathname);
}
