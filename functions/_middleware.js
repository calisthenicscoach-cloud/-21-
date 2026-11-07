/**
 * ניתוב לפי דומיין.
 *
 * באותו פרויקט Cloudflare Pages יושבים שני אתרים:
 *   matankopel.pages.dev            → קורס 21 יום (בשורש)
 *   masa.matankopel.co.il           → מסע הכוח (בתיקייה /masa/)
 *
 * בלי הקובץ הזה, מי שנכנס ל-masa.matankopel.co.il היה מקבל את דף הבית
 * של 21 יום, כי שניהם אותו פרויקט. הקובץ מגיש לדומיין של מסע הכוח את
 * התוכן מתוך /masa/ בלי לשנות את הכתובת שרואה הגולש.
 *
 * ‼️ כלל הבטיחות: כל דומיין אחר יוצא מכאן בשורה הראשונה, בלי שנגענו
 *    בבקשה. 21 יום לא מרגיש שהקובץ הזה קיים.
 *
 * אם יום אחד יתווסף עוד דומיין למסע הכוח — להוסיף אותו ל-MASA_HOSTS.
 */

const MASA_HOSTS = ['masa.matankopel.co.il'];

export async function onRequest(context) {
  const { request, next } = context;

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return next();
  }

  // ===== כל מה שאינו מסע הכוח — יוצא מיד, בלי שינוי =====
  if (!MASA_HOSTS.includes(url.hostname)) return next();

  // הכתובות של ה-API יושבות על /api/ בשני האתרים, ולא זזות.
  if (url.pathname.startsWith('/api/')) return next();

  // כבר מצביע לתוך התיקייה — אין מה לעשות.
  if (url.pathname === '/masa' || url.pathname.startsWith('/masa/')) return next();

  // כל שאר הנתיבים על הדומיין הזה מוגשים מתוך /masa/.
  const target = new URL(url);
  target.pathname = '/masa' + (url.pathname === '/' ? '/' : url.pathname);
  return next(new Request(target.toString(), request));
}
