/**
 * POST /api/masa/verify   — "מסע הכוח" בלבד
 *
 * ‼️ שני סוגי מפתח, ולא במקרה
 *
 * עד 7.11.2026 מייל הגישה הכיל קישור קבוע (/app/?k=<token>). מי שמחזיק
 * בקישור נכנס, תמיד — אז קונה אחד יכול היה להעביר אותו לעשרה חברים
 * וכולם היו בפנים. בקורס 21 יום זה מעולם לא היה ככה: שם יש חשבון
 * אמיתי, והמייל מכיל קישור חד-פעמי שפג.
 *
 * עכשיו אותו דבר גם כאן:
 *
 *   {code:"<hex>"}      הקוד שהגיע במייל. **חד-פעמי**, ותקף 48 שעות.
 *                       מימוש מוצלח שורף אותו ומחזיר טוקן מכשיר.
 *                       מי שיעביר את המייל לחבר נותן לו כניסה אחת
 *                       לכל היותר, ואז גם הוא עצמו צריך קוד חדש.
 *
 *   {device:"<hex>"}    הטוקן שהאפליקציה שמרה אצלה אחרי המימוש.
 *                       חי כל עוד הגישה פעילה, ולא עובר בשום מייל,
 *                       כך שאין מה להעביר הלאה.
 *
 * כדי להיכנס ממכשיר נוסף מבקשים קוד חדש בטופס שבאפליקציה — והוא נשלח
 * לתיבה של הקונה. זאת הנקודה: ההחזרה עוברת דרך המייל, לא דרך מי
 * שבמקרה מחזיק בקישור.
 *
 * מה הוא לא מחזיר: שום דבר מעבר לכן/לא. לא מייל, לא מספר הזמנה, לא
 * מתי נקנה. מי שינחש קודים לא ילמד כלום.
 *
 * ‼️ דורש את supabase/2026-11-07-masa-devices.sql. בלעדיו הטבלה
 *    masa_devices לא קיימת, וה-API מחזיר lookup_failed.
 *
 * משתני סביבה: SUPABASE_URL, SUPABASE_SERVICE_ROLE, MASA_ALLOWED_ORIGINS
 */

/* כמה זמן קוד מהמייל נשאר תקף. אחרי זה מבקשים חדש. */
const CODE_TTL_MS = 48 * 60 * 60 * 1000;

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.MASA_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function sbHeaders(env, extra) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
    Accept: 'application/json',
    ...(extra || {}),
  };
}

export async function onRequestOptions(context) {
  return new Response(null, { status: 204, headers: corsHeaders(context.request, context.env) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const cors = corsHeaders(request, env);
  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...cors,
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });

  let code = '';
  let device = '';
  try {
    const body = await request.json();
    code = String(body.code || '').trim().toLowerCase();
    device = String(body.device || '').trim().toLowerCase();
  } catch (_) {
    return json(400, { ok: false });
  }

  // כל מה שלא נראה כמו מפתח — החוצה מיד, בלי לגעת במסד הנתונים.
  const HEX = /^[a-f0-9]{32,64}$/;
  if (code && !HEX.test(code)) return json(200, { ok: false });
  if (device && !HEX.test(device)) return json(200, { ok: false });
  if (!code && !device) return json(200, { ok: false });

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) {
    return json(503, { ok: false, error: 'not_configured' });
  }

  try {
    if (code) return await redeemCode(context, json, code);
    return await checkDevice(context, json, device);
  } catch (err) {
    console.log('verify threw', String(err).slice(0, 200));
    return json(503, { ok: false, error: 'lookup_failed' });
  }
}

/**
 * ממש קוד מהמייל: שורף אותו, ופותח מכשיר חדש.
 *
 * ‼️ סדר הפעולות כאן הוא ההגנה. השריפה נעשית עם התנאי
 *    code_used_at=is.null בתוך אותה בקשה, ו-Postgres מחזיר רק את
 *    השורות שבאמת עודכנו. שתי לחיצות במקביל על אותו קישור — רק אחת
 *    תקבל שורה בחזרה. אסור להחליף את זה בקריאה ואז כתיבה, כי ביניהן
 *    יש חלון שבו שתיהן רואות "עוד לא מומש".
 */
async function redeemCode(context, json, code) {
  const { request, env } = context;
  const since = new Date(Date.now() - CODE_TTL_MS).toISOString();

  const burn = await fetch(
    `${env.SUPABASE_URL}/rest/v1/masa_access` +
      `?code=eq.${encodeURIComponent(code)}` +
      `&active=is.true&code_used_at=is.null&code_sent_at=gte.${encodeURIComponent(since)}` +
      `&select=id`,
    {
      method: 'PATCH',
      headers: sbHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({ code_used_at: new Date().toISOString() }),
    },
  );
  if (!burn.ok) {
    console.log('verify redeem failed', burn.status);
    return json(503, { ok: false, error: 'lookup_failed' });
  }
  const rows = await burn.json();
  // קוד לא קיים, כבר מומש, פג, או שהגישה כובתה. כל המקרים נראים זהים
  // מבחוץ, בכוונה.
  if (!Array.isArray(rows) || rows.length === 0) return json(200, { ok: false });

  const token = newToken();
  const made = await fetch(`${env.SUPABASE_URL}/rest/v1/masa_devices`, {
    method: 'POST',
    headers: sbHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({
      access_id: rows[0].id,
      token,
      last_seen_at: new Date().toISOString(),
      user_agent: String(request.headers.get('User-Agent') || '').slice(0, 300),
    }),
  });
  if (!made.ok) {
    console.log('verify device insert failed', made.status);
    return json(503, { ok: false, error: 'lookup_failed' });
  }

  return json(200, { ok: true, device: token });
}

/** מכשיר שכבר נפתח: תקף כל עוד הגישה שמאחוריו פעילה. */
async function checkDevice(context, json, device) {
  const { env } = context;
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/masa_devices` +
      `?token=eq.${encodeURIComponent(device)}` +
      `&select=id,masa_access!inner(active)` +
      `&masa_access.active=is.true&limit=1`,
    { headers: sbHeaders(env) },
  );
  if (!res.ok) {
    console.log('verify device query failed', res.status);
    return json(503, { ok: false, error: 'lookup_failed' });
  }
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return json(200, { ok: false });

  // מתי נראה לאחרונה — best effort, לא מעכב את התשובה.
  context.waitUntil(touch(env, rows[0].id));
  return json(200, { ok: true });
}

function newToken() {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

async function touch(env, id) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/masa_devices?id=eq.${id}`, {
      method: 'PATCH',
      headers: sbHeaders(env, { 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
    });
  } catch (_) {
    /* לא קריטי */
  }
}
