/**
 * בדיקת שומר טעויות ההקלדה בדומיין של המייל.
 *   node masa/typo.test.mjs
 *
 * ‼️ למה הבדיקה הזאת קיימת
 *
 * בבדיקה האמיתית הראשונה של מסע הכוח הוקלד matankopel02@gmai.com —
 * בלי ה-l. התשלום עבר, הווב-הוק רץ, הגישה נפתחה — ומייל הגישה נשלח
 * לדומיין שלא קיים. הקונה שילם ולא קיבל כלום.
 *
 * אי אפשר לתקן את זה *אחרי* התשלום: לתת לקונה לשנות את הכתובת לפי
 * מזהה העסקה פירושו שכל מי שמחזיק במזהה כזה יכול להעביר את קישור
 * הגישה לתיבה אחרת. לכן התיקון היחיד הוא לתפוס את הטעות *לפני*
 * שמשלמים, וזה מה שנבדק כאן.
 *
 * הבדיקה שולפת את הפונקציות מתוך masa/index.html עצמו, כדי שלא
 * ייווצר עותק שני של הלוגיקה שיכול להתיישן.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'index.html'), 'utf8');

/* שולף גוף של פונקציה מתוך הדף, לפי ספירת סוגריים. */
function grab(name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('לא נמצאה הפונקציה ' + name + ' ב-masa/index.html');
  let depth = 0;
  for (let k = src.indexOf('{', start); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(start, k + 1);
  }
  throw new Error('הפונקציה ' + name + ' לא נסגרת');
}

const marker = 'var KNOWN_DOMAINS = ';
const kStart = src.indexOf(marker + '[') + marker.length;
const KNOWN = JSON.parse(
  src.slice(kStart, src.indexOf('];', kStart) + 1).replace(/'/g, '"').replace(/\s+/g, ''),
);

const suggestFix = new Function(
  'KNOWN_DOMAINS',
  grab('oneEdit') + grab('oneSwap') + grab('suggestFix') + 'return suggestFix;',
)(KNOWN);

/* [מה שהוקלד, מה שצריך להציע. מחרוזת ריקה = לא להציע כלום] */
const CASES = [
  // ===== טעויות אמיתיות שחייבות להיתפס =====
  ['matankopel02@gmai.com', 'matankopel02@gmail.com'],   // ‼️ זה מה שקרה בפועל
  ['x@gmial.com', 'x@gmail.com'],                        // החלפת שני תווים
  ['x@gmail.co', 'x@gmail.com'],                         // תו חסר בסוף
  ['x@gmaill.com', 'x@gmail.com'],                       // תו כפול
  ['x@gmzil.com', 'x@gmail.com'],                        // תו מוחלף
  ['x@hotmai.com', 'x@hotmail.com'],
  ['x@hotmial.com', 'x@hotmail.com'],
  ['x@yaho.com', 'x@yahoo.com'],
  ['x@outlok.com', 'x@outlook.com'],
  ['x@icloud.co', 'x@icloud.com'],
  ['x@walla.co.i', 'x@walla.co.il'],
  ['x@wala.co.il', 'x@walla.co.il'],

  // ===== ‼️ כתובות תקינות. הצעה כאן היא באג מעצבן בדרך לתשלום =====
  ['x@gmail.com', ''],
  ['x@hotmail.com', ''],
  ['x@walla.co.il', ''],
  ['x@yahoo.com', ''],
  ['calisthenics.coach@matankopel.co.il', ''],           // הדומיין של מתן
  ['x@mycompany.com', ''],                               // דומיין פרטי של עסק
  ['x@proton.me', ''],                                   // ספק שלא ברשימה
  ['x@gmail.org', ''],                                   // סיומת אחרת לגמרי
];

let pass = 0, fail = 0;
for (const [typed, want] of CASES) {
  const got = suggestFix(typed);
  if (got === want) {
    pass++;
    console.log('  PASS  ' + typed.padEnd(38) + ' -> ' + (got || '(לא מציע כלום)'));
  } else {
    fail++;
    console.log('  FAIL  ' + typed.padEnd(38) + ' -> ' + (got || 'כלום') + ', want ' + (want || 'כלום'));
  }
}
console.log('\n' + pass + ' עברו, ' + fail + ' נכשלו\n');
process.exit(fail ? 1 : 0);
