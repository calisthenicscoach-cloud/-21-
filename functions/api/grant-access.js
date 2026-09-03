/**
 * /api/grant-access
 * Opens course access for a buyer, emails a passwordless login link, and adds
 * them to the mailing list. Triggered by the Cardcom payment "Notify" webhook
 * (POST) after a successful payment, or by a shared-secret test call.
 *
 * Auth:
 *   - our own tests: secret via ?secret= (GET), body.secret, or x-grant-secret header
 *   - Cardcom Notify: a token in the URL — set the Notify URL to
 *       https://matankopel.pages.dev/api/grant-access?token=<GRANT_SECRET>
 *
 * Env (Cloudflare Pages → Variables and Secrets):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE, BREVO_API_KEY, BREVO_LIST_ID,
 *   SENDER_EMAIL, SENDER_NAME, COURSE_URL, GRANT_SECRET
 *   MAKE_FORWARD_URL (optional) — a webhook to receive a copy of each Cardcom
 *     notification (e.g. the marketer's Make.com scenario for their tracking).
 */

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const ok = () => new Response('OK', { status: 200 });

// Health check + browser test: /api/grant-access?email=you@x.com&secret=THE_SECRET
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  const secret = url.searchParams.get('secret');

  // Diagnostic: /api/grant-access?diag=1&secret=THE_SECRET — reports whether the
  // Make forward is configured and sends one test POST to it, returning the status.
  if (url.searchParams.get('diag') === '1') {
    if (!env.GRANT_SECRET || secret !== env.GRANT_SECRET) return json({ error: 'unauthorized' }, 401);
    const out = { makeConfigured: !!env.MAKE_FORWARD_URL, makeUrlTail: env.MAKE_FORWARD_URL ? env.MAKE_FORWARD_URL.slice(-8) : null };
    if (env.MAKE_FORWARD_URL) {
      try {
        const r = await fetch(env.MAKE_FORWARD_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'diag=1&from=grant-access' });
        out.makePostStatus = r.status;
      } catch (e) { out.makeError = String((e && e.message) || e); }
    }
    return json(out);
  }

  if (email || secret) {
    if (!env.GRANT_SECRET || secret !== env.GRANT_SECRET) return json({ error: 'unauthorized' }, 401);
    return runGrant(env, email);
  }
  return json({ ok: true, endpoint: 'grant-access', ts: new Date().toISOString() });
}

// Real trigger: Cardcom POSTs here (form-encoded); our own test can POST JSON {email, secret}.
export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const ct = request.headers.get('content-type') || '';
  const raw = await request.text().catch(() => '');
  const params = parseParams(raw, ct);
  url.searchParams.forEach((v, k) => { if (!(k in params)) params[k] = v; });

  // auth: our secret (header/body) or a URL token (used by the Cardcom Notify URL)
  const provided = request.headers.get('x-grant-secret') || params.secret || url.searchParams.get('token') || '';
  if (!env.GRANT_SECRET || provided !== env.GRANT_SECRET) return json({ error: 'unauthorized' }, 401);

  // Forward a copy of the Cardcom payload to the marketer's Make webhook so their
  // tracking keeps working through our single Notify URL. Fire-and-forget.
  if (env.MAKE_FORWARD_URL) {
    const p = forwardToMake(env.MAKE_FORWARD_URL, raw, ct);
    if (context.waitUntil) context.waitUntil(p); else p.catch(() => {});
  }

  // Optional debugging: set GRANT_DEBUG=1 to receive a copy of the raw fields.
  if (env.GRANT_DEBUG === '1' && env.BREVO_API_KEY && env.SENDER_EMAIL) { try { await debugEmail(env, params); } catch (e) {} }

  // Only grant on a successful payment (when this looks like a Cardcom notify).
  if (looksLikeCardcom(params) && !cardcomSucceeded(params)) return ok();

  const email = pickEmail(params);
  if (!email) return ok(); // acknowledge; nothing to grant yet
  await runGrant(env, email);
  return ok(); // Cardcom just needs a 200
}

/* ---------------- request parsing / field mapping ---------------- */

function parseParams(raw, ct) {
  if ((ct || '').toLowerCase().includes('application/json')) { try { return JSON.parse(raw || '{}'); } catch (e) { return {}; } }
  const out = {};
  try { new URLSearchParams(raw).forEach((v, k) => { out[k] = v; }); } catch (e) {}
  return out;
}

// Best-effort copy of the incoming payload to an external webhook (the marketer's
// Make.com), sent in the same shape Cardcom sent it. Never blocks the response.
async function forwardToMake(target, raw, ct) {
  try {
    await fetch(target, { method: 'POST', headers: { 'content-type': ct || 'application/x-www-form-urlencoded' }, body: raw });
  } catch (e) {}
}

function pickEmail(p) {
  // Cardcom sends the buyer's address as CardOwnerEmail; the rest are safety nets.
  const keys = ['CardOwnerEmail', 'cardOwnerEmail', 'cardownermail',
    'email', 'Email', 'EMail', 'mail', 'UserEmail', 'userEmail', 'owneremail', 'payeremail'];
  for (const k of keys) { const v = p[k]; if (v && String(v).includes('@')) return String(v).trim().toLowerCase(); }
  for (const k in p) { const v = String(p[k] || ''); if (v.includes('@') && v.includes('.')) return v.trim().toLowerCase(); }
  return '';
}

function looksLikeCardcom(p) {
  return ['terminalnumber', 'TerminalNumber', 'lowprofilecode', 'LowProfileCode',
    'ResponseCode', 'OperationResponse', 'DealResponse'].some((k) => k in p);
}

// A Cardcom low-profile deal is approved when the deal response is 0. We do NOT
// gate on OperationResponse — it can read 5119/"PENDING" on a successful auth.
// ResponseCode is only a fallback when no deal field is present. Fail closed:
// if it looks like Cardcom but we can't confirm success, don't grant.
function cardcomSucceeded(p) {
  for (const k of ['DealResponse', 'DealRespone']) {
    if (k in p) return String(p[k]).trim() === '0';
  }
  if ('ResponseCode' in p) return String(p.ResponseCode).trim() === '0';
  return false;
}

async function debugEmail(env, params) {
  const rows = Object.keys(params).map((k) =>
    `<tr><td style="padding:2px 8px;border:1px solid #ccc"><b>${k}</b></td><td style="padding:2px 8px;border:1px solid #ccc;word-break:break-all">${String(params[k])}</td></tr>`).join('');
  const html = `<div dir="ltr"><h3>Cardcom webhook received</h3><table style="border-collapse:collapse">${rows || '<tr><td>(empty)</td></tr>'}</table></div>`;
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ sender: { name: 'Webhook Debug', email: env.SENDER_EMAIL }, to: [{ email: env.SENDER_EMAIL }], subject: '🔧 Cardcom webhook debug', htmlContent: html }),
  });
}

/* ---------------- grant flow ---------------- */

async function runGrant(env, rawEmail) {
  try {
    const email = String(rawEmail || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return json({ error: 'missing or invalid email' }, 400);
    await ensureUser(env, email);
    await grantAccess(env, email);
    const link = await generateMagicLink(env, email);
    await sendLoginEmail(env, email, link);
    let listed = true;
    try { await addToList(env, email); } catch (e) { listed = false; }
    return json({ ok: true, email, listed });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

/* ---------------- Supabase admin (REST, service_role) ---------------- */

function sbHeaders(env) {
  return { apikey: env.SUPABASE_SERVICE_ROLE, authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE, 'content-type': 'application/json' };
}

async function ensureUser(env, email) {
  const res = await fetch(env.SUPABASE_URL + '/auth/v1/admin/users', {
    method: 'POST', headers: sbHeaders(env), body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!res.ok && res.status !== 422) { throw new Error('createUser failed (' + res.status + '): ' + (await res.text())); }
}

async function grantAccess(env, email) {
  const res = await fetch(env.SUPABASE_URL + '/rest/v1/profiles?email=eq.' + encodeURIComponent(email), {
    method: 'PATCH', headers: { ...sbHeaders(env), Prefer: 'return=minimal' }, body: JSON.stringify({ has_access: true }),
  });
  if (!res.ok) throw new Error('grantAccess failed (' + res.status + '): ' + (await res.text()));
}

async function generateMagicLink(env, email) {
  const res = await fetch(env.SUPABASE_URL + '/auth/v1/admin/generate_link', {
    method: 'POST', headers: sbHeaders(env), body: JSON.stringify({ type: 'magiclink', email, redirect_to: env.COURSE_URL }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('generateLink failed (' + res.status + '): ' + JSON.stringify(data));
  const props = data.properties || data;
  // Prefer a token_hash link: the course verifies it with verifyOtp, which works
  // in any browser (unlike the raw action_link, which needs a PKCE verifier the
  // buyer's browser doesn't have — that dropped buyers on the login screen).
  const hashed = props.hashed_token || data.hashed_token;
  if (hashed) {
    const base = env.COURSE_URL;
    return base + (base.includes('?') ? '&' : '?') + 'token_hash=' + encodeURIComponent(hashed) + '&type=magiclink';
  }
  const link = props.action_link || data.action_link;
  if (!link) throw new Error('no login link in generateLink response');
  return link;
}

/* ---------------- Brevo (email + contacts) ---------------- */

async function sendLoginEmail(env, email, link) {
  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#111">
      <h2 style="margin:0 0 6px">ברוך הבא לאתגר! 💪</h2>
      <p style="font-size:15px;line-height:1.6;color:#333">התשלום התקבל והגישה שלך לקורס נפתחה. לחץ על הכפתור כדי להיכנס — בלי סיסמה:</p>
      <p style="text-align:center;margin:26px 0">
        <a href="${link}" style="background:#2563EB;color:#fff;text-decoration:none;font-weight:800;font-size:16px;padding:14px 26px;border-radius:12px;display:inline-block">כניסה לקורס ←</a>
      </p>
      <p style="font-size:12.5px;color:#777;line-height:1.6">אם הכפתור לא עובד, העתק את הקישור לדפדפן:<br><span style="word-break:break-all">${link}</span></p>
    </div>`;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ sender: { name: env.SENDER_NAME || 'הקורס', email: env.SENDER_EMAIL }, to: [{ email }], subject: 'הכניסה שלך לקורס — 21 יום 🎉', htmlContent: html }),
  });
  if (!res.ok) throw new Error('sendEmail failed (' + res.status + '): ' + (await res.text()));
}

async function addToList(env, email) {
  const res = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, listIds: [Number(env.BREVO_LIST_ID)], updateEnabled: true }),
  });
  if (!res.ok && res.status !== 204) throw new Error('addToList failed (' + res.status + '): ' + (await res.text()));
}
