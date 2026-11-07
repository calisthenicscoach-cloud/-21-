/**
 * /api/lead   — טופס "השארת פרטים" של אתגר 21 יום
 *
 * הדפים שהועתקו מהאחסון הישן (‎/nivnatan/‎, ‎/thank/‎, תנאי שימוש,
 * מדיניות פרטיות) נבנו באלמנטור, והטופס שבתחתית כל אחד מהם שלח
 * את הפרטים ל-wp-admin/admin-ajax.php של הוורדפרס. האחסון הזה נסגר,
 * ולכן כתובת היעד הוחלפה בקובץ הזה.
 *
 * ‼️ למה זה לא "עוד נקודת קצה":
 *    בלי הקובץ הזה הטופס היה ממשיך להיראות עובד ולבלוע כל ליד
 *    בשקט. זה בדיוק סוג התקלה שאי אפשר לראות בעין.
 *
 * ‼️ הפרדה בין המוצרים:
 *    כאן נוגעים רק ברשימת הלידים של 21 יום (BREVO_LEADS_LIST_ID).
 *    מסע הכוח מטופל ב-/api/masa/lead עם רשימה אחרת. אל תערבב.
 *
 * ‼️ שמות השדות בטופס לא אומרים את האמת:
 *    form_fields[email]   מחזיק בפועל את הטלפון (type=tel)
 *    form_fields[message] מחזיק בפועל את האימייל (type=email)
 *    לכן לא סומכים על השם אלא על צורת הערך עצמו.
 *
 * הטופס מדבר בדיאלקט של אלמנטור ומחכה ל-JSON בצורת
 *    { success: true, data: { message: "..." } }
 * אחרת הוא מציג הודעת שגיאה אדומה לגולש.
 *
 * משתני סביבה:
 *    BREVO_API_KEY         — מפתח Brevo. סודי, רק בצד השרת.
 *    BREVO_LEADS_LIST_ID   — מספר רשימת הלידים של 21 יום.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const IL_PHONE_RE = /^0(?:5\d|[23489])\d{7}$/;

const OK_MESSAGE = 'תודה! קיבלתי את הפרטים ואחזור אליך.';
const ERR_MESSAGE = 'משהו לא עבר. נסה שוב בעוד רגע.';

function reply(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

const ok = () => reply({ success: true, data: { message: OK_MESSAGE } });
const bad = (why) => reply({ success: false, data: { message: ERR_MESSAGE, reason: why } });

/**
 * הצלחה שקטה, בלי טקסט.
 *
 * אלמנטור מדביק הודעה ירוקה על הדף רק אם יש message בתשובה, ולכן
 * זאת הדרך לענות לבקשה שאינה שליחת טופס בלי ש"תודה! קיבלתי את
 * הפרטים" תצוץ לגולש שלא מילא כלום.
 */
const quiet = () => reply({ success: true, data: {} });

/** 0541234567 → +972541234567. כל צורה אחרת — null. */
function toE164(raw) {
  const digits = String(raw || '').replace(/[^\d+]/g, '').replace(/^\+972/, '0');
  if (!IL_PHONE_RE.test(digits)) return null;
  return '+972' + digits.slice(1);
}

/**
 * מסדר את הערכים שהגיעו לפי הצורה שלהם, ולא לפי שם השדה.
 * מה שנראה כמו אימייל הוא האימייל, מה שנראה כמו טלפון ישראלי
 * הוא הטלפון, והראשון שנשאר הוא השם.
 */
function sortFields(values) {
  const out = { email: '', phone: '', name: '', note: '' };
  const rest = [];
  for (const v of values) {
    const s = String(v || '').trim();
    if (!s || s === 'on' || s === 'off') continue;
    if (!out.email && EMAIL_RE.test(s.toLowerCase()) && s.length <= 254) {
      out.email = s.toLowerCase();
      continue;
    }
    if (!out.phone && toE164(s)) {
      out.phone = toE164(s);
      continue;
    }
    rest.push(s);
  }
  out.name = (rest.shift() || '').slice(0, 80);
  out.note = rest.join(' · ').slice(0, 300);
  return out;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  if (!new URL(request.url).searchParams.has('health')) {
    return reply({ success: false, data: { message: ERR_MESSAGE } }, 405);
  }
  // בדיקת קונפיג בלי לגעת באף ליד ובלי לחשוף מפתח.
  return reply({
    ok: true,
    brevoKey: !!env.BREVO_API_KEY,
    leadsList: Number(env.BREVO_LEADS_LIST_ID) || null,
    ts: new Date().toISOString(),
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let fields;
  try {
    const ct = request.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
      const body = await request.json();
      fields = Object.entries(body)
        .filter(([k]) => k !== 'action')
        .map(([, v]) => v);
    } else {
      const form = await request.formData();
      const action = String(form.get('action') || '');
      // אלמנטור שלח בעבר לאותה כתובת גם בקשות שאינן טופס. אלה
      // יוצאות בהצלחה שקטה: לא הודעת שגיאה, וגם לא "תודה" על דף
      // שבו הגולש לא מילא כלום.
      if (action && action !== 'elementor_pro_forms_send_form') return quiet();
      fields = [];
      for (const [k, v] of form.entries()) {
        if (k.startsWith('form_fields[')) fields.push(v);
      }
    }
  } catch (_) {
    return bad('bad_body');
  }

  const { email, phone, name, note } = sortFields(fields);

  // בלי אימייל אין למה לצרף ל-Brevo. לא מודים לגולש על כלום.
  if (!email) return bad('no_email');

  const listId = Number(env.BREVO_LEADS_LIST_ID);
  if (!env.BREVO_API_KEY || !listId) return bad('not_configured');

  const attributes = { FIRSTNAME: name };
  if (phone) attributes.SMS = phone;
  if (note) attributes.LEAD_NOTE = note;

  const send = (attrs) =>
    fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'api-key': env.BREVO_API_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ email, updateEnabled: true, listIds: [listId], attributes: attrs }),
    });

  try {
    let res = await send(attributes);
    // Brevo מפיל את כל הפנייה על טלפון שהוא לא אוהב. עדיף ליד
    // בלי טלפון מאשר ליד שנעלם.
    if (res.status === 400 && attributes.SMS) {
      delete attributes.SMS;
      res = await send(attributes);
    }
    if (res.status !== 201 && res.status !== 204) {
      console.log('lead: brevo refused', res.status);
      return bad('brevo_' + res.status);
    }
  } catch (err) {
    console.log('lead: brevo unreachable');
    return bad('brevo_unreachable');
  }

  return ok();
}
