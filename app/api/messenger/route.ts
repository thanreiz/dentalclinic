/**
 * Facebook Messenger webhook (SOP 1).
 *
 * GET  ?hub.mode=subscribe&hub.verify_token&hub.challenge -> echoes the challenge when the token
 *      matches MESSENGER_VERIFY_TOKEN (Meta's one-time handshake).
 * POST Meta's event delivery. The X-Hub-Signature-256 header is checked against MESSENGER_APP_SECRET
 *      BEFORE the body is parsed; anything unsigned or wrongly signed gets 403 and is ignored.
 *
 * Always answers 200 quickly for signed events (Meta retries otherwise); a failure to reply to one
 * message is logged and never fails the delivery. Unconfigured (no secret) -> 503, never open.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { sendMessengerMessage, verifyMessengerSignature } from '@/lib/messenger';
import { botReplies, extractEvents, processEvents, type RawWebhookBody } from '@/lib/services/messenger-bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAX_BODY_BYTES = 256 * 1024;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(req: Request) {
  const verifyToken = process.env.MESSENGER_VERIFY_TOKEN ?? '';
  if (!verifyToken) return NextResponse.json({ error: 'messenger_not_configured' }, { status: 503 });
  const q = new URL(req.url).searchParams;
  const challenge = q.get('hub.challenge') ?? '';
  if (q.get('hub.mode') === 'subscribe' && safeEqual(q.get('hub.verify_token') ?? '', verifyToken) && challenge) {
    return new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
  }
  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}

export async function POST(req: Request) {
  const secret = process.env.MESSENGER_APP_SECRET ?? '';
  if (!secret) return NextResponse.json({ error: 'messenger_not_configured' }, { status: 503 });

  const raw = await req.text().catch(() => '');
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  if (!verifyMessengerSignature(raw, req.headers.get('x-hub-signature-256'), secret)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: RawWebhookBody;
  try {
    body = JSON.parse(raw) as RawWebhookBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  // Users in parallel (small limit), one user's events in order; a redelivered message id is skipped.
  await processEvents(extractEvents(body), async (event) => {
    for (const message of await botReplies(event)) {
      const res = await sendMessengerMessage(event.senderId, message);
      if (!res.ok) console.error(`[messenger] reply failed: ${res.error}`);
    }
  });
  return NextResponse.json({ ok: true });
}
