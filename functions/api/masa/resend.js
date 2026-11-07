/**
 * POST /api/masa/resend   — "מסע הכוח" בלבד
 *
 * קונה שהחליף טלפון, מחק את האפליקציה או איבד את המייל — מקליד כאן את
 * המייל שאיתו קנה ומקבל את קישור הגישה שוב.
 *
 * שתי החלטות אבטחה:
 *   1. התשובה היא תמיד "שלחנו" — גם כשאין גישה כזו. אחרת אפשר היה
 *      להשתמש בטופס הזה כדי לבדוק מי קנה ומי לא.
 *   2. חסימת קצב: מייל אחד לכל כתובת ב-10 דקות, כדי שלא יהיה אפשר
 *      להציף תיבה של מישהו.
 *
 * משתני סביבה: SUPABASE_URL, SUPABASE_SERVICE_ROLE, BREVO_API_KEY,
 *               MASA_APP_URL, MASA_SENDER_EMAIL, MASA_SENDER_NAME,
 *               MASA_ALLOWED_ORIGINS
 *               MASA_RATE (KV namespace — אופציונלי. בלעדיו אין חסימת קצב.)
 */

import { issueCode, codeLink } from './_access-code.js';

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
  const headers = { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  // תמיד אותה תשובה. זו לא עצלנות — זו ההגנה.
  const sent = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers });

  let email = '';
  try {
    const body = await request.json();
    email = String(body.email || '').trim().toLowerCase();
  } catch (_) {
    return sent();
  }
  if (!EMAIL_RE.test(email) || email.length > 254) return sent();

  // ---- חסימת קצב ----
  if (env.MASA_RATE) {
    try {
      const key = 'resend:' + email;
      if (await env.MASA_RATE.get(key)) return sent();
      await env.MASA_RATE.put(key, '1', { expirationTtl: 600 });
    } catch (_) {
      /* אם ה-KV לא זמין ממשיכים בלי חסימה */
    }
  }

  context.waitUntil(lookupAndSend(env, email));
  return sent();
}

async function lookupAndSend(env, email) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) return;
  let accessId = 0;
  try {
    const url =
      `${env.SUPABASE_URL}/rest/v1/masa_access` +
      `?email=eq.${encodeURIComponent(email)}&active=is.true&select=id&order=created_at.desc&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        Accept: 'application/json',
      },
    });
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return; // אין גישה — שותקים
    accessId = rows[0].id;
  } catch (err) {
    console.log('resend lookup failed', String(err).slice(0, 200));
    return;
  }

  if (!accessId || !env.BREVO_API_KEY || !(env.MASA_SENDER_EMAIL || env.SENDER_EMAIL) || !env.MASA_APP_URL) return;

  /* ⁑ קוד חדש בכל שליחה, והקודם מת. ככה "שלח לי שוב" הוא גם הדרך
     להיכנס ממכשיר נוסף — והיא עוברת דרך התיבה של הקונה, לא דרך מי
     שבמקרה מחזיק בקישור ישן. */
  const code = await issueCode(env, accessId);
  if (!code) return;
  const link = codeLink(env, code);
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#F2EFE7;
font-family:Arial,Helvetica,sans-serif;color:#1A1A1E">
<div style="max-width:520px;margin:0 auto;padding:32px 22px">
  <h1 style="font-size:22px;margin:0 0 14px">הנה הקישור שלך שוב</h1>
  <p style="font-size:15.5px;line-height:1.8;color:#57534B;margin:0 0 10px">
    ביקשת את קישור הכניסה למסע הכוח. הוא כאן, ונפתח פעם אחת:
  </p>
  <p style="margin:24px 0">
    <a href="${link}" style="display:inline-block;background:#15A65A;color:#fff;
    text-decoration:none;font-size:16px;font-weight:bold;padding:15px 30px;border-radius:12px">
      כניסה למסע הכוח
    </a>
  </p>
  <p style="font-size:14px;line-height:1.8;color:#57534B;margin:0 0 10px">
    <b>לא ביקשת?</b> אפשר להתעלם מהמייל הזה — לא בוצע שום שינוי בחשבון שלך.
  </p>
  <p style="font-size:14px;line-height:1.8;color:#57534B;margin:0">מתן</p>
</div></body></html>`;

  try {
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { email: (env.MASA_SENDER_EMAIL || env.SENDER_EMAIL), name: env.MASA_SENDER_NAME || env.SENDER_NAME || 'מתן קופל' },
        to: [{ email }],
        replyTo: { email: (env.MASA_SENDER_EMAIL || env.SENDER_EMAIL) },
        subject: 'קישור הכניסה שלך למסע הכוח',
        htmlContent: html,
      }),
    });
  } catch (err) {
    console.log('resend email failed', String(err).slice(0, 200));
  }
}
