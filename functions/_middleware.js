/**
 * ניתוב לפי דומיין.
 *
 * באותו פרויקט Cloudflare Pages יושבים שני אתרים:
 *   matankopel.pages.dev            → אתגר 21 יום (בשורש)
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

/**
 * ‼️ כתובות של אתגר 21 יום שחייבות להמשיך לעבוד על הדומיין הראשי,
 *    כי יש עליהן תנועה שמשלמת:
 *
 *    /nivnatan/  — דף המכירה של 21 יום. יש מודעות שרצות אליו.
 *                  הדף ישב על הוורדפרס של האחסון הישן והועתק לכאן
 *                  על כל התמונות שלו (nivnatan/a/). טופס ההזמנה
 *                  שבו שולח ל-/api/buy.
 *    /thanks     — דף התודה אחרי תשלום, מריץ את פיקסל הרכישה.
 *                  CARDCOM_SUCCESS_URL מצביע על /thank/ ההיסטורי,
 *                  ולכן גם הוא ממופה לכאן.
 *
 *    הן מוגשות מהשורש ולא מתוך /masa/. אל תמחק אותן.
 */
const COURSE_PREFIXES = ['/nivnatan', '/thanks'];
const COURSE_THANKS_ALIASES = ['/thank'];

/* דפים ישנים מהוורדפרס שהיה על האחסון הקודם, שאין להם יורש.
   הם מופיעים בגוגל ולכן מופנים לדף הבית במקום ליפול ל-404. */
const OLD_WP_PATHS = [
  '/tp',
  '/sample-page',
  '/hello-world',
  '/%d7%91%d7%9c%d7%95%d7%92',                                                         // בלוג
  '/%d7%91%d7%9c%d7%95%d7%92-2',                                                       // בלוג-2
  '/%d7%91%d7%93%d7%99%d7%a7%d7%94',                                                   // בדיקה
  '/%d7%93%d7%a3-%d7%aa%d7%95%d7%93%d7%94-%d7%9e%d7%aa%d7%9f',                         // דף-תודה-מתן
  '/%d7%93%d7%a3-%d7%aa%d7%95%d7%93%d7%94-%d7%9c%d7%99%d7%97%d7%99%d7%93%d7%aa-%d7%94%d7%a7%d7%9c%d7%99%d7%a1%d7%98%d7%a0%d7%99%d7%a7%d7%a1', // דף-תודה-ליחידת-הקליסטניקס
];

function tidy(pathname) {
  return pathname.replace(/\/+$/, '').toLowerCase();
}

function isCoursePath(pathname) {
  const p = tidy(pathname);
  return COURSE_PREFIXES.some((pre) => p === pre || p.startsWith(pre + '/'));
}

function isOldWpPath(pathname) {
  const p = tidy(pathname);
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

  // דפים של 21 יום — מוגשים מהשורש, לא מתוך /masa/.
  if (isCoursePath(url.pathname)) return next();

  // /thank/ ההיסטורי הוא דף התודה של 21 יום.
  if (COURSE_THANKS_ALIASES.includes(tidy(url.pathname))) {
    const to = new URL(url);
    to.pathname = '/thanks';
    return next(new Request(to.toString(), request));
  }

  // שאריות מהאתר הישן שאין להן יורש — לדף הבית, לא ל-404.
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
