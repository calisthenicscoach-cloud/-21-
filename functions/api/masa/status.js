/**
 * GET /api/masa/status?lpid=<LowProfileId>   — "מסע הכוח" בלבד
 *
 * ‼️ למה הקובץ הזה קיים
 *
 * קארדקום מחזיר את הגולש לדף התודה (SuccessRedirectUrl) או לדף הכישלון
 * (FailedRedirectUrl). ההחזרה הזאת היא *בדפדפן*, והיא לא תמיד מסונכרנת
 * עם מה שקרה בפועל אצל קארדקום:
 *
 *   - 3D-Secure: הגולש מאשר באפליקציית הבנק, הדפדפן חוזר, והחיוב עדיין
 *     מסתיים ברגע הזה בצד של קארדקום.
 *   - הגולש לוחץ "אחורה", סוגר חלון, או שהרשת נופלת באמצע.
 *   - כל אחד יכול פשוט להקליד ?fail=1 בכתובת.
 *
 * ולכן **אסור לדף להכריז "התשלום נדחה" רק כי הגיע ל-?fail=1**. קונה
 * אמיתי ששילם היה רואה "לא עבר", משלם שוב, או מוותר. זה הנזק שהקובץ
 * הזה מונע.
 *
 * מקור האמת היחיד הוא GetLpResult אצל קארדקום, בדיוק כמו ב-webhook.js.
 * הדף שואל את הכתובת הזאת, היא שואלת את קארדקום, ורק התשובה שלו קובעת.
 *
 * מה חוזר:
 *   {state:"paid", amount:247}  — קארדקום אישר, וזו עסקה של מסע הכוח
 *   {state:"pending"}           — קארדקום ענה, ועדיין אין אישור. אולי עוד
 *                                 רגע יהיה. **זה לא "נדחה".**
 *   {state:"unknown"}           — אין מזהה, או שלא הצלחנו לדבר עם קארדקום
 *
 * ‼️ מה *לא* חוזר: המייל של הקונה, הטוקן, ReturnValue, או כל פרט מזהה.
 *    מי שמחזיק מזהה עסקה יכול ללמוד מכאן רק אם העסקה הזאת שולמה — ולא
 *    של מי היא. הטוקן נשלח אך ורק במייל, מתוך ה-webhook.
 *
 * משתני סביבה: CARDCOM_TERMINAL, CARDCOM_API_NAME, MASA_PRICE
 */

const RESULT_URL = 'https://secure.cardcom.solutions/api/v11/LowProfile/GetLpResult';
const PREFIX = 'MASA|';

/* קארדקום מחזיר GUID. כל מה שלא נראה ככה לא נשלח הלאה. */
const LPID_RE = /^[A-Za-z0-9-]{8,64}$/;

/* אותו מזהה חוזר תחת שמות שונים, תלוי במסלול ובגרסה. */
const ID_KEYS = [
  'lpid', 'LowProfileId', 'lowProfileId', 'lowprofileid',
  'LowProfileCode', 'lowprofilecode', 'UID', 'uid',
];

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export function pickLowProfileId(params) {
  for (const k of ID_KEYS) {
    const v = params.get(k);
    if (v && LPID_RE.test(v.trim())) return v.trim();
  }
  return '';
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const lowProfileId = pickLowProfileId(url.searchParams);
  if (!lowProfileId) return json({ state: 'unknown', reason: 'no-id' });

  const terminal = Number(env.CARDCOM_TERMINAL);
  const apiName = env.CARDCOM_API_NAME;
  if (!terminal || !apiName) return json({ state: 'unknown', reason: 'not-configured' });

  let result;
  try {
    const res = await fetch(RESULT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ TerminalNumber: terminal, ApiName: apiName, LowProfileId: lowProfileId }),
    });
    // fetch לא זורק על 4xx/5xx — צריך לבדוק במפורש.
    if (!res.ok) return json({ state: 'unknown', reason: 'cardcom-' + res.status });
    result = await res.json();
  } catch (_) {
    return json({ state: 'unknown', reason: 'cardcom-unreachable' });
  }

  // כל מה שאינו 0 הוא "עדיין לא אושר" — לא "נדחה". ההבדל הזה הוא כל העניין:
  // עסקה שעוד לא נסגרה ועסקה שנדחתה נראות כאן אותו דבר, ולכן הדף ממשיך
  // לשאול ולא מכריז כלום.
  if (result.ResponseCode !== 0) return json({ state: 'pending' });

  // אושר — אבל של איזה מוצר? אותו מסוף משרת גם את אתגר 21 יום.
  const returnValue = String(result.ReturnValue || '');
  if (!returnValue.startsWith(PREFIX)) return json({ state: 'pending', reason: 'other-product' });

  const amount =
    Number(result.TranzactionInfo && result.TranzactionInfo.Amount) ||
    Number(result.Amount) ||
    Number(env.MASA_PRICE) ||
    0;

  return json({ state: 'paid', amount: amount > 0 ? amount : null });
}
