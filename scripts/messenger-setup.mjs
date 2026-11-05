/**
 * One-time Messenger Page setup: a "Get Started" button and a persistent menu with "Start over".
 * Run by hand, never from CI:
 *
 *   MESSENGER_PAGE_TOKEN=... node scripts/messenger-setup.mjs
 *
 * It calls Meta's Messenger Profile API for the Page the token belongs to. The token is read from
 * the environment and never printed. Postback payloads match lib/services/messenger-bot.ts:
 * "GET_STARTED" (greeting), "book" and "restart".
 */
const token = process.env.MESSENGER_PAGE_TOKEN;
if (!token) {
  console.error('Set MESSENGER_PAGE_TOKEN first.');
  process.exit(1);
}

const res = await fetch('https://graph.facebook.com/v21.0/me/messenger_profile', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({
    get_started: { payload: 'GET_STARTED' },
    persistent_menu: [
      {
        locale: 'default',
        composer_input_disabled: false,
        call_to_actions: [
          { type: 'postback', title: 'Book appointment', payload: 'book' },
          { type: 'postback', title: 'Start over', payload: 'restart' },
        ],
      },
    ],
  }),
});
const body = await res.json().catch(() => ({}));
console.log(res.ok ? 'Messenger profile updated.' : `Failed (HTTP ${res.status}): ${body?.error?.message ?? 'unknown error'}`);
process.exit(res.ok ? 0 : 1);
