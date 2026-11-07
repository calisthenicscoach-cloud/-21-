/**
 * POST /api/masa/lead   — "מסע הכוח" בלבד
 *
 * תופס את המייל ברגע שהוא מוקלד בדף המכירה, לפני התשלום,
 * ומכניס אותו לרשימת הלידים של מסע הכוח ב-Brevo.
 *
 * ‼️ הפרדה מ"אתגר 21 יום":
 *    הקורס 21 יום שולח מיילים ל-Make.com ולא לכאן. הקובץ הזה נוגע
 *    אך ורק ברשימה שמזוהה ב-MASA_BREVO_LIST_LEADS. אל תשתמש כאן
 *    בשום מזהה רשימה אחר.
 *
 * משתני סביבה (Cloudflare → Settings → Environment variables):
 *    BREVO_API_KEY            — מפתח Brevo. סודי. לא בקוד ולא בגיטהאב.
 *    MASA_BREVO_LIST_LEADS    — מספר הרשימה "מסע הכוח – לידים"
 *    MASA_ALLOWED_ORIGINS     — רשימת מקורות מופרדת בפסיקים שמותר להם לקרוא,
 *                               למשל: https://claude.ai,https://matankopel.co.il
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

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
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });

  let email = '';
  let ref = '';
  try {
    const ct = request.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
      const body = await request.json();
      email = String(body.email || '');
      ref = String(body.ref || '');
    } else {
      const form = await request.formData();
      email = String(form.get('email') || '');
      ref = String(form.get('ref') || '');
    }
  } catch (_) {
    return json(400, { ok: false, error: 'bad_body' });
  }

  email = email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json(400, { ok: false, error: 'bad_email' });
  }

  const listId = Number(env.MASA_BREVO_LIST_LEADS);
  if (!env.BREVO_API_KEY || !listId) {
    // חסר קונפיג — לא מפילים את הדף, אבל גם לא משקרים ללקוח
    return json(503, { ok: false, error: 'not_configured' });
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        email,
        updateEnabled: true, // קיים כבר? רק מעדכנים, לא נכשלים
        listIds: [listId],
        attributes: {
          MASA_STATUS: 'lead',
          MASA_REF: ref.slice(0, 60),
        },
      }),
    });

    // 201 נוצר, 204 עודכן. כל השאר — נכשל.
    if (res.status !== 201 && res.status !== 204) {
      const text = await res.text();
      console.log('brevo lead failed', res.status, text.slice(0, 300));
      return json(502, { ok: false, error: 'brevo_failed' });
    }
  } catch (err) {
    console.log('brevo lead threw', String(err).slice(0, 300));
    return json(502, { ok: false, error: 'brevo_unreachable' });
  }

  return json(200, { ok: true });
}
