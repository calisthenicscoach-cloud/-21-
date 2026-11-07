/**
 * בדיקת הניתוב לפי דומיין.
 *   node functions/_middleware.test.mjs
 *
 * הבדיקה הזאת קיימת כדי להגן על שלושה דברים:
 *   1. אתגר 21 יום לא מרגיש שהקובץ _middleware.js קיים.
 *   2. /nivnatan/ — דף המכירה של 21 יום, שיש עליו מודעות שמשלמות —
 *      לעולם לא מוביל לדף של מסע הכוח.
 *   3. כל דף שהיה על הוורדפרס הישן ממשיך לענות על אותה כתובת,
 *      כולל התמונות שלו.
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
const TERMS = '/%D7%AA%D7%A0%D7%90%D7%99-%D7%A9%D7%99%D7%9E%D7%95%D7%A9';
const PRIVACY = '/%D7%9E%D7%93%D7%99%D7%A0%D7%99%D7%95%D7%AA-%D7%A4%D7%A8%D7%98%D7%99%D7%95%D7%AA';
const HANDSTAND = '/%D7%93%D7%A3-%D7%9E%D7%9B%D7%99%D7%A8%D7%94';
const BLOG = '/%D7%91%D7%9C%D7%95%D7%92';

console.log('\n--- 21 יום על pages.dev: חייב להישאר ללא נגיעה ---');
await check('home',         'https://matankopel.pages.dev/',              'UNTOUCHED');
await check('/course/',     'https://matankopel.pages.dev/course/',       'UNTOUCHED');
await check('asset',        'https://matankopel.pages.dev/assets/x.png',  'UNTOUCHED');
await check('api',          'https://matankopel.pages.dev/api/buy',       'UNTOUCHED');
await check('/masa/',       'https://matankopel.pages.dev/masa/',         'UNTOUCHED');
await check('/nivnatan/',   'https://matankopel.pages.dev/nivnatan/',     'UNTOUCHED');
await check('עברית',        'https://matankopel.pages.dev' + TERMS + '/', 'UNTOUCHED');
await check('other domain', 'https://www.example.com/anything',           'UNTOUCHED');

console.log('\n--- ‼️ דף המכירה של 21 יום — יש עליו מודעות ---');
await check('/nivnatan/',          APEX + '/nivnatan/',          'UNTOUCHED');
await check('/nivnatan בלי סלאש',   APEX + '/nivnatan',           '301 -> https://matankopel.co.il/nivnatan/');
await check('/nivnatan/?ref=ig',   APEX + '/nivnatan/?ref=ig',   'UNTOUCHED');
await check('תמונות של הדף',       APEX + '/nivnatan/a/f00.png', 'UNTOUCHED');
await check('על תת-הדומיין',       'https://masa.matankopel.co.il/nivnatan/', 'UNTOUCHED');
await check('על www',              'https://www.matankopel.co.il/nivnatan/',
            '301 -> https://matankopel.co.il/nivnatan/');

console.log('\n--- דפים שהועתקו מהוורדפרס ועונים על אותה כתובת ---');
await check('/thank/ (תודה)',  APEX + '/thank/',              'UNTOUCHED');
await check('/thank/ תמונות',  APEX + '/thank/a/x.png',       'UNTOUCHED');
await check('/thanks (Function)', APEX + '/thanks',           'UNTOUCHED');
await check('/tp בלי סלאש',    APEX + '/tp',                  '301 -> https://matankopel.co.il/tp/');
await check('תנאי שימוש בלי סלאש', APEX + TERMS,              '301 -> https://matankopel.co.il' + TERMS + '/');
await check('/tp/ (ליווי)',    APEX + '/tp/',                 'UNTOUCHED');
await check('תנאי שימוש',      APEX + TERMS + '/',            '/terms-of-use/');
await check('תנאי שימוש תמונות', APEX + TERMS + '/a/x.css',   '/terms-of-use/a/x.css');
await check('מדיניות פרטיות',  APEX + PRIVACY + '/',          '/privacy-policy/');
await check('עמידת ידיים',     APEX + HANDSTAND + '/',        '/handstand/');
await check('המאמר על מתח',    APEX + BLOG + '/',             '/blog-pullups/');
await check('אותיות גדולות',   APEX + TERMS.toUpperCase() + '/', '/terms-of-use/');

console.log('\n--- matankopel.co.il: מגיש את מסע הכוח ---');
await check('root',             APEX + '/',                  '/masa/');
await check('/app/',            APEX + '/app/',              '/masa/app/');
await check('asset',            APEX + '/img/a.png',         '/masa/img/a.png');
await check('api',              APEX + '/api/masa/buy',      'UNTOUCHED');
await check('already prefixed', APEX + '/masa/',             'UNTOUCHED');
await check('masa host root',   'https://masa.matankopel.co.il/',     '/masa/');
await check('masa host /app/',  'https://masa.matankopel.co.il/app/', '/masa/app/');

console.log('\n--- www מופנה לדומיין הנקי ---');
await check('www root', 'https://www.matankopel.co.il/',     '301 -> https://matankopel.co.il/');
await check('www path', 'https://www.matankopel.co.il/app/', '301 -> https://matankopel.co.il/app/');

console.log('\n--- שאריות בלי תוכן ---');
await check('/sample-page/', APEX + '/sample-page/', '301 -> https://matankopel.co.il/');
await check('/hello-world/', APEX + '/hello-world/', '301 -> https://matankopel.co.il/');
await check('/wp-admin/',    APEX + '/wp-admin/',    '301 -> https://matankopel.co.il/');
await check('בלוג-2',        APEX + BLOG + '-2/',    '301 -> https://matankopel.co.il/');

console.log('\n' + pass + ' עברו, ' + fail + ' נכשלו\n');
process.exit(fail ? 1 : 0);
