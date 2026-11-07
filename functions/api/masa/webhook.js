/**
 * POST /api/masa/webhook   — "מסע הכוח" בלבד
 *
 * Cardcom מדווח לכאן אחרי כל עסקה. אנחנו לא מאמינים לדיווח כמו שהוא:
 * לוקחים ממנו רק את LowProfileId, ומאמתים מול Cardcom ב-GetLpResult.
 * רק אם האימות מחזיר ResponseCode=0 פותחים גישה.
 *
 * ‼️ הפרדה מ"אתגר 21 יום" — זה הסעיף הכי חשוב בקובץ:
 *    כל הזמנה של מסע הכוח נפתחת עם ReturnValue שמתחיל ב-"MASA|".
 *    אם הגיעה לכאן הודעה בלי התחילית הזו — היא שייכת למוצר אחר,
 *    ואנחנו מחזירים 200 ולא נוגעים בכלום. ככה קונה של 21 יום
 *    לא יקבל גישה למסע הכוח גם אם מישהו יצביע בטעות על הכתובת הזו.
 *
 * משתני סביבה:
 *    CARDCOM_TERMINAL, CARDCOM_API_NAME
 *    SUPABASE_URL, SUPABASE_SERVICE_ROLE   — service_role. סודי ביותר.
 *    BREVO_API_KEY
 *    MASA_BREVO_LIST_LEADS, MASA_BREVO_LIST_BUYERS
 *    MASA_APP_URL        — כתובת האפליקציה, למשל https://masa.matankopel.co.il
 *    MASA_SENDER_EMAIL   — כתובת השולח המאומתת ב-Brevo
 *    MASA_SENDER_NAME    — מתן קופל
 */

const RESULT_URL = 'https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult';
const PREFIX = 'MASA|';

export async function onRequestPost(context) {
  const { request, env } = context;

  // ---- 1. מאיפה הגיע ה-LowProfileId ----
  let lowProfileId = '';
  try {
    const ct = request.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
      const body = await request.json();
      lowProfileId = String(body.LowProfileId || body.lowProfileId || body.lowprofilecode || '');
    } else {
      // Cardcom שולח לפעמים form-urlencoded, ולא תמיד באותו איות
      const form = await request.formData();
      for (const key of ['LowProfileId', 'lowProfileId', 'lowprofilecode', 'LowProfileCode']) {
        const v = form.get(key);
        if (v) {
          lowProfileId = String(v);
          break;
        }
      }
    }
  } catch (_) {
    /* נופל לבדיקה למטה */
  }
  if (!lowProfileId) {
    // לא מבקשים מ-Cardcom לנסות שוב — אין מה לאמת
    return new Response('no id', { status: 200 });
  }

  // ---- 2. אימות מול Cardcom ----
  let result;
  try {
    const res = await fetch(RESULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        TerminalNumber: Number(env.CARDCOM_TERMINAL),
        ApiName: env.CARDCOM_API_NAME,
        LowProfileId: lowProfileId,
      }),
    });
    result = await res.json();
  } catch (err) {
    console.log('getlpresult threw', String(err).slice(0, 300));
    return new Response('retry', { status: 500 }); // Cardcom ינסה שוב
  }

  if (result.ResponseCode !== 0) {
    console.log('transaction not successful', result.ResponseCode, String(result.Description).slice(0, 200));
    return new Response('not successful', { status: 200 });
  }

  // ---- 3. השומר: זה בכלל מסע הכוח? ----
  const returnValue = String(result.ReturnValue || '');
  if (!returnValue.startsWith(PREFIX)) {
    console.log('ignoring — not a masa order:', returnValue.slice(0, 40));
    return new Response('not mine', { status: 200 });
  }

  const email = returnValue.slice(PREFIX.length).trim().toLowerCase();
  if (!email || !email.includes('@')) {
    console.log('masa order without a usable email', returnValue.slice(0, 60));
    return new Response('bad email', { status: 200 });
  }

  // ---- 4. פתיחת גישה (פעם אחת בלבד) ----
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  const granted = await grantAccess(env, {
    email,
    lowProfileId,
    token,
    transactionId: String(result.TranzactionId || ''),
  });

  if (granted === 'error') {
    return new Response('retry', { status: 500 }); // שיגיע שוב, לא נאבד קונה
  }
  if (granted === 'duplicate') {
    return new Response('already granted', { status: 200 });
  }

  // ---- 5. מעבר מרשימת הלידים לרשימת הקונים + מייל גישה ----
  context.waitUntil(
    Promise.all([moveToBuyers(env, email), sendAccessEmail(env, email, token)])
  );

  return new Response('ok', { status: 200 });
}

/** מחזיר 'ok' | 'duplicate' | 'error' */
async function grantAccess(env, { email, lowProfileId, token, transactionId }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) return 'error';
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/masa_access`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        email,
        low_profile_id: lowProfileId, // UNIQUE בטבלה — זה מה שמונע כפילות
        transaction_id: transactionId || null,
        token,
      }),
    });
    if (res.status === 201 || res.status === 204) return 'ok';
    if (res.status === 409) return 'duplicate'; // כבר קיים — Cardcom שלח שוב
    console.log('supabase grant failed', res.status, (await res.text()).slice(0, 300));
    return 'error';
  } catch (err) {
    console.log('supabase grant threw', String(err).slice(0, 300));
    return 'error';
  }
}

async function moveToBuyers(env, email) {
  const buyers = Number(env.MASA_BREVO_LIST_BUYERS);
  const leads = Number(env.MASA_BREVO_LIST_LEADS);
  if (!env.BREVO_API_KEY || !buyers) return;
  try {
    await fetch(`https://api.brevo.com/v3/contacts`, {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        email,
        updateEnabled: true,
        listIds: [buyers],
        unlinkListIds: leads ? [leads] : undefined,
        attributes: { MASA_STATUS: 'buyer' },
      }),
    });
  } catch (err) {
    console.log('brevo move failed', String(err).slice(0, 200));
  }
}

async function sendAccessEmail(env, email, token) {
  if (!env.BREVO_API_KEY || !(env.MASA_SENDER_EMAIL || env.SENDER_EMAIL) || !env.MASA_APP_URL) return;
  const link = `${env.MASA_APP_URL.replace(/\/$/, '')}/?k=${token}`;
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#F2EFE7;
font-family:Arial,Helvetica,sans-serif;color:#1A1A1E">
<div style="max-width:520px;margin:0 auto;padding:32px 22px">
  <h1 style="font-size:23px;margin:0 0 14px">אתה בפנים. 💪</h1>
  <p style="font-size:15.5px;line-height:1.8;color:#57534B;margin:0 0 10px">
    התשלום נקלט והגישה שלך למסע הכוח פתוחה. הכפתור הזה פותח לך את התוכנית:
  </p>
  <p style="margin:24px 0">
    <a href="${link}" style="display:inline-block;background:#15A65A;color:#fff;
    text-decoration:none;font-size:16px;font-weight:bold;padding:15px 30px;border-radius:12px">
      כניסה למסע הכוח
    </a>
  </p>
  <p style="font-size:14px;line-height:1.8;color:#57534B;margin:0 0 10px">
    <b>שמור את המייל הזה.</b> הקישור אישי ומיועד לך בלבד.<br>
    בכניסה הראשונה תתבקש לשמור את האפליקציה במסך הבית — אחרי זה נכנסים בלחיצה אחת,
    בלי לחפש את המייל כל פעם.
  </p>
  <p style="font-size:14px;line-height:1.8;color:#57534B;margin:0">
    משהו לא עובד? פשוט תענה למייל הזה.<br>מתן
  </p>
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
        subject: 'הגישה שלך למסע הכוח פתוחה',
        htmlContent: html,
      }),
    });
  } catch (err) {
    console.log('access email failed', String(err).slice(0, 200));
  }
}
