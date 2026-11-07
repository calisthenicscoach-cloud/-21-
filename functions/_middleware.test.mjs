/**
 * בדיקת הניתוב לפי דומיין.
 *   node functions/_middleware.test.mjs
 *
 * הבדיקה הזאת קיימת כדי להגן על ארבעה דברים:
 *   1. אתגר 21 יום לא מרגיש שהקובץ _middleware.js קיים.
 *   2. /nivnatan/ — דף המכירה של 21 יום, שיש עליו מודעות שמשלמות —
 *      לעולם לא מוביל לדף של מסע הכוח.
 *   3. /thank/ — הדף שקארדקום שולח אליו כל קונה — עונה על אותה
 *      כתובת בדיוק, כי היא רשומה ב-CARDCOM_SUCCESS_URL.
 *   4. /wp/ — הקוד שאלמנטור מוריד בזמן אמת — מוגש מהשורש בכל
 *      דומיין ולא נכנס לתוך /masa/.
 * אל תשנה את הניתוב בלי להריץ אותה.
 */
import { onRequest } from './_middleware.js';

let pass = 0, fail = 0;

async function check(name, url, expect) {
  let seen = 'NOT-CALLED';
  const next = (req) => {
    seen = req === undefined ? 'UNTOUCHED' : new URL(req.url).pathname;
    return new Response('ok');
  };
  const res = await onRequest({ request: new Request(url), next });
  let got = seen;
  if (seen === 'NOT-CALLED' && res && res.status >= 300 && res.status < 400) {
    got = res.status + ' -> ' + res.headers.get('location');
  }
  if (got === expect) { pass++; console.log('  PASS  ' + name + '  ->  ' + got); }
  else { fail++; console.log('  FAIL  ' + name + '  ->  got ' + got + ', want ' + expect); }
}

const APEX = 'https://matankopel.co.il';
const HOME = '301 -> https://matankopel.co.il/';
const TERMS = '/%D7%AA%D7%A0%D7%90%D7%99-%D7%A9%D7%99%D7%9E%D7%95%D7%A9';
const PRIVACY = '/%D7%9E%D7%93%D7%99%D7%A0%D7%99%D7%95%D7%AA-%D7%A4%D7%A8%D7%98%D7%99%D7%95%D7%AA';
const HANDSTAND = '/%D7%93%D7%A3-%D7%9E%D7%9B%D7%99%D7%A8%D7%94';
const BLOG = '/%D7%91%D7%9C%D7%95%D7%92';
const THANKS_LEAD = '/%D7%93%D7%A3-%D7%AA%D7%95%D7%93%D7%94-%D7%9E%D7%AA%D7%9F';

console.log('\n--- 21 יום על pages.dev: חייב להישאר ללא נגיעה ---');
await check('home',         'https://matankopel.pages.dev/',              'UNTOUCHED');
await check('/course/',     'https://matankopel.pages.dev/course/',       'UNTOUCHED');
await check('asset',        'https://matankopel.pages.dev/assets/x.png',  'UNTOUCHED');
await check('api',          'https://matankopel.pages.dev/api/buy',       'UNTOUCHED');
await check('/masa/',       'https://matankopel.pages.dev/masa/',         'UNTOUCHED');
await check('/nivnatan/',   'https://matankopel.pages.dev/nivnatan/',     'UNTOUCHED');
await check('עברית',        'https://matankopel.pages.dev' + TERMS + '/', 'UNTOUCHED');
await check('דף שנמחק',     'https://matankopel.pages.dev' + BLOG + '/',  'UNTOUCHED');
await check('other domain', 'https://www.example.com/anything',           'UNTOUCHED');

console.log('\n--- ‼️ דף המכירה של 21 יום — יש עליו מודעות ---');
await check('/nivnatan/',          APEX + '/nivnatan/',          'UNTOUCHED');
await check('/nivnatan בלי סלאש',   APEX + '/nivnatan',           '301 -> https://matankopel.co.il/nivnatan/');
await check('/nivnatan/?ref=ig',   APEX + '/nivnatan/?ref=ig',   'UNTOUCHED');
await check('תמונות של הדף',       APEX + '/nivnatan/a/f00.png', 'UNTOUCHED');
await check('על תת-הדומיין',       'https://masa.matankopel.co.il/nivnatan/', 'UNTOUCHED');
await check('על www',              'https://www.matankopel.co.il/nivnatan/',
            '301 -> https://matankopel.co.il/nivnatan/');

console.log('\n--- ‼️ /thank/ — לשם קארדקום שולח כל קונה ---');
await check('/thank/',         APEX + '/thank/',               'UNTOUCHED');
await check('/thank/ תמונות',  APEX + '/thank/a/x.png',        'UNTOUCHED');
await check('עם פרמטרים',      APEX + '/thank/?suminfull=147', 'UNTOUCHED');
await check('בלי סלאש',        APEX + '/thank',                '301 -> https://matankopel.co.il/thank/');

console.log('\n--- הדפים המשפטיים ---');
await check('תנאי שימוש',        APEX + TERMS + '/',               '/terms-of-use/');
await check('תנאי שימוש תמונות', APEX + TERMS + '/a/x.css',        '/terms-of-use/a/x.css');
await check('תנאי שימוש בלי סלאש', APEX + TERMS,                   '301 -> https://matankopel.co.il' + TERMS + '/');
await check('מדיניות פרטיות',    APEX + PRIVACY + '/',             '/privacy-policy/');
await check('אותיות גדולות',     APEX + TERMS.toUpperCase() + '/', '/terms-of-use/');

console.log('\n--- ‼️ /wp/ — הקוד שאלמנטור מוריד בזמן אמת ---');
await check('על האייפקס',  APEX + '/wp/elementor/js/video.69da.bundle.min.js', 'UNTOUCHED');
await check('קובץ עיצוב',  APEX + '/wp/elementor/css/conditionals/dialog.min.css', 'UNTOUCHED');
await check('של הפרו',     APEX + '/wp/elementor-pro/js/form.ae7f.bundle.min.js', 'UNTOUCHED');
await check('על pages.dev', 'https://matankopel.pages.dev/wp/elementor/x.js',  'UNTOUCHED');

console.log('\n--- /api/lead — הטופס של הדפים שהועתקו ---');
await check('POST של הטופס', APEX + '/api/lead',           'UNTOUCHED');
await check('בדיקת בריאות',  APEX + '/api/lead?health=1',  'UNTOUCHED');
await check('/thanks (Function)', APEX + '/thanks',        'UNTOUCHED');

console.log('\n--- matankopel.co.il: מגיש את מסע הכוח ---');
await check('root',             APEX + '/',                  '/masa/');
await check('/app/',            APEX + '/app/',              '/masa/app/');
await check('asset',            APEX + '/img/a.png',         '/masa/img/a.png');
await check('api',              APEX + '/api/masa/buy',      'UNTOUCHED');
await check('already prefixed', APEX + '/masa/',             'UNTOUCHED');
await check('masa host root',   'https://masa.matankopel.co.il/',     '/masa/');
await check('masa host /app/',  'https://masa.matankopel.co.il/app/', '/masa/app/');

console.log('\n--- www מופנה לדומיין הנקי ---');
await check('www root', 'https://www.matankopel.co.il/',     HOME);
await check('www path', 'https://www.matankopel.co.il/app/', '301 -> https://matankopel.co.il/app/');

console.log('\n--- שאריות הוורדפרס: לדף הבית, לא ל-404 ---');
await check('/sample-page/', APEX + '/sample-page/', HOME);
await check('/hello-world/', APEX + '/hello-world/', HOME);
await check('/wp-admin/',    APEX + '/wp-admin/',    HOME);
await check('/feed/',        APEX + '/feed/',        HOME);
await check('/category/',    APEX + '/category/uncategorized/', HOME);
await check('בלוג-2',        APEX + BLOG + '-2/',    HOME);

console.log('\n--- הדפים שמתן הוציא מהאוויר ---');
await check('/tp/',           APEX + '/tp/',          HOME);
await check('/tp בלי סלאש',   APEX + '/tp',           HOME);
await check('עמידת ידיים',    APEX + HANDSTAND + '/', HOME);
await check('המאמר על מתח',   APEX + BLOG + '/',      HOME);
await check('תודה — פרטים',   APEX + THANKS_LEAD + '/', HOME);

console.log('\n--- הליווי האישי והנספחים שלו, שנסגרו ---');
await check('/silabus',       APEX + '/silabus',       HOME);
await check('/silabus-3',     APEX + '/silabus-3',     HOME);
await check('/silabus-minui', APEX + '/silabus-minui/', HOME);
await check('/kit',           APEX + '/kit',           HOME);
await check('/tzuna',         APEX + '/tzuna',         HOME);
await check('/3',             APEX + '/3',             HOME);
await check('/8/',            APEX + '/8/',            HOME);
await check('/chodesh',       APEX + '/chodesh',       HOME);
await check('/minui',         APEX + '/minui',         HOME);
await check('על pages.dev לא נגענו', 'https://matankopel.pages.dev/kit', 'UNTOUCHED');

console.log('\n' + pass + ' עברו, ' + fail + ' נכשלו\n');
process.exit(fail ? 1 : 0);
