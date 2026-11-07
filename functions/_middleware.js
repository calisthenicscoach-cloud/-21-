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
 * ‼️ הדפים שהיו על הוורדפרס של האחסון הישן והועתקו לכאן במלואם,
 *    עם כל התמונות שלהם (בתיקיית a/ של כל דף).
 *
 *    הם חייבים להמשיך לענות על אותן כתובות בדיוק, כי יש עליהן
 *    תנועה: מודעות שמשלמות, קישורים ישנים וגוגל.
 *
 *    הכי חשוב: /nivnatan/ הוא דף המכירה של אתגר 21 יום, וטופס
 *    ההזמנה שבו שולח ל-/api/buy. פעם אחת הוא היה מופנה לדף של
 *    מסע הכוח — זה היה שולח קונים של 21 יום למוצר הלא נכון.
 *
 *    התיקיות בפרויקט באנגלית כדי שלא נסמוך על שמות קבצים בעברית,
 *    והמפתח כאן הוא הכתובת הפומבית כפי שהדפדפן שולח אותה.
 */
const KEPT_PAGES = {
  '/nivnatan': '/nivnatan',                       // דף המכירה של 21 יום
  '/thank': '/thank',                             // דף התודה אחרי תשלום
  // ‼️ אפליקציית הקורס של 21 יום. נוספה ב-7.11.2026, אחרי שהדומיין
  //    עבר לקלאודפלייר. בלי השורה הזאת matankopel.co.il/course/ נבלע
  //    לתוך /masa/ ומחזיר את דף הנפילה — כלומר מי שקנה 21 יום ומנסה
  //    להיכנס למה ששילם עליו רואה תוכן של מוצר אחר.
  //    הדף מושך את הקבצים שלו בנתיב יחסי (files/...), ולכן הוא חייב
  //    את הסלאש בסוף בדיוק כמו /nivnatan/ ו-/thank/.
  '/course': '/course',                           // אפליקציית הקורס
  // תנאי-שימוש
  '/%d7%aa%d7%a0%d7%90%d7%99-%d7%a9%d7%99%d7%9e%d7%95%d7%a9': '/terms-of-use',
  // מדיניות-פרטיות
  '/%d7%9e%d7%93%d7%99%d7%a0%d7%99%d7%95%d7%aa-%d7%a4%d7%a8%d7%98%d7%99%d7%95%d7%aa': '/privacy-policy',
};

/* שאריות מהוורדפרס שאין להן תוכן אמיתי. מופנות לדף הבית, לא ל-404. */
const DEAD_WP_PATHS = [
  '/sample-page',
  '/hello-world',
  '/%d7%91%d7%9c%d7%95%d7%92-2',       // בלוג-2 (אינדקס ריק)
  '/%d7%91%d7%93%d7%99%d7%a7%d7%94',   // בדיקה
  '/feed',
  '/comments/feed',
  '/category/uncategorized',
  // ===== דפים שמתן החליט שאינם רלוונטיים, 7 בנובמבר 2026 =====
  // הם היו קיימים על האחסון הישן ויש להם עדיין מקום בגוגל, ולכן
  // הם מופנים לדף הבית ולא נותנים 404.
  '/tp',                               // דף הנחיתה של הליווי האישי
  '/%d7%93%d7%a3-%d7%9e%d7%9b%d7%99%d7%a8%d7%94',   // דף-מכירה (עמידת ידיים)
  '/%d7%91%d7%9c%d7%95%d7%92',                      // בלוג (המאמר על מתח)
  '/%d7%93%d7%a3-%d7%aa%d7%95%d7%93%d7%94-%d7%9e%d7%aa%d7%9f',   // דף-תודה-מתן
  '/%d7%93%d7%a3-%d7%aa%d7%95%d7%93%d7%94-%d7%9c%d7%99%d7%97%d7%99%d7%93%d7%aa-%d7%94%d7%a7%d7%9c%d7%99%d7%a1%d7%98%d7%a0%d7%99%d7%a7%d7%a1',
  // ===== הליווי האישי והנספחים שלו, שמתן סגר ב-7 בנובמבר 2026 =====
  // הסילבוסים, ערכת הפתיחה, שאלון התזונה ודפי החתימה על ההסכם.
  // הקישורים אליהם נשלחו ידנית בוואטסאפ, אז אין מה לשבור — אבל
  // מי שישלוף קישור ישן יגיע לדף הבית ולא ל-404.
  '/silabus', '/silabus-3', '/silabus-8',
  '/silabus-chodashim', '/silabus-chodesh', '/silabus-minui',
  '/kit', '/tzuna',
  '/3', '/6', '/8', '/chodesh', '/minui',
];

/**
 * ⁑ הקישורים הקצרים שיושבים בביו של הרשתות.
 *
 * בביו רואים את הכתובת עצמה, ו-matankopel.co.il/masa/?ref=ig נראה
 * כמו שגיאה. הנתיבים כאן קצרים ונקיים, ומפנים לדף המכירה עם התג
 * שאומר מאיפה הגולש הגיע — כך שאותו דף בדיוק יודע לספור בנפרד כל
 * רשת, בלי שהגולש יראה משהו טכני.
 *
 * ‼️ הפניה זמנית (302) ולא קבועה: אם יום אחד הקישור בביו יצטרך
 *    להוביל למקום אחר, 301 היה נשאר בזיכרון של הדפדפן של כל מי
 *    שכבר לחץ — והם היו ממשיכים להגיע לדף הישן.
 *
 * להוסיף רשת חדשה = שורה אחת כאן.
 */
const BIO_LINKS = {
  '/ig': 'ig',
  '/tiktok': 'tiktok',
  '/yt': 'yt',
  '/fb': 'fb',
};

function tidy(pathname) {
  return pathname.replace(/\/+$/, '').toLowerCase();
}

/* נתיבים של Function בשורש, שחייבים להגיע בלי סלאש בסוף. */
const ROOT_FUNCTIONS = ['/thanks'];

/**
 * ‼️ תיקיות שמוגשות מהשורש בכל דומיין.
 *
 * /wp/ מחזיקה את הקוד שאלמנטור מוריד בזמן אמת (טפסים, פופאפים,
 * לייטבוקס, וידאו). הדפים שהועתקו מהאחסון הישן מצביעים אליה
 * בכתובת מוחלטת, ולכן היא חייבת לא להיכנס לתוך /masa/.
 */
const SHARED_DIRS = ['/wp/'];

/**
 * מה לעשות עם נתיב שמגיע לדומיין של מסע הכוח:
 *   {serve: '...'}    להגיש את הקובץ הזה בלי לשנות את הכתובת
 *   {slash: true}     להוסיף סלאש בסוף ואז להגיש
 *   null              לא אחד מהדפים השמורים
 *
 * הסלאש חשוב: הדפים האלה מושכים את התמונות שלהם בנתיב יחסי (a/...),
 * ובלי סלאש בסוף הדפדפן מחפש אותן תיקייה אחת למעלה והן נשברות.
 */
function keptTarget(pathname) {
  // בלי tidy: ההבדל בין /x ל-/x/ הוא בדיוק מה שנבדק כאן.
  const p = pathname.toLowerCase();
  for (const pub in KEPT_PAGES) {
    if (p === pub) return { slash: true };
    if (p.startsWith(pub + '/')) {
      return { serve: KEPT_PAGES[pub] + pathname.slice(pub.length) };
    }
  }
  return null;
}

function isDeadWpPath(pathname) {
  const p = tidy(pathname);
  return DEAD_WP_PATHS.indexOf(p) !== -1 || p.indexOf('/wp-') === 0;
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

  /* ⁑ קישור קצר מהביו. נבדק לפני כל השאר, כדי ששום כלל אחר
     לא יבלע אותו. tidy מוריד סלאש בסוף ומוריד אותיות גדולות, אז
     /IG/ ו-/ig עובדים אותו דבר — בביו של רשת אחת זה יכול להיכתב
     אחרת. */
  const bioTag = BIO_LINKS[tidy(url.pathname)];
  if (bioTag) {
    const to = new URL('/masa/', url);
    to.searchParams.set('ref', bioTag);
    return Response.redirect(to.toString(), 302);
  }

  // הכתובות של ה-API יושבות על /api/ בשני האתרים, ולא זזות.
  if (url.pathname.startsWith('/api/')) return next();

  // Function שיושבת בשורש של 21 יום — עוברת כמו שהיא.
  if (ROOT_FUNCTIONS.includes(tidy(url.pathname))) return next();

  // תיקיות משותפות (הקוד של אלמנטור) — מוגשות מהשורש בכל דומיין.
  if (SHARED_DIRS.some((d) => url.pathname.startsWith(d))) return next();

  // דפים שנשמרו מהאתר הישן — מוגשים מהשורש, לא מתוך /masa/.
  const kept = keptTarget(url.pathname);
  if (kept) {
    if (kept.slash) {
      const to = new URL(url);
      to.pathname = url.pathname.replace(/\/*$/, '/');
      return Response.redirect(to.toString(), 301);
    }
    if (kept.serve === url.pathname) return next();
    const to = new URL(url);
    to.pathname = kept.serve;
    return next(new Request(to.toString(), request));
  }

  // שאריות בלי תוכן — לדף הבית, לא ל-404.
  if (isDeadWpPath(url.pathname)) {
    return Response.redirect(new URL('/', url).toString(), 301);
  }

  // כבר מצביע לתוך התיקייה — אין מה לעשות.
  if (url.pathname === '/masa' || url.pathname.startsWith('/masa/')) return next();

  // כל שאר הנתיבים על הדומיין הזה מוגשים מתוך /masa/.
  const target = new URL(url);
  target.pathname = '/masa' + (url.pathname === '/' ? '/' : url.pathname);
  return next(new Request(target.toString(), request));
}
