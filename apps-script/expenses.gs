/**
 * קליטת הוצאות אוטומטית מהמייל → גיליון "הוצאות"
 * ---------------------------------------------------------------
 * סקריפט מחובר (container-bound) לגיליון הכספים.
 * מותקן דרך: פתיחת הגיליון בגוגל שיטס → Extensions → Apps Script → הדבקה.
 *
 * מה הוא עושה:
 *   סורק את ה-Gmail של החשבון (calisthenics.coach@matankopel.co.il),
 *   מזהה מיילי קבלות לפי כללי ספק, ומוסיף/מעדכן שורה בטאב "הוצאות".
 *   כל (ספק + חודש) = שורה אחת; קבלות נוספות באותו חודש מתווספות לסכום.
 *   כל תהליך שנקלט מקבל תווית ב-Gmail כדי שלא ייקלט פעמיים.
 *
 * הפעלה:
 *   previewExpenses()  – בדיקה בלבד: מדפיס ל-Log מה היה נקלט, בלי לכתוב כלום.
 *   scanExpenses()     – הריצה האמיתית (זו שרצה בטריגר).
 *   installExpensesTrigger() – מתקין טריגר יומי אוטומטי.
 */

/* ===== הגדרות ===== */
const EXPENSE_SHEET_NAME = 'הוצאות';
const PROCESSED_LABEL    = 'הוצאות-נקלט';        // תווית Gmail למיילים שכבר נקלטו
const START_AFTER        = '2026/08/23';         // קולט רק קבלות מהתאריך הזה והלאה (פורמט YYYY/MM/DD)

/* ===== כללי ספקים (להוספת ספק חדש – מוסיפים אובייקט לרשימה) ===== */
const VENDORS = [
  {
    name:   'ממומן',                             // ← מה שייכתב בעמודה A (תואם לשם הקיים בגיליון)
    method: 'אשראי',                             // ← עמודה B (אשראי / העברה בנקאית / ביט)
    query:  'subject:(הקבלה מודעות Meta)',        // חיפוש לפי נושא (בשולח יש מקף שמבלבל את Gmail)
    fromMatch:    /facebook/i,
    subjectMatch: /הקבלה שלך.{0,25}מודעות\s*Meta/, // רק קבלות אמת, לא מיילים שיווקיים
    amount: metaAdsAmount_
  }
];

/* ===== נקודות כניסה ===== */
function scanExpenses()    { return run_(false); }
function previewExpenses() { return run_(true);  }

function installExpensesTrigger() {
  // מסיר טריגרים קודמים של scanExpenses כדי לא לכפול
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scanExpenses') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('scanExpenses').timeBased().everyHours(6).create();
  Logger.log('טריגר הותקן: scanExpenses ירוץ כל 6 שעות.');
}

/* תפריט בגיליון להרצה נוחה */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('הוצאות אוטומטיות')
    .addItem('בדיקה (ללא שינוי) — Log', 'previewExpenses')
    .addItem('קליטה עכשיו', 'scanExpenses')
    .addSeparator()
    .addItem('אבחון (בדיקת חיבור)', 'diagnoseExpenses')
    .addItem('הפעל קליטה אוטומטית (טריגר)', 'installExpensesTrigger')
    .addToUi();
}

/* אבחון: מגלה איזה חשבון קורא את המייל ומה החיפושים מוצאים */
function diagnoseExpenses() {
  const lines = [];
  try { lines.push('חשבון פעיל: ' + (Session.getActiveUser().getEmail() || '(ריק)')); } catch (e) { lines.push('חשבון פעיל: ?'); }
  try { lines.push('חשבון אפקטיבי: ' + (Session.getEffectiveUser().getEmail() || '(ריק)')); } catch (e) {}

  const queries = ['subject:(הקבלה מודעות Meta)', 'מודעות Meta', 'הקבלה שלך', 'facebook'];
  queries.forEach(function (q) {
    let th = [];
    try { th = GmailApp.search(q, 0, 5); } catch (e) { lines.push('\n["' + q + '"] שגיאה: ' + e); return; }
    lines.push('\n["' + q + '"] → ' + th.length + ' תוצאות');
    th.slice(0, 2).forEach(function (t) {
      const m = t.getMessages()[0];
      lines.push('  from: ' + m.getFrom());
      lines.push('  subj: ' + m.getSubject());
    });
  });

  const out = lines.join('\n');
  Logger.log(out);
  try { SpreadsheetApp.getUi().alert('אבחון קליטת הוצאות', out, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
}

/* ===== מנוע ===== */
function run_(dryRun) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(EXPENSE_SHEET_NAME);
  if (!sh) { Logger.log('לא נמצא טאב בשם "%s"', EXPENSE_SHEET_NAME); return; }

  const label = dryRun ? null :
    (GmailApp.getUserLabelByName(PROCESSED_LABEL) || GmailApp.createLabel(PROCESSED_LABEL));
  const startDate = parseYmd_(START_AFTER);
  const report = [];
  let added = 0;

  VENDORS.forEach(function (v) {
    const afterClause = dryRun ? 'newer_than:180d' : ('after:' + START_AFTER);
    const q = v.query + ' ' + afterClause + (dryRun ? '' : (' -label:' + PROCESSED_LABEL));
    const threads = GmailApp.search(q, 0, 50);

    threads.forEach(function (th) {
      let handled = false;
      th.getMessages().forEach(function (msg) {
        if (!dryRun && msg.getDate() < startDate) return;
        if (v.fromMatch && !v.fromMatch.test(msg.getFrom())) return;
        if (v.subjectMatch && !v.subjectMatch.test(msg.getSubject())) return;

        const text = msg.getPlainBody() || '';
        const amt = v.amount(text);
        if (amt == null || !(amt > 0)) {
          const w = '⚠️ לא זוהה סכום: ' + msg.getSubject();
          report.push(w); Logger.log(w);
          return;
        }
        const month = hebMonth_(text, msg.getDate());

        if (dryRun) {
          const line = v.name + ' | ' + amt + '₪ | חודש ' + month;
          report.push(line); Logger.log('[בדיקה] ' + line);
        } else {
          addExpense_(sh, v.name, v.method, amt, month);
          handled = true; added++;
          const line = '✓ ' + v.name + ' | ' + amt + '₪ | חודש ' + month;
          report.push(line); Logger.log(line);
        }
      });
      if (handled && label) th.addLabel(label);
    });
  });

  Logger.log(dryRun ? '— סיום בדיקה (לא נכתב כלום) —' : ('— נקלטו ' + added + ' חיובים —'));

  // חלון סיכום (רק כשמריצים ידנית מהתפריט; בטריגר אין UI)
  try {
    const ui = SpreadsheetApp.getUi();
    const head = dryRun
      ? 'בדיקה בלבד — כלום לא נכתב בגיליון.\nאלו החיובים שהיו נקלטים:\n\n'
      : ('נקלטו ' + added + ' חיובים לגיליון:\n\n');
    ui.alert(dryRun ? 'בדיקת קליטת הוצאות' : 'קליטת הוצאות',
             head + (report.length ? report.join('\n') : 'לא נמצאו קבלות מתאימות.'),
             ui.ButtonSet.OK);
  } catch (e) { /* אין UI (הרצת טריגר) — מדלגים */ }
}

/* מוצא שורת (ספק+חודש) קיימת ומוסיף לסכום, אחרת יוצר שורה חדשה */
function addExpense_(sh, name, method, amount, month) {
  const last = Math.max(sh.getLastRow(), 1);
  const n = Math.max(last - 1, 1);
  const aVals = sh.getRange(2, 1, n, 1).getValues();  // עמודה A
  const eVals = sh.getRange(2, 5, n, 1).getValues();  // עמודה E (חודש)

  let target = -1, firstEmpty = -1;
  for (let i = 0; i < aVals.length; i++) {
    const a = (aVals[i][0] == null ? '' : String(aVals[i][0])).trim();
    if (a === '' && firstEmpty === -1) firstEmpty = i + 2;
    if (a === name && Number(eVals[i][0]) === Number(month)) { target = i + 2; break; }
  }

  if (target !== -1) {
    const cur = Number(sh.getRange(target, 3).getValue()) || 0;
    sh.getRange(target, 3).setValue(Math.round((cur + amount) * 100) / 100);
    return;
  }
  const row = (firstEmpty !== -1) ? firstEmpty : (last + 1);
  writeExpenseRow_(sh, row, name, method, amount, month);
}

/* כותב שורה חדשה כולל הנוסחאות (F ועמודות החודשים G:R) */
function writeExpenseRow_(sh, row, name, method, amount, month) {
  sh.getRange(row, 1, 1, 5).setValues([[name, method, amount, 1, month]]);
  sh.getRange(row, 6).setFormula('=IF(D' + row + '>0, ROUND(C' + row + '/D' + row + ',2), 0)');
  for (let m = 1; m <= 12; m++) {
    const col = 6 + m; // G=7 ... R=18
    sh.getRange(row, col).setFormula(
      '=IF(AND(E' + row + '<=' + m + ', E' + row + '+D' + row + '-1>=' + m + '), F' + row + ', 0)');
  }
}

/* ===== מחלצי נתונים ===== */

// סכום קבלת מודעות Meta: הסכום ליד "(ILS)", ואם לא — ליד "סה"כ" / "סכום החיוב"
function metaAdsAmount_(text) {
  let m = text.match(/([0-9][0-9.,]*)\s*₪?\s*\(ILS\)/);
  if (m) return toNum_(m[1]);
  m = text.match(/\(ILS\)\s*₪?\s*([0-9][0-9.,]*)/);
  if (m) return toNum_(m[1]);
  m = text.match(/(?:סה["״']?כ|סכום החיוב)[\s\S]{0,40}?([0-9][0-9.,]*)\s*₪/);
  if (m) return toNum_(m[1]);
  m = text.match(/(?:סה["״']?כ|סכום החיוב)[\s\S]{0,40}?₪\s*([0-9][0-9.,]*)/);
  if (m) return toNum_(m[1]);
  return null;
}

function toNum_(s) { return parseFloat(String(s).replace(/,/g, '')); }

// חודש מתוך תאריך עברי בגוף המייל ("28 במאי 2026"); אם אין — לפי תאריך המייל
function hebMonth_(text, fallbackDate) {
  const map = { 'ינואר':1,'פברואר':2,'מרץ':3,'אפריל':4,'מאי':5,'יוני':6,
                'יולי':7,'אוגוסט':8,'ספטמבר':9,'אוקטובר':10,'נובמבר':11,'דצמבר':12 };
  const m = text.match(/\d{1,2}\s+ב?(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)\s+20\d{2}/);
  if (m) return map[m[1]];
  return fallbackDate.getMonth() + 1;
}

function parseYmd_(s) {
  const p = s.split('/');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
