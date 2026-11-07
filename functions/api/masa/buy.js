/**
 * GET /api/masa/buy?email=...[&coupon=...][&ref=...]   — "מסע הכוח" בלבד
 *
 * פותח עסקת Low Profile ב-Cardcom ומעביר את הגולש לעמוד התשלום המאוחסן
 * אצל Cardcom. הסכום נקבע בצד השרת מ-MASA_PRICE — לעולם לא מהדפדפן,
 * כדי שאי אפשר יהיה לשנות אותו בכתובת.
 *
 * ‼️ הפרדה מ"אתגר 21 יום":
 *    ל-21 יום יש אנדפוינט משלו — /api/buy — עם המחיר שלו (147) בסביבה שלו.
 *    הקובץ הזה לא נוגע בו. כל המשתנים כאן מתחילים ב-MASA_, וכל הזמנה
 *    מקבלת ReturnValue שמתחיל ב-"MASA|" כדי שה-webhook ידע לזהות אותה.
 *
 * הנחה למי שבא ממייל הנטישה:
 *    הקישור במיילים הוא /api/masa/buy?coupon=<קוד>. קוד תואם מוריד אחוז
 *    קבוע מהמחיר — הגולש לא מקליד כלום. קוד לא מוכר, או בלי קוד בכלל,
 *    פשוט משלם מחיר מלא. **האחוז נקבע בשרת**, אז אי אפשר להמציא הנחה
 *    בכתובת.
 *
 * משתני סביבה:
 *    CARDCOM_TERMINAL         — מספר המסוף (אותו מסוף לשני המוצרים — זה בסדר)
 *    CARDCOM_API_NAME         — שם משתמש לממשק
 *    MASA_PRICE               — 247
 *    MASA_PRODUCT_NAME        — מסע הכוח
 *    MASA_COUPON_CODE         — קוד ההנחה של מיילי הנטישה (ברירת מחדל: MASA10)
 *    MASA_COUPON_PERCENT      — אחוז ההנחה (ברירת מחדל: 10)
 *
 *    שלוש הכתובות הבאות אופציונליות — בלי הן הן נגזרות מהדומיין של הבקשה:
 *    MASA_SUCCESS_URL         — ברירת מחדל: /api/masa/thanks
 *    MASA_FAILED_URL          — ברירת מחדל: /api/masa/thanks?fail=1
 *    MASA_WEBHOOK_URL         — ברירת מחדל: /api/masa/webhook
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CREATE_URL = 'https://secure.cardcom.solutions/api/v11/LowProfile/Create';

// כתובת מלאה על בסיס הבקשה שהגיעה, כדי שלא נצטרך להזין אותה במשתני הסביבה.
function abs(request, path) {
  return new URL(path, request.url).toString();
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const SHELL = (body) => `<!doctype html>
<html lang="he" dir="rtl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>מסע הכוח</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Secular+One&family=Heebo:wght@400;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;
       background:#F2EFE7;color:#1A1A1E;font-family:Heebo,Arial,sans-serif;
       padding:28px 20px;text-align:center;line-height:1.75}
  .card{background:#fff;border:1px solid #E7E1D4;border-radius:20px;
        padding:32px 24px;max-width:440px;width:100%}
  h1{font-family:'Secular One',Heebo,Arial,sans-serif;font-weight:400;
     font-size:24px;margin:0 0 12px;line-height:1.35}
  p{font-size:15.5px;color:#57534B;margin:0 0 12px}
  input[type=email]{width:100%;padding:14px 16px;font-size:16px;font-family:inherit;
       border:1px solid #D9D2C3;border-radius:12px;text-align:center;
       background:#F8F5EE;color:#1A1A1E}
  input[type=email]:focus{outline:none;border-color:#15A65A;background:#fff}
  button{width:100%;margin-top:12px;background:#15A65A;color:#fff;border:0;
       font-family:inherit;font-weight:700;font-size:16.5px;padding:15px 20px;
       border-radius:12px;cursor:pointer}
  .price{font-size:19px;margin:0 0 6px;color:#1A1A1E;font-weight:700}
  .was{color:#938D80;text-decoration:line-through;font-weight:400;font-size:16px}
  .save{display:inline-block;background:#E6F5EC;color:#0F7A42;font-weight:700;
       font-size:13.5px;padding:5px 12px;border-radius:999px;margin:0 0 14px}
  small{display:block;margin-top:16px;font-size:13px;color:#938D80}
  .agree{display:flex;gap:9px;align-items:flex-start;margin-top:14px;
       text-align:right;font-size:13px;line-height:1.6;color:#57534B;cursor:pointer}
  .agree input{flex:0 0 auto;width:20px;height:20px;margin:1px 0 0;
       accent-color:#15A65A;cursor:pointer}
  .agree b{color:#1A1A1E}
  .agree a{color:#0F7A42}
  .err{color:#B4262B;font-size:14px;margin:0 0 10px}
  a.mail{color:#15A65A}
</style></head>
<body><div class="card">${body}</div></body></html>`;

function errorPage(message) {
  return new Response(SHELL(`
    <h1>משהו השתבש בדרך לתשלום</h1>
    <p>${esc(message)}</p>
    <small>כתוב לי ואפתור את זה מיד:<br>
    <a class="mail" href="mailto:calisthenics.coach@matankopel.co.il">calisthenics.coach@matankopel.co.il</a></small>`),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/**
 * מסך קצר שמבקש מייל.
 * הוא נחוץ כי הקישור במיילי הנטישה מגיע בלי כתובת מייל בכתובת — ובלעדיו
 * הגולש היה נוחת על שגיאה. הקופון נשמר בשדה מוסתר כדי שההנחה לא תיעלם
 * בדרך.
 */
function emailForm(request, { amount, base, coupon, prevValue, showError }) {
  const action = new URL(request.url).pathname;
  const saved = base > amount ? base - amount : 0;
  return new Response(SHELL(`
    <h1>רגע לפני שנתחיל</h1>
    <p class="price">${amount} ש״ח ${saved ? `<span class="was">${base} ש״ח</span>` : ''}</p>
    ${saved ? `<span class="save">ההנחה שלך נשמרה · ${saved} ש״ח פחות</span>` : ''}
    <p>לאן לשלוח את הגישה שלך?</p>
    ${showError ? '<p class="err">הכתובת לא נראית תקינה. תבדוק אותה שוב.</p>' : ''}
    <form method="GET" action="${esc(action)}">
      <input type="email" name="email" required autofocus inputmode="email"
             autocomplete="email" placeholder="your@email.com" value="${esc(prevValue)}">
      ${coupon ? `<input type="hidden" name="coupon" value="${esc(coupon)}">` : ''}
      <label class="agree">
        <input type="checkbox" name="agree" value="1" required>
        <span>קראתי ואני מסכים לתנאי השימוש, ומאשר ש<b>אחרי הרכישה לא ניתן לבטל
        את העסקה ולא יינתן החזר כספי.</b>
        <a href="/masa/" target="_blank" rel="noopener">לקריאת התקנון</a></span>
      </label>
      <button type="submit">מעבר לתשלום מאובטח</button>
    </form>
    <small>תשלום חד-פעמי · גישה מיידית · המייל ישמש לשליחת הגישה ולעדכונים ממני,
    ואפשר להסיר את עצמך בכל רגע.</small>`),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/**
 * /api/masa/buy?health=1 — בדיקת חיבורים. לא פותח עסקה ולא גובה כלום.
 * מחזיר רק כן/לא ומספרי סטטוס. **אף פעם לא ערכים של מפתחות.**
 */
async function health(env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  let supabase = 'no-config';
  if (base && env.SUPABASE_SERVICE_ROLE) {
    try {
      const res = await fetch(`${base}/rest/v1/masa_orders?select=id&limit=1`, {
        headers: {
          apikey: env.SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        },
      });
      supabase = `http-${res.status}`;
      if (!res.ok) supabase += ' ' + (await res.text().catch(() => '')).slice(0, 160);
    } catch (err) {
      supabase = 'threw ' + String(err).slice(0, 120);
    }
  }
  return new Response(
    JSON.stringify({
      ok: true,
      endpoint: 'masa/buy',
      configured: {
        terminal: !!Number(env.CARDCOM_TERMINAL),
        apiName: !!env.CARDCOM_API_NAME,
        price: env.MASA_PRICE || null,
        product: env.MASA_PRODUCT_NAME || null,
        coupon: env.MASA_COUPON_CODE ? `${env.MASA_COUPON_CODE} -${env.MASA_COUPON_PERCENT || 10}%` : null,
        leadsList: env.MASA_BREVO_LIST_LEADS || null,
        buyersList: env.MASA_BREVO_LIST_BUYERS || null,
        brevoKey: !!env.BREVO_API_KEY,
      },
      supabase,
      ts: new Date().toISOString(),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (url.searchParams.get('health') === '1') return health(env);
  const email = (url.searchParams.get('email') || '').trim().toLowerCase();
  const ref = (url.searchParams.get('ref') || '').slice(0, 60);

  const terminal = Number(env.CARDCOM_TERMINAL);
  const apiName = env.CARDCOM_API_NAME;
  const base = Number(env.MASA_PRICE);
  if (!terminal || !apiName || !Number.isFinite(base) || base <= 0) {
    return errorPage('עמוד התשלום עדיין לא מחובר.');
  }

  // ---- הנחה מתוך מייל הנטישה -------------------------------------------
  // האחוז מגיע מהסביבה בלבד. מי שישנה את הכתובת לא ישנה את המחיר.
  const couponInput = String(url.searchParams.get('coupon') || '').trim().slice(0, 40);
  const couponCode = String(env.MASA_COUPON_CODE || 'MASA10').trim();
  const couponPct = Math.min(90, Math.max(0, Number(env.MASA_COUPON_PERCENT ?? 10)));
  const couponOk = !!couponInput && !!couponCode && couponPct > 0 &&
    couponInput.toLowerCase() === couponCode.toLowerCase();
  const amount = couponOk ? Math.max(1, Math.round(base * (100 - couponPct) / 100)) : base;
  const couponForForm = couponOk ? couponInput : '';

  // ---- מייל ------------------------------------------------------------
  // בלי מייל אי אפשר לפתוח גישה, אז מבקשים אותו כאן במקום לזרוק שגיאה.
  if (!email) {
    return emailForm(request, { amount, base, coupon: couponForForm, prevValue: '', showError: false });
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return emailForm(request, { amount, base, coupon: couponForForm, prevValue: email, showError: true });
  }

  const product = String(env.MASA_PRODUCT_NAME || 'מסע הכוח').slice(0, 50);

  // "MASA|" הוא הסימן שה-webhook מחפש. בלעדיו הוא יתעלם מההודעה.
  const returnValue = `MASA|${email}`.slice(0, 250);

  const payload = {
    TerminalNumber: terminal,
    ApiName: apiName,
    Operation: 'ChargeOnly',
    Amount: amount,
    ISOCoinId: 1, // שקל
    Language: 'he',
    ProductName: product,
    ReturnValue: returnValue,
    SuccessRedirectUrl: env.MASA_SUCCESS_URL || abs(request, '/api/masa/thanks'),
    FailedRedirectUrl: env.MASA_FAILED_URL || abs(request, '/api/masa/thanks?fail=1'),
    WebHookUrl: env.MASA_WEBHOOK_URL || abs(request, '/api/masa/webhook'),
    Document: {
      DocumentTypeToCreate: 'Order',
      Name: email,
      Email: email,
      IsSendByEmail: true,
      Products: [{ Description: product, Quantity: 1, UnitCost: amount }],
    },
  };

  let data;
  try {
    const res = await fetch(CREATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    data = await res.json();
  } catch (err) {
    console.log('cardcom create threw', String(err).slice(0, 300));
    return errorPage('לא הצלחנו להגיע לחברת הסליקה.');
  }

  if (data.ResponseCode !== 0 || !data.Url) {
    console.log('cardcom create failed', data.ResponseCode, String(data.Description).slice(0, 200));
    return errorPage('חברת הסליקה החזירה שגיאה.');
  }

  // רישום הזמנה — best effort. אם Supabase נופל, התשלום עדיין ממשיך.
  context.waitUntil(recordOrder(env, {
    email, ref, lowProfileId: data.LowProfileId, amount,
    coupon: couponOk ? couponCode : null,
    // חותמת ההסכמה לתקנון. הצ'קבוקס בדף ובטופס הנסיגה שולח agree=1.
    agreedAt: url.searchParams.get('agree') === '1' ? new Date().toISOString() : null,
  }));

  return Response.redirect(data.Url, 302);
}

/**
 * רישום ההזמנה. best effort — אם זה נכשל, התשלום עדיין ממשיך.
 *
 * מחזיר מחרוזת מצב כדי ש-?health=1 יוכל להראות אותה. חשוב: fetch לא
 * זורק שגיאה על 400 או 401, אז בלי הבדיקה של res.ok הכישלון היה שקט.
 */
async function recordOrder(env, order) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE) return 'no-config';
  const base = String(env.SUPABASE_URL).replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/rest/v1/masa_orders?on_conflict=low_profile_id`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({
        low_profile_id: order.lowProfileId,
        email: order.email,
        ref: order.ref || null,
        coupon: order.coupon,
        amount: order.amount,
        status: 'pending',
        terms_agreed_at: order.agreedAt,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.log('order record rejected', res.status, body.slice(0, 300));
      return `http-${res.status}`;
    }
    return 'ok';
  } catch (err) {
    console.log('order record threw', String(err).slice(0, 200));
    return 'threw';
  }
}
