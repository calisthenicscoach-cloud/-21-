/**
 * קוד הכניסה החד-פעמי של מסע הכוח.
 *
 * ‼️ קובץ שמתחיל ב-_ לא מקבל כתובת ב-Cloudflare Pages, ולכן הוא לא
 *    נגיש מבחוץ. הוא קיים כדי שהווב-הוק ו"שלח לי שוב" ינפיקו קוד
 *    בדיוק באותה צורה — אם רק אחד מהם ישתנה יום אחד, זה יהיה באג
 *    שקט שבו קונה מקבל מייל עם קישור שלא עובד.
 *
 * הקוד נשרף במימוש הראשון (ראה verify.js) ופג אחרי 48 שעות, כך
 * שהעברת המייל לחבר שווה כניסה אחת לכל היותר.
 */

export function newCode() {
  return crypto.randomUUID().replace(/-/g, '');
}

/** הקישור שנכנס לגוף המייל. */
export function codeLink(env, code) {
  const base = String(env.MASA_APP_URL || '').replace(/\/$/, '');
  return `${base}/?c=${code}`;
}

/**
 * כותב קוד חדש על שורת גישה קיימת ומחזיר אותו.
 * מאפס גם את code_used_at, אחרת הקוד החדש ייראה כאילו כבר מומש.
 * מחזיר '' אם לא הצליח — ואז לא שולחים מייל עם קישור שבור.
 */
export async function issueCode(env, accessId) {
  const code = newCode();
  try {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/masa_access?id=eq.${accessId}`, {
      method: 'PATCH',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        code,
        code_sent_at: new Date().toISOString(),
        code_used_at: null,
      }),
    });
    // fetch לא זורק על 4xx/5xx — צריך לבדוק במפורש.
    if (!res.ok) {
      console.log('issueCode failed', res.status);
      return '';
    }
    return code;
  } catch (err) {
    console.log('issueCode threw', String(err).slice(0, 200));
    return '';
  }
}
