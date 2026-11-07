/**
 * ניתוב לפי דומיין.
 *
 * באותו פרויקט Cloudflare Pages יושבים שני אתרים:
 *   matankopel.pages.dev            → קורס 21 יום (בשורש)
 *   matankopel.co.il                → מסע הכוח (בתיקייה /masa/)
 *   www.matankopel.co.il            → מופנה לדומיין בלי www
 *   masa.matankopel.co.il           → מסע הכוח (אותו תוכן, כתובת ישנה)
 *
 * בלי הקובץ הזה, מי שנכנס ל-matankopel.co.il היה מקבל את דף הבית של
 * 21 יום, כי שניהם אותו פרויקט. הקובץ מגיש לדומיינים של מסע הכוח את
 * התוכן מתוך /masa/ בלי לשנות את הכתובת שרואה הגולש.
 *
 * ‼️ כלל הבטיחות: כל דומיין אחר יוצא מכאן בשורה הראשונה, בלי שנגענו
 *    בבקשה. 21 יום לא מרגיש שהקובץ הזה קיים.
 *
 * אם יום אחד יתווסף עוד דומיין למסע הכוח — להוסיף אותו ל-MASA_HOSTS.
 */

const APEX = 'matankopel.co.il';

/* הדומיינים שמגישים את מסע הכוח. */
const MASA_HOSTS = [APEX, 'masa.matankopel.co.il'];

/* www מופנה לדומיין הנקי, כדי שלא יהיו שתי כתובות לאותו דף. */
const WWW_HOST = 'www.' + APEX;

/* ‼️ דף התודה של אתגר 21 יום.
   CARDCOM_SUCCESS_URL מצביע על https://matankopel.co.il/thank/ — דף
   שישב על הוורדפרס הישן. ברגע שהדומיין עבר לכאן, הכתובת הזאת חייבת
   להמשיך לעבוד, אחרת כל מי שקונה את 21 יום נוחת על דף מת ושום רכישה
   לא נמדדת במטא. לכן היא מוגשת מתוך /thanks, שיושב בשורש של 21 יום
   ומריץ את פיקסל הרכישה. אל תמחק את השורה הזאת. */
const COURSE_THANKS_PATHS = ['/thank', '/thanks'];

/* דפים ישנים מהוורדפרס שהיה על האחסון הקודם. הם מופיעים בגוגל
   ואולי בקישורים ישנים, ולכן מופנים לדף המכירה במקום ליפול ל-404. */
const OLD_WP_PATHS = [
  '/nivnatan',
  '/tp',
  '/sample-page',
  '/%d7%93%d7%a3-%d7%9e%d7%9b%d7%99%d7%a8%d7%94',                                     // דף-מכירה
  '/%d7%93%d7%a3-%d7%aa%d7%95%d7%93%d7%94-%d7%9e%d7%aa%d7%9f',                         // דף-תודה-מתן
  '/%d7%93%d7%a3-%d7%aa%d7%95%d7%93%d7%94-%d7%9c%d7%99%d7%97%d7%99%d7%93%d7%aa-%d7%94%d7%a7%d7%9c%d7%99%d7%a1%d7%98%d7%a0%d7%99%d7%a7%d7%a1', // דף-תודה-ליחידת-הקליסטניקס
  '/%d7%91%d7%9c%d7%95%d7%92',                                                         // בלוג
  '/%d7%91%d7%9c%d7%95%d7%92-2',                                                       // בלוג-2
  '/%d7%91%d7%93%d7%99%d7%a7%d7%94',                                                   // בדיקה
  '/%d7%aa%d7%a0%d7%90%d7%99-%d7%a9%d7%99%d7%9e%d7%95%d7%a9',                          // תנאי-שימוש
  '/%d7%9e%d7%93%d7%99%d7%a0%d7%99%d7%95%d7%aa-%d7%a4%d7%a8%d7%98%d7%99%d7%95%d7%aa',  // מדיניות-פרטיות
];

function isOldWpPath(pathname) {
  const p = pathname.replace(/\/+$/, '').toLowerCase();
  return OLD_WP_PATHS.indexOf(p) !== -1 || p.indexOf('/wp-') === 0;
}

export async function onRequest(context) {
  const { request, next } = context;

  let url;
  try {
    url = new URL(request.url);
  } catch (_) {
    return next();
  }

  // www → הדומיין הנקי, באותו נתיב.
  if (url.hostname === WWW_HOST) {
    const to = new URL(url);
    to.hostname = APEX;
    return Response.redirect(to.toString(), 301);
  }

  // ===== כל מה שאינו מסע הכוח — יוצא מיד, בלי שינוי =====
  if (!MASA_HOSTS.includes(url.hostname)) return next();

  // הכתובות של ה-API יושבות על /api/ בשני האתרים, ולא זזות.
  if (url.pathname.startsWith('/api/')) return next();

  // דף התודה של 21 יום — מוגש מהשורש, לא מתוך /masa/.
  if (COURSE_THANKS_PATHS.includes(url.pathname.replace(/\/+$/, '').toLowerCase())) {
    const to = new URL(url);
    to.pathname = '/thanks';
    return next(new Request(to.toString(), request));
  }

  // שאריות מהאתר הישן — לדף המכירה, לא ל-404.
  if (isOldWpPath(url.pathname)) {
    return Response.redirect(new URL('/', url).toString(), 301);
  }

  // כבר מצביע לתוך התיקייה — אין מה לעשות.
  if (url.pathname === '/masa' || url.pathname.startsWith('/masa/')) return next();

  // כל שאר הנתיבים על הדומיין הזה מוגשים מתוך /masa/.
  const target = new URL(url);
  target.pathname = '/masa' + (url.pathname === '/' ? '/' : url.pathname);
  return next(new Request(target.toString(), request));
}
