/**
 * POST /api/masa/verify   — "מסע הכוח" בלבד
 *
 * האפליקציה שולחת לכאן את הטוקן שקיבל הקונה במייל, ושואלת: מותר להיכנס?
 * השרת בודק מול Supabase שהטוקן קיים ושהגישה פעילה.
 *
 * מה הוא לא מחזיר: שום דבר מעבר לכן/לא ולשם הפרטי. לא מספר הזמנה,
 * לא מתי נקנה, ולא מה יש בטבלה. אם מישהו ינחש טוקנים — הוא לא ילמד כלום.
 *
 * משתני סביבה: SUPABASE_URL, SUPABASE_SERVICE_ROLE, MASA_ALLOWED_ORIGINS
 */

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

  let token = '';
  try {
    const body = await request.json();
    token = String(body.token || '').trim();
  } catch (_) {
    return json(400, { ok: false });
  }

  // טוקן תקין הוא 40 תווים הקסדצימליים. כל דבר אחר — החוצה מיד,
  // בלי לגעת במסד הנתונים.
  if (!/^[a-f0-9]{32,64}$/.test(token)) return json(200, { ok: false });

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) {
    return json(503, { ok: false, error: 'not_configured' });
  }

  try {
    const url =
      `${env.SUPABASE_URL}/rest/v1/masa_access` +
      `?token=eq.${encodeURIComponent(token)}&active=is.true&select=id,email&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      console.log('verify query failed', res.status);
      return json(503, { ok: false, error: 'lookup_failed' });
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return json(200, { ok: false });

    // מעדכנים מתי נראה לאחרונה — best effort, לא מעכב את התשובה
    context.waitUntil(touch(env, rows[0].id));

    return json(200, { ok: true });
  } catch (err) {
    console.log('verify threw', String(err).slice(0, 200));
    return json(503, { ok: false, error: 'lookup_failed' });
  }
}

async function touch(env, id) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/masa_access?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
    });
  } catch (_) {
    /* לא קריטי */
  }
}
