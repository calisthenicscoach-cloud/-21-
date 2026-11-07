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
 * הבדיקה שולפת את הפונקציות מתוך הדפים עצמם, כדי שלא ייווצר עותק
 * שלישי של הלוגיקה שיכול להתיישן. שני הדפים נבדקים מול אותם מקרים
 * בדיוק — אם מישהו יתקן אחד וישכח את השני, זה ייפול כאן.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PAGES = [
  ['מסע הכוח', path.join(here, 'index.html')],
  ['21 יום (/nivnatan/)', path.join(here, '..', 'nivnatan', 'index.html')],
];

/* בונה את suggestFix מתוך הקוד של דף נתון. */
function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  const grab = (name) => {
    const start = src.indexOf('function ' + name + '(');
    if (start === -1) throw new Error('לא נמצאה הפונקציה ' + name + ' ב-' + file);
    let depth = 0;
    for (let k = src.indexOf('{', start); k < src.length; k++) {
      if (src[k] === '{') depth++;
      else if (src[k] === '}' && --depth === 0) return src.slice(start, k + 1);
    }
    throw new Error('הפונקציה ' + name + ' לא נסגרת');
  };
  const marker = 'var KNOWN_DOMAINS = ';
  const kStart = src.indexOf(marker + '[') + marker.length;
  if (kStart < marker.length) throw new Error('אין רשימת דומיינים ב-' + file);
  const KNOWN = JSON.parse(
    src.slice(kStart, src.indexOf('];', kStart) + 1).replace(/'/g, '"').replace(/\s+/g, ''),
  );
  return new Function(
    'KNOWN_DOMAINS',
    grab('oneEdit') + grab('oneSwap') + grab('suggestFix') + 'return suggestFix;',
  )(KNOWN);
}

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
for (const [label, file] of PAGES) {
  console.log('\n--- דף המכירה של ' + label + ' ---');
  const suggestFix = load(file);
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
}
console.log('\n' + pass + ' עברו, ' + fail + ' נכשלו\n');
process.exit(fail ? 1 : 0);
