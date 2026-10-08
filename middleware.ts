/**
 * FR11: guard every route except the public ones in the PRD API section.
 *
 * Public (method-specific):
 *   pages  /book (and /book/*), /login
 *   GET    /api/slots
 *   POST   /api/requests
 *   POST   /api/auth/login
 *   GET    /api/cron/reminders   (the route checks CRON_SECRET itself)
 *   static assets (excluded by `config.matcher`)
 *
 * Unauthenticated page -> 307 /login?next=<relative path>; unauthenticated API -> 401 JSON.
 * Also: cross-site state-changing API requests (Origin host != Host) -> 403 (CSRF belt-and-braces
 * on top of SameSite=Lax).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { isApiPath, isPublicRoute } from './lib/route-access';
import { SESSION_COOKIE, safeNextPath, verifySession } from './lib/session';

function isCrossSite(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false; // same-origin fetches from older browsers / curl
  try {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const method = req.method.toUpperCase();
  const isApi = isApiPath(pathname);

  if (isApi && !['GET', 'HEAD', 'OPTIONS'].includes(method) && pathname !== '/api/cron/reminders' && isCrossSite(req)) {
    return NextResponse.json({ error: 'forbidden', message: 'Cross-site request blocked' }, { status: 403 });
  }

  // Forward the path so Server Components can build /login?next=... (lib/auth requireStaffPage).
  const forwardHeaders = new Headers(req.headers);
  forwardHeaders.set('x-pathname', pathname + search);
  const next = () => NextResponse.next({ request: { headers: forwardHeaders } });

  if (isPublicRoute(pathname, method)) {
    // Logged-in staff opening /login go straight to the app.
    if (pathname === '/login') {
      const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
      if (user) {
        const dest = safeNextPath(req.nextUrl.searchParams.get('next'));
        return NextResponse.redirect(new URL(dest, req.url));
      }
    }
    return next();
  }

  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (user) return next();

  if (isApi) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const loginUrl = new URL('/login', req.url);
  const target = safeNextPath(pathname + search, '');
  if (target && target !== '/') loginUrl.searchParams.set('next', target);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except Next internals and public static files.
  matcher: [
    '/((?!_next/static|_next/image|_next/data|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|txt|xml|webmanifest|woff2?|ttf|css|js|map)$).*)',
  ],
};
