/**
 * בדיקת הניתוב לפי דומיין.
 *   node functions/_middleware.test.mjs
 *
 * הבדיקה הזאת קיימת כדי להגן על שני דברים:
 *   1. אתגר 21 יום לא מרגיש שהקובץ _middleware.js קיים.
 *   2. /nivnatan/ — דף המכירה של 21 יום, שיש עליו מודעות שמשלמות —
 *      לעולם לא מוביל לדף של מסע הכוח.
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

console.log('\n--- 21 יום על pages.dev: חייב להישאר ללא נגיעה ---');
await check('home',          'https://matankopel.pages.dev/',               'UNTOUCHED');
await check('/course/',      'https://matankopel.pages.dev/course/',        'UNTOUCHED');
await check('asset',         'https://matankopel.pages.dev/assets/x.png',   'UNTOUCHED');
await check('api',           'https://matankopel.pages.dev/api/buy',        'UNTOUCHED');
await check('/masa/',        'https://matankopel.pages.dev/masa/',          'UNTOUCHED');
await check('/nivnatan/',    'https://matankopel.pages.dev/nivnatan/',      'UNTOUCHED');
await check('other domain',  'https://www.example.com/anything',            'UNTOUCHED');

console.log('\n--- ‼️ דף המכירה של 21 יום — יש עליו מודעות ---');
await check('apex /nivnatan/',       'https://matankopel.co.il/nivnatan/',           'UNTOUCHED');
await check('apex /nivnatan',        'https://matankopel.co.il/nivnatan',            'UNTOUCHED');
await check('apex /nivnatan/?ref=ig','https://matankopel.co.il/nivnatan/?ref=ig',    'UNTOUCHED');
await check('apex תמונות של הדף',    'https://matankopel.co.il/nivnatan/a/f00.png',  'UNTOUCHED');
await check('masa host /nivnatan/',  'https://masa.matankopel.co.il/nivnatan/',      'UNTOUCHED');
await check('www /nivnatan/',        'https://www.matankopel.co.il/nivnatan/',
            '301 -> https://matankopel.co.il/nivnatan/');

console.log('\n--- דף התודה של 21 יום ---');
await check('apex /thank/',   'https://matankopel.co.il/thank/',       '/thanks');
await check('apex /thank',    'https://matankopel.co.il/thank',        '/thanks');
await check('apex /thanks',   'https://matankopel.co.il/thanks',       'UNTOUCHED');
await check('masa /thank/',   'https://masa.matankopel.co.il/thank/',  '/thanks');

console.log('\n--- matankopel.co.il: מגיש את מסע הכוח ---');
await check('apex root',             'https://matankopel.co.il/',                   '/masa/');
await check('apex /app/',            'https://matankopel.co.il/app/',               '/masa/app/');
await check('apex asset',            'https://matankopel.co.il/img/a.png',          '/masa/img/a.png');
await check('apex api',              'https://matankopel.co.il/api/masa/buy',       'UNTOUCHED');
await check('apex already prefixed', 'https://matankopel.co.il/masa/',              'UNTOUCHED');
await check('masa root',             'https://masa.matankopel.co.il/',              '/masa/');
await check('masa /app/',            'https://masa.matankopel.co.il/app/',          '/masa/app/');

console.log('\n--- www מופנה לדומיין הנקי ---');
await check('www root', 'https://www.matankopel.co.il/',     '301 -> https://matankopel.co.il/');
await check('www path', 'https://www.matankopel.co.il/app/', '301 -> https://matankopel.co.il/app/');

console.log('\n--- שאריות מהוורדפרס שאין להן יורש ---');
await check('/tp/',        'https://matankopel.co.il/tp/',          '301 -> https://matankopel.co.il/');
await check('/sample-page','https://matankopel.co.il/sample-page/', '301 -> https://matankopel.co.il/');
await check('/wp-admin/',  'https://matankopel.co.il/wp-admin/',    '301 -> https://matankopel.co.il/');
await check('בלוג',        'https://matankopel.co.il/%d7%91%d7%9c%d7%95%d7%92/',
            '301 -> https://matankopel.co.il/');

console.log('\n' + pass + ' עברו, ' + fail + ' נכשלו\n');
process.exit(fail ? 1 : 0);
