/**
 * Facebook Messenger helpers (SOP 1: bookings from a messaging platform).
 *
 * - verifyMessengerSignature: checks Meta's X-Hub-Signature-256 header (HMAC-SHA256 of the raw
 *   request body with the app secret, constant-time compare).
 * - signChatRef / verifyChatRef: short-lived signed token that links a /book form submission to the
 *   Messenger user who got the link. It is a signed claim, not a secret: it only marks the request
 *   as channel 'chat'; it grants no access.
 * - sendMessengerMessage: Graph API Send call. Like lib/mail.ts it never throws: it returns
 *   { ok, error } and, with no page token configured outside production, logs `[messenger:dev]`
 *   and reports success so local work needs no Meta account.
 *
 * Node runtime only. Tokens/secrets come from env and are never logged.
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

const GRAPH_URL = 'https://graph.facebook.com/v21.0/me/messages';
export const CHAT_REF_TTL_SECONDS = 2 * 60 * 60; // the bot link works for 2 hours

// ---------- webhook signature ----------

/** `signatureHeader` is "sha256=<hex>". Returns false for anything missing or malformed. */
export function verifyMessengerSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!appSecret || !signatureHeader || !signatureHeader.startsWith('sha256=')) return false;
  const given = signatureHeader.slice('sha256='.length);
  if (!/^[0-9a-f]{64}$/i.test(given)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  return timingSafeEqual(expected, Buffer.from(given, 'hex'));
}

// ---------- chat ref token ----------

function refKey(): string {
  const secret = process.env.SESSION_SECRET ?? '';
  if (secret.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters');
  // domain separation: this key is not the session-signing key
  return createHmac('sha256', secret).update('messenger-chat-ref').digest('hex');
}

const refSig = (psid: string, exp: number) => createHmac('sha256', refKey()).update(`${psid}.${exp}`).digest('base64url');

/** `<psid>.<expiresAtSeconds>.<signature>`; psid is Messenger's numeric page-scoped id. */
export function signChatRef(psid: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  if (!/^\d{1,40}$/.test(psid)) throw new Error('invalid Messenger id');
  const exp = nowSeconds + CHAT_REF_TTL_SECONDS;
  return `${psid}.${exp}.${refSig(psid, exp)}`;
}

/** Returns the Messenger id for a valid, unexpired token, else null. */
export function verifyChatRef(token: string | undefined | null, nowSeconds = Math.floor(Date.now() / 1000)): string | null {
  return verifyChatRefDetail(token, nowSeconds)?.psid ?? null;
}

/**
 * Like verifyChatRef, plus the time the link was issued (expiry minus the TTL, in epoch seconds).
 * The issue time is what lets the server tell whether this link was already used (see
 * createOnlineRequest): no stored token state is needed.
 */
export function verifyChatRefDetail(token: string | undefined | null, nowSeconds = Math.floor(Date.now() / 1000)): { psid: string; issuedAt: number } | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [psid, expRaw, sig] = parts;
  if (!/^\d{1,40}$/.test(psid) || !/^\d{1,12}$/.test(expRaw)) return null;
  const exp = Number(expRaw);
  if (exp < nowSeconds) return null;
  let expected: string;
  try {
    expected = refSig(psid, exp);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? { psid, issuedAt: exp - CHAT_REF_TTL_SECONDS } : null;
}

// ---------- sending ----------

export type QuickReply = { content_type: 'text'; title: string; payload: string };
export type OutgoingMessage =
  | { text: string; quick_replies?: QuickReply[] }
  | { attachment: { type: 'template'; payload: { template_type: 'button'; text: string; buttons: { type: 'web_url'; url: string; title: string }[] } } };

export type MessengerTransport = {
  send(psid: string, message: OutgoingMessage): Promise<{ ok: true } | { ok: false; error: string }>;
};
export type MessengerResult = { ok: true; dev?: boolean } | { ok: false; error: string };

let override: MessengerTransport | null = null;

/** Tests only: replace the Graph API call (null restores the real one). */
export function setMessengerTransport(t: MessengerTransport | null): void {
  override = t;
}

export function messengerConfigured(): boolean {
  return !!process.env.MESSENGER_PAGE_TOKEN;
}

export async function sendMessengerMessage(psid: string, message: OutgoingMessage): Promise<MessengerResult> {
  if (!/^\d{1,40}$/.test(psid)) return { ok: false, error: 'invalid recipient' };
  if (override) return override.send(psid, message);
  const token = process.env.MESSENGER_PAGE_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV === 'production') return { ok: false, error: 'MESSENGER_PAGE_TOKEN is not set' };
    console.log(`[messenger:dev] to ${psid}: ${JSON.stringify(message)}`);
    return { ok: true, dev: true };
  }
  try {
    const res = await fetch(GRAPH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // Graph errors carry a code and message; never the token. Do not log the recipient's text.
      let detail = '';
      try {
        const j = (await res.json()) as { error?: { code?: number; message?: string } };
        detail = `code ${j.error?.code ?? '?'}: ${j.error?.message ?? ''}`.trim();
      } catch {
        /* ignore */
      }
      return { ok: false, error: `Messenger send failed (HTTP ${res.status}) ${detail}`.trim() };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Messenger send failed' };
  }
}
