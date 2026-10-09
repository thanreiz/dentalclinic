// node scripts/hosted/smoke.mjs [https://your-app.vercel.app]
// Live end-to-end check on the deployed app: public request -> staff login -> confirm (confirmation email
// to the demo Gmail) -> staff booking for tomorrow -> reminder cron twice (expect sent 1, then sent 0).
// Creates test rows on the hosted DB; run `node scripts/hosted/seed.mjs` afterwards to clear them.
import { loadHostedEnv } from "./load-env.mjs";

const v = loadHostedEnv();
const U = (process.argv[2] || "https://dentalclinic-sooty.vercel.app").replace(/\/$/, "");
const H = { "Content-Type": "application/json", Origin: U };

const json = async (r) => {
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return t.slice(0, 200);
  }
};
const ymd = (d) => d.toISOString().slice(0, 10);
const firstChairId = (res) => {
  const list = Array.isArray(res) ? res : res.chairs ?? [];
  return list[0]?.chairId ?? list[0]?.chair_id;
};

const manila = new Date(Date.now() + 8 * 3600e3);
let day = new Date(manila.getTime() + 14 * 864e5);
if (day.getUTCDay() === 0) day = new Date(day.getTime() + 864e5);
const D = ymd(day);

// 1. Public online request; the patient email is the demo inbox so the emails land somewhere you can see.
const slots = await json(await fetch(`${U}/api/slots?date=${D}&serviceId=1&dentistId=any`));
const slot = slots.slots.at(-1);
let r = await fetch(`${U}/api/requests`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({
    serviceId: 1, dentistId: "any", date: D, start: slot.start,
    fullName: "Smoke Test Patient", contactNumber: "09179990001", email: v.SMTP_USER,
    birthdate: "1990-01-01", consent: true, website: "", patientNote: "live smoke test",
  }),
});
console.log("1 public request", D, slot.start, r.status, JSON.stringify(await json(r)));

// 2. Staff login with the hosted password.
r = await fetch(`${U}/api/auth/login`, {
  method: "POST",
  headers: H,
  body: JSON.stringify({ email: "staff@clinic.test", password: v.SEED_STAFF_PASSWORD }),
});
const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
console.log("2 staff login", r.status, cookie ? "session ok" : "NO SESSION");
const SH = { ...H, Cookie: cookie };

// 3. Confirm the newest pending request with a free chair (sends the confirmation email).
const html = await (await fetch(`${U}/requests`, { headers: SH })).text();
const id = Math.max(...[...html.matchAll(/\/appointments\/(\d+)/g)].map((m) => +m[1]));
const chairs = await json(await fetch(`${U}/api/chairs/free?date=${D}&start=${slot.start}&serviceId=1&excludeId=${id}`, { headers: SH }));
r = await fetch(`${U}/api/appointments/${id}/confirm`, { method: "POST", headers: SH, body: JSON.stringify({ chairId: firstChairId(chairs) }) });
console.log("3 confirm #" + id, r.status, JSON.stringify(await json(r)));

// 4. Staff phone booking for tomorrow, then the reminder job twice.
const T = ymd(new Date(manila.getTime() + 864e5));
const tomorrow = await json(await fetch(`${U}/api/slots?date=${T}&serviceId=1&dentistId=2`, { headers: SH }));
if (!tomorrow.slots?.length) {
  console.log("4 no open slots tomorrow (" + T + "), skipping reminder test");
} else {
  const t = tomorrow.slots.at(-1);
  const c = await json(await fetch(`${U}/api/chairs/free?date=${T}&start=${t.start}&serviceId=1`, { headers: SH }));
  r = await fetch(`${U}/api/appointments`, {
    method: "POST",
    headers: SH,
    body: JSON.stringify({
      newPatient: { fullName: "Smoke Reminder Patient", contactNumber: "09179990002", email: v.SMTP_USER, birthdate: "1991-02-02" },
      serviceId: 1, dentistId: 2, date: T, start: t.start, chairId: firstChairId(c), channel: "phone",
    }),
  });
  console.log("4 staff booking", T, t.start, r.status, JSON.stringify(await json(r)).slice(0, 120));
  for (const n of [1, 2]) {
    r = await fetch(`${U}/api/cron/reminders`, { headers: { Authorization: `Bearer ${v.CRON_SECRET}` } });
    console.log(`5 reminder cron run ${n}`, r.status, JSON.stringify(await json(r)));
  }
}
console.log("\nCheck the demo Gmail inbox (and spam): one confirmation + one reminder. Then: node scripts/hosted/seed.mjs");
