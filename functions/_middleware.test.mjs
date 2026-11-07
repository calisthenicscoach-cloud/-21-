/**
 * בדיקת הניתוב לפי דומיין.
 *   node functions/_middleware.test.mjs
 *
 * הבדיקה הזאת קיימת כדי להגן על דבר אחד: אתגר 21 יום לא מרגיש
 * שהקובץ _middleware.js קיים. אל תשנה את הניתוב בלי להריץ אותה.
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

console.log('\n--- 21 יום: חייב להישאר ללא נגיעה ---');
await check('pages.dev home',       'https://matankopel.pages.dev/',               'UNTOUCHED');
await check('pages.dev /course/',   'https://matankopel.pages.dev/course/',        'UNTOUCHED');
await check('pages.dev asset',      'https://matankopel.pages.dev/assets/x.png',   'UNTOUCHED');
await check('pages.dev api',        'https://matankopel.pages.dev/api/buy',        'UNTOUCHED');
await check('pages.dev /masa/',     'https://matankopel.pages.dev/masa/',          'UNTOUCHED');
await check('pages.dev /nivnatan/', 'https://matankopel.pages.dev/nivnatan/',      'UNTOUCHED');
await check('other domain',         'https://www.example.com/anything',            'UNTOUCHED');

console.log('\n--- matankopel.co.il: מגיש את מסע הכוח ---');
await check('apex root',            'https://matankopel.co.il/',                   '/masa/');
await check('apex app',             'https://matankopel.co.il/app/',               '/masa/app/');
await check('apex asset',           'https://matankopel.co.il/img/a.png',          '/masa/img/a.png');
await check('apex api untouched',   'https://matankopel.co.il/api/masa/buy',       'UNTOUCHED');
await check('apex already prefixed','https://matankopel.co.il/masa/',              'UNTOUCHED');

console.log('\n--- תת-הדומיין הישן ממשיך לעבוד ---');
await check('masa root',            'https://masa.matankopel.co.il/',              '/masa/');
await check('masa app',             'https://masa.matankopel.co.il/app/',          '/masa/app/');
await check('masa api untouched',   'https://masa.matankopel.co.il/api/masa/buy',  'UNTOUCHED');

console.log('\n--- www מופנה לדומיין הנקי ---');
await check('www root',   'https://www.matankopel.co.il/',       '301 -> https://matankopel.co.il/');
await check('www path',   'https://www.matankopel.co.il/app/',   '301 -> https://matankopel.co.il/app/');

console.log('\n--- דפי הוורדפרס הישנים מופנים לדף המכירה ---');
await check('nivnatan',   'https://matankopel.co.il/nivnatan/',  '301 -> https://matankopel.co.il/');
await check('terms (he)', 'https://matankopel.co.il/%d7%aa%d7%a0%d7%90%d7%99-%d7%a9%d7%99%d7%9e%d7%95%d7%a9/', '301 -> https://matankopel.co.il/');
await check('wp-admin',   'https://matankopel.co.il/wp-admin/',  '301 -> https://matankopel.co.il/');

console.log('\n--- דף התודה של 21 יום חייב לשרוד את המעבר ---');
await check('apex /thank/',  'https://matankopel.co.il/thank/',      '/thanks');
await check('apex /thank',   'https://matankopel.co.il/thank',       '/thanks');
await check('apex /thanks',  'https://matankopel.co.il/thanks',      '/thanks');
await check('masa /thank/',  'https://masa.matankopel.co.il/thank/', '/thanks');
await check('www /thank/',   'https://www.matankopel.co.il/thank/',  '301 -> https://matankopel.co.il/thank/');
await check('pages.dev /thanks', 'https://matankopel.pages.dev/thanks', 'UNTOUCHED');

console.log('\n' + pass + ' עברו, ' + fail + ' נכשלו\n');
process.exit(fail ? 1 : 0);
