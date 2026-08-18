/**
 * POST /api/grant-access
 * Opens course access for a buyer, emails them a passwordless login link, and
 * adds them to the mailing list. Called after a successful payment.
 *
 * For now it is protected by a shared secret (GRANT_SECRET) so we can test it
 * with a simulated payment. When Cardcom is wired, its webhook signature /
 * terminal check is added on top and the real buyer email is read from the
 * Cardcom payload.
 *
 * Environment variables (Cloudflare Pages → Settings → Variables and Secrets):
 *   SUPABASE_URL           e.g. https://jfrsvhkqtyxfcwldsekg.supabase.co
 *   SUPABASE_SERVICE_ROLE  Supabase service_role key (SECRET — server only)
 *   BREVO_API_KEY          Brevo v3 API key (SECRET)
 *   BREVO_LIST_ID          Brevo contact list id (number)
 *   SENDER_EMAIL           verified Brevo sender, e.g. calisthenics.coach@matankopel.co.il
 *   SENDER_NAME            display name, e.g. "מתן קופל"
 *   COURSE_URL             where the login link lands, e.g. https://matankopel.pages.dev/course/
 *   GRANT_SECRET           shared secret guarding this endpoint (SECRET)
 */

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

// Health check, and a convenient browser test: /api/grant-access?email=you@x.com&secret=THE_SECRET
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const email = url.searchParams.get('email');
  const secret = url.searchParams.get('secret');
  if (email || secret) {
    if (!env.GRANT_SECRET || secret !== env.GRANT_SECRET) return json({ error: 'unauthorized' }, 401);
    return runGrant(env, email);
  }
  return json({ ok: true, endpoint: 'grant-access', ts: new Date().toISOString() });
}

// Real trigger (Cardcom webhook will POST here): { "email": "...", "secret": "..." }
export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json().catch(() => ({}));
  const provided = request.headers.get('x-grant-secret') || body.secret || '';
  if (!env.GRANT_SECRET || provided !== env.GRANT_SECRET) return json({ error: 'unauthorized' }, 401);
  return runGrant(env, body.email);
}

// Shared flow: open access → email a login link → add to the mailing list
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
  return {
    apikey: env.SUPABASE_SERVICE_ROLE,
    authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE,
    'content-type': 'application/json',
  };
}

// create the auth user if missing; ignore "already registered"
async function ensureUser(env, email) {
  const res = await fetch(env.SUPABASE_URL + '/auth/v1/admin/users', {
    method: 'POST',
    headers: sbHeaders(env),
    body: JSON.stringify({ email, email_confirm: true }),
  });
  if (!res.ok && res.status !== 422) {
    // 422 = user already exists; anything else is a real error
    const t = await res.text();
    throw new Error('createUser failed (' + res.status + '): ' + t);
  }
}

// mark the profile as paid (has_access = true). Safe if already true.
async function grantAccess(env, email) {
  const res = await fetch(
    env.SUPABASE_URL + '/rest/v1/profiles?email=eq.' + encodeURIComponent(email),
    {
      method: 'PATCH',
      headers: { ...sbHeaders(env), Prefer: 'return=minimal' },
      body: JSON.stringify({ has_access: true }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error('grantAccess failed (' + res.status + '): ' + t);
  }
}

// admin-generate a magic login link (does not send it — we send via Brevo)
async function generateMagicLink(env, email) {
  const res = await fetch(env.SUPABASE_URL + '/auth/v1/admin/generate_link', {
    method: 'POST',
    headers: sbHeaders(env),
    body: JSON.stringify({ type: 'magiclink', email, redirect_to: env.COURSE_URL }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error('generateLink failed (' + res.status + '): ' + JSON.stringify(data));
  const link = data.action_link || (data.properties && data.properties.action_link);
  if (!link) throw new Error('no action_link in generateLink response');
  return link;
}

/* ---------------- Brevo (transactional email + contacts) ---------------- */

async function sendLoginEmail(env, email, link) {
  const html = `
    <div dir="rtl" style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#111">
      <h2 style="margin:0 0 6px">ברוך הבא לאתגר! 💪</h2>
      <p style="font-size:15px;line-height:1.6;color:#333">
        התשלום התקבל והגישה שלך לקורס נפתחה. לחץ על הכפתור כדי להיכנס — בלי סיסמה:
      </p>
      <p style="text-align:center;margin:26px 0">
        <a href="${link}" style="background:#2563EB;color:#fff;text-decoration:none;
           font-weight:800;font-size:16px;padding:14px 26px;border-radius:12px;display:inline-block">
          כניסה לקורס ←
        </a>
      </p>
      <p style="font-size:12.5px;color:#777;line-height:1.6">
        אם הכפתור לא עובד, העתק את הקישור הזה לדפדפן:<br>
        <span style="word-break:break-all">${link}</span>
      </p>
    </div>`;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: env.SENDER_NAME || 'הקורס', email: env.SENDER_EMAIL },
      to: [{ email }],
      subject: 'הכניסה שלך לקורס — 21 יום 🎉',
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('sendEmail failed (' + res.status + '): ' + t);
  }
}

async function addToList(env, email) {
  const res = await fetch('https://api.brevo.com/v3/contacts', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ email, listIds: [Number(env.BREVO_LIST_ID)], updateEnabled: true }),
  });
  // 201 created, 204 updated — both fine; Brevo returns 400 if already in list sometimes
  if (!res.ok && res.status !== 204) {
    const t = await res.text();
    throw new Error('addToList failed (' + res.status + '): ' + t);
  }
}
