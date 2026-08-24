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
    subjectMatch: /הקבלה[\s\S]{0,40}מודעות/,      // רק קבלות אמת (עמיד לתווי כיווניות נסתרים)
    amount: metaAdsAmount_,
    month:  emailMonth_                          // חודש לפי תאריך המייל (רגע החיוב)
  },
  {
    name:   'קארדקום',
    method: 'אשראי',
    query:  'subject:(חשבונית קארדקום)',
    fromMatch:    /cardcom/i,
    subjectMatch: /חשבונית/,
    source:  'pdf',                              // הסכום נמצא בקובץ ה-PDF המצורף
    amount:  cardcomAmount_,
    month:   emailMonth_                         // חודש לפי תאריך המייל (רגע החיוב)
  },
  {
    name:   'וי כחול אינסטגרם',
    method: 'אשראי',
    query:  'subject:("automatic payment reminder")',
    fromMatch:    /instagram|meta|facebook|matankopel/i, // עמיד גם לפורוורד ידני וגם אוטומטי
    subjectMatch: /automatic payment reminder/i,
    amount: metaVerifiedAmount_,
    month:  emailMonth_                          // חודש לפי תאריך המייל (רגע החיוב)
  },
  {
    name:   'מייל עסקי',
    method: 'אשראי',
    query:  'subject:(Google Workspace)',
    fromMatch:    /google\.com|payments-noreply/i,
    subjectMatch: /חשבונית/,                      // רק מייל החשבונית, לא עדכוני מוצר/ניסיון
    source:  'pdf',                              // הסכום ב-EUR בתוך PDF → מומר לשקל
    amount:  googleWorkspaceAmount_,
    month:   emailMonth_                         // חודש לפי תאריך המייל (רגע החיוב)
  },
  {
    name:   'עמלות אשראי חודשיות',
    method: 'אשראי',
    query:  'subject:(סיכום תשלומי)',
    fromMatch:    /grow|matankopel/i,            // Grow (info@mail.grow.business) או פורוורד
    subjectMatch: /סיכום תשלומי/,
    source:  'xlsx',                             // הסכום בקובץ Excel מצורף (סכום עמודת "עמלת אשראי")
    amount:  growFeeAmount_,
    month:   growMonth_
  },
  {
    name:   'קלוד',
    method: 'אשראי',
    query:  'subject:(receipt Anthropic)',
    fromMatch:    /anthropic/i,
    subjectMatch: /receipt from Anthropic/i,
    source:  'pdf',                             // הסכום ב-USD בתוך PDF → מומר לשקל
    amount:  claudeAmount_,
    month:   emailMonth_                         // חודש לפי תאריך המייל (רגע החיוב)
  },
  {
    name:   'canva',
    method: 'אשראי',
    query:  'subject:(Canva)',
    fromMatch:    /canva|matankopel/i,          // Canva או פורוורד מ-matankopel02
    subjectMatch: /חשבונית/,                     // רק החשבונית, לא מיילים אחרים של Canva
    amount:  canvaAmount_,                       // הסכום ב-USD בגוף המייל → מומר לשקל
    month:   emailMonth_                         // חודש לפי תאריך המייל (בגוף אין תאריך חיוב אמין)
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
    .addItem('בדיקת קארדקום PDF', 'dumpCardcom')
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

/* מציץ בגוף הקבלה הראשונה כדי לראות איך נראה הטקסט (לצורך תיקון חילוץ הסכום) */
function dumpReceipt() {
  const th = GmailApp.search('subject:(הקבלה מודעות Meta)', 0, 1);
  if (!th.length) { SpreadsheetApp.getUi().alert('אין תוצאות'); return; }
  const msg = th[0].getMessages()[0];
  const body = msg.getPlainBody() || '';
  const money = body.split('\n').filter(function (l) { return /₪|ILS|סכום|סה/.test(l); })
                    .slice(0, 12).map(function (l) { return l.trim(); });
  const info =
    'אורך גוף: ' + body.length +
    '\n₪? ' + (body.indexOf('₪') >= 0) + ' | ILS? ' + (body.indexOf('ILS') >= 0) +
    '\nסכום שזוהה: ' + metaAdsAmount_(body) +
    '\n\nשורות עם סכום:\n' + (money.join('\n') || '(אין)') +
    '\n\n700 תווים ראשונים:\n' + body.substring(0, 700);
  Logger.log(info);
  SpreadsheetApp.getUi().alert('בדיקת גוף המייל', info, SpreadsheetApp.getUi().ButtonSet.OK);
}

/* בדיקת חילוץ ה-PDF של קארדקום */
function dumpCardcom() {
  const th = GmailApp.search('subject:(חשבונית קארדקום)', 0, 1);
  if (!th.length) { SpreadsheetApp.getUi().alert('לא נמצא מייל קארדקום'); return; }
  const msg = th[0].getMessages()[0];
  const names = msg.getAttachments().map(function (a) { return a.getName() + ' (' + a.getContentType() + ')'; }).join(', ');
  const text = extractPdfText_(msg);
  const money = (text.match(/[0-9][0-9,]*\.\d{2}/g) || []).join(', ');
  const info = 'קבצים מצורפים: ' + (names || '(אין)') +
    '\nאורך טקסט מה-PDF: ' + text.length +
    '\nסכום שזוהה: ' + cardcomAmount_(text) +
    '\nמספרים עם 2 ספרות: ' + (money || '(אין)') +
    '\n\n500 תווים ראשונים:\n' + text.substring(0, 500);
  Logger.log(info);
  SpreadsheetApp.getUi().alert('בדיקת קארדקום PDF', info, SpreadsheetApp.getUi().ButtonSet.OK);
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
  let cThreads = 0, cDate = 0, cFrom = 0, cSubj = 0, cAmt = 0;

  // מורנינג (קובץ morning.gs): שולח כל קבלה גם כהוצאה במורנינג. אופציונלי — אם הקובץ/המפתחות לא קיימים, מדלגים.
  const mEnabled = !dryRun && (typeof morningEnabled_ === 'function') && morningEnabled_();
  const mStart = mEnabled ? morningStartDate_() : null;
  let mSent = 0, mFail = 0;

  VENDORS.forEach(function (v) {
    // חיפוש לפי הנושא בלבד (תאריך ו"כבר נקלט" מסוננים בקוד — מקפים שוברים את חיפוש Gmail)
    const threads = GmailApp.search(v.query, 0, 100);
    cThreads += threads.length;

    threads.forEach(function (th) {
      let sheetDone = false;
      if (!dryRun) {
        const names = th.getLabels().map(function (l) { return l.getName(); });
        sheetDone = names.indexOf(PROCESSED_LABEL) !== -1; // כבר נקלט לשיטס
      }
      let handled = false;
      th.getMessages().forEach(function (msg) {
        if (!dryRun && msg.getDate() < startDate) return;
        cDate++;
        if (v.fromMatch && !v.fromMatch.test(msg.getFrom())) return;
        cFrom++;
        if (v.subjectMatch && !v.subjectMatch.test(msg.getSubject())) return;
        cSubj++;

        const needSheet   = !dryRun && !sheetDone;
        const needMorning = !dryRun && mEnabled && msg.getDate() >= mStart && !morningSentHas_(msg.getId());
        if (!dryRun && !needSheet && !needMorning) return; // כבר טופל גם בשיטס וגם במורנינג — לא קוראים שוב PDF/Excel

        let data;
        if (v.source === 'pdf') data = extractPdfText_(msg);
        else if (v.source === 'xlsx') data = extractXlsxValues_(msg);
        else data = msg.getPlainBody() || '';
        const amt = v.amount(data);
        if (amt == null || !(amt > 0)) {
          const w = '⚠️ לא זוהה סכום: ' + msg.getSubject();
          report.push(w); Logger.log(w);
          return;
        }
        cAmt++;
        const month = v.month ? v.month(data, msg.getDate()) : hebMonth_(data, msg.getDate());

        if (dryRun) {
          const line = v.name + ' | ' + amt + '₪ | חודש ' + month;
          report.push(line); Logger.log('[בדיקה] ' + line);
          return;
        }

        let tag = '✓';
        if (needSheet) { addExpense_(sh, v.name, v.method, amt, month); handled = true; added++; }
        if (needMorning) {
          let ok = false;
          try { ok = sendToMorning_(v.name, amt, msg.getDate(), month, msg.getId()); }
          catch (e) { Logger.log('מורנינג נכשל: ' + e); }
          if (ok) { morningSentAdd_(msg.getId()); mSent++; tag += ' + מורנינג'; }
          else { mFail++; tag += ' (מורנינג נכשל)'; }
        }
        const line = tag + ' ' + v.name + ' | ' + amt + '₪ | חודש ' + month;
        report.push(line); Logger.log(line);
      });
      if (handled && label) th.addLabel(label);
    });
  });

  Logger.log(dryRun ? '— סיום בדיקה (לא נכתב כלום) —' : ('— נקלטו ' + added + ' חיובים —'));

  // חלון סיכום (רק כשמריצים ידנית מהתפריט; בטריגר אין UI)
  const funnel = 'מסלול הסינון:\n' +
    'נמצאו בחיפוש: ' + cThreads + '\n' +
    'עברו תאריך: ' + cDate + '\n' +
    'עברו שולח: ' + cFrom + '\n' +
    'עברו נושא: ' + cSubj + '\n' +
    'חולץ סכום: ' + cAmt + '\n' +
    'נשלחו למורנינג: ' + mSent + (mFail ? (' (נכשלו: ' + mFail + ')') : '') + '\n\n';
  Logger.log(funnel);
  try {
    const ui = SpreadsheetApp.getUi();
    const head = dryRun
      ? 'בדיקה בלבד — כלום לא נכתב בגיליון.\n\n'
      : ('נקלטו ' + added + ' חיובים לגיליון' + (mSent ? (', ' + mSent + ' נשלחו למורנינג') : '') + '.\n\n');
    ui.alert(dryRun ? 'בדיקת קליטת הוצאות' : 'קליטת הוצאות',
             head + funnel + (report.length ? report.join('\n') : 'לא נמצאו קבלות מתאימות.'),
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

/* ===== קארדקום: חילוץ הסכום מתוך ה-PDF המצורף ===== */
// דורש שירות מתקדם "Drive API" (Services → +). עובד גם ל-v2 וגם ל-v3.
function extractPdfText_(msg) {
  const atts = msg.getAttachments();
  let pdf = null;
  for (let i = 0; i < atts.length; i++) {
    if (atts[i].getContentType() === 'application/pdf' || /\.pdf$/i.test(atts[i].getName())) { pdf = atts[i]; break; }
  }
  if (!pdf) return '';
  const meta3 = { name: 'tmp-ocr', mimeType: 'application/vnd.google-apps.document' };
  const meta2 = { title: 'tmp-ocr', mimeType: 'application/vnd.google-apps.document' };
  const attempts = (typeof Drive !== 'undefined' && Drive.Files && Drive.Files.create)
    ? [ function () { return Drive.Files.create(meta3, pdf.copyBlob()); },
        function () { return Drive.Files.create(meta3, pdf.copyBlob(), { ocrLanguage: 'iw' }); } ]
    : [ function () { return Drive.Files.insert(meta2, pdf.copyBlob(), { ocr: true }); },
        function () { return Drive.Files.insert(meta2, pdf.copyBlob(), { ocr: true, ocrLanguage: 'iw' }); } ];

  let text = '';
  for (let i = 0; i < attempts.length && !text; i++) {
    let tmpId = null;
    try {
      const tmp = attempts[i]();
      tmpId = tmp.id;
      text = DocumentApp.openById(tmpId).getBody().getText();
    } catch (e) { Logger.log('OCR ניסיון ' + (i + 1) + ' נכשל: ' + e); }
    if (tmpId) { try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e) {} }
  }
  return text;
}

// סכום חשבונית קארדקום: "סה"כ שקל ₪177.00"; אם OCR ערבב — הסכום הגדול ביותר עם 2 ספרות אחרי הנקודה
function cardcomAmount_(text) {
  let m = text.match(/סה["״'`]?כ\s*שקל[\s\S]{0,12}?([0-9][0-9,]*\.\d{2})/);
  if (m) return toNum_(m[1]);
  m = text.match(/סה["״'`]?כ[\s\S]{0,20}?([0-9][0-9,]*\.\d{2})/);
  if (m) return toNum_(m[1]);
  const nums = (text.match(/[0-9][0-9,]*\.\d{2}/g) || []).map(toNum_).filter(function (x) { return x > 0; });
  return nums.length ? Math.max.apply(null, nums) : null;
}

// חודש מחשבונית קארדקום: תאריך DD/MM/YYYY; אם אין — לפי תאריך המייל
function cardcomMonth_(text, fallbackDate) {
  const m = text.match(/(\d{1,2})\/(\d{1,2})\/20\d{2}/);
  if (m) return Number(m[2]);
  return fallbackDate.getMonth() + 1;
}

// סכום Meta Verified (וי כחול): "Total ₪42.89"; אם לא — הסכום הגדול ביותר עם ₪
function metaVerifiedAmount_(text) {
  const m = text.match(/(?:^|[\s>(])Total\b[\s\S]{0,12}?₪?\s*([0-9][0-9.,]*)/);
  if (m && toNum_(m[1]) > 0) return toNum_(m[1]);
  const nums = [];
  let x, re = /₪\s*([0-9][0-9.,]*)/g;
  while ((x = re.exec(text))) nums.push(toNum_(x[1]));
  re = /([0-9][0-9.,]*)\s*₪/g;
  while ((x = re.exec(text))) nums.push(toNum_(x[1]));
  const pos = nums.filter(function (n) { return n > 0; });
  return pos.length ? Math.max.apply(null, pos) : null;
}

// חודש Meta Verified: מתוך "charged on YYYY/MM/DD"; אם אין — לפי תאריך המייל
function metaVerifiedMonth_(text, fallbackDate) {
  const m = text.match(/charged on\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/i);
  if (m) return Number(m[2]);
  return fallbackDate.getMonth() + 1;
}

/* ===== מייל עסקי (Google Workspace): סכום ב-EUR מתוך PDF → המרה לשקל ===== */
const FX_FALLBACK = { EURILS: 4.0, USDILS: 3.7 };
function fxRate_(from, to) {
  try {
    const res = UrlFetchApp.fetch('https://api.frankfurter.app/latest?from=' + from + '&to=' + to, { muteHttpExceptions: true });
    const j = JSON.parse(res.getContentText());
    if (j && j.rates && j.rates[to]) return j.rates[to];
  } catch (e) { Logger.log('שער חליפין נכשל: ' + e); }
  return FX_FALLBACK[from + to] || 1;
}
function googleWorkspaceAmount_(text) {
  const nums = (text.match(/[0-9][0-9,]*\.\d{2}/g) || []).map(toNum_).filter(function (x) { return x > 0; });
  if (!nums.length) return null;
  const eur = Math.max.apply(null, nums);
  return Math.round(eur * fxRate_('EUR', 'ILS') * 100) / 100;
}
function gwMonth_(text, fallbackDate) {
  const map = { 'ינואר':1,'פברואר':2,'מרץ':3,'אפריל':4,'מאי':5,'יוני':6,'יולי':7,'אוגוסט':8,'ספטמבר':9,'אוקטובר':10,'נובמבר':11,'דצמבר':12 };
  const m = text.match(/(ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|אוקטובר|נובמבר|דצמבר)/);
  if (m) return map[m[1]];
  return fallbackDate.getMonth() + 1;
}

/* ===== קלוד (Anthropic): סכום ב-USD מתוך PDF → המרה לשקל ===== */
function claudeAmount_(text) {
  let m = text.match(/Amount due[\s\S]{0,20}?\$?\s*([0-9][0-9,]*\.\d{2})/i);
  if (!m) m = text.match(/\bTotal\b[\s\S]{0,20}?\$?\s*([0-9][0-9,]*\.\d{2})/i);
  let usd;
  if (m) usd = toNum_(m[1]);
  else {
    const nums = (text.match(/[0-9][0-9,]*\.\d{2}/g) || []).map(toNum_).filter(function (x) { return x > 0; });
    if (!nums.length) return null;
    usd = Math.max.apply(null, nums);
  }
  return Math.round(usd * fxRate_('USD', 'ILS') * 100) / 100;
}
function claudeMonth_(text, fallbackDate) {
  const em = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
               jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
  const m = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/i);
  if (m) return em[m[1].toLowerCase()];
  return fallbackDate.getMonth() + 1;
}

/* ===== canva: סכום ב-USD בגוף המייל → המרה לשקל ===== */
function canvaAmount_(text) {
  let m = text.match(/סכום שחויב[\s\S]{0,20}?\$?\s*([0-9][0-9,]*\.\d{2})/);
  let usd;
  if (m) usd = toNum_(m[1]);
  else {
    const nums = (text.match(/[0-9][0-9,]*\.\d{2}/g) || []).map(toNum_).filter(function (x) { return x > 0; });
    if (!nums.length) return null;
    usd = Math.max.apply(null, nums);
  }
  return Math.round(usd * fxRate_('USD', 'ILS') * 100) / 100;
}

/* ===== עמלות אשראי (Grow): הסכום בקובץ Excel מצורף ===== */
const HEB_MONTHS = { 'ינואר':1,'פברואר':2,'מרץ':3,'אפריל':4,'מאי':5,'יוני':6,'יולי':7,'אוגוסט':8,'ספטמבר':9,'אוקטובר':10,'נובמבר':11,'דצמבר':12 };

// ממיר את ה-Excel המצורף לגיליון זמני ומחזיר את כל הערכים (מערך דו-ממדי)
function extractXlsxValues_(msg) {
  const atts = msg.getAttachments();
  let xls = null;
  for (let i = 0; i < atts.length; i++) {
    if (/sheet|excel|xlsx/i.test(atts[i].getContentType()) || /\.xlsx?$/i.test(atts[i].getName())) { xls = atts[i]; break; }
  }
  if (!xls) return null;
  let tmpId = null, values = null;
  try {
    let tmp;
    if (typeof Drive !== 'undefined' && Drive.Files && Drive.Files.create) {
      tmp = Drive.Files.create({ name: 'tmp-xlsx', mimeType: 'application/vnd.google-apps.spreadsheet' }, xls.copyBlob());
    } else {
      tmp = Drive.Files.insert({ title: 'tmp-xlsx', mimeType: 'application/vnd.google-apps.spreadsheet' }, xls.copyBlob(), { convert: true });
    }
    tmpId = tmp.id;
    values = SpreadsheetApp.openById(tmpId).getSheets()[0].getDataRange().getValues();
  } catch (e) { Logger.log('קריאת Excel נכשלה: ' + e); }
  if (tmpId) { try { DriveApp.getFileById(tmpId).setTrashed(true); } catch (e) {} }
  return values;
}

// סכום עמודת "עמלת אשראי" (שורות נתונים בלבד — מדלג על שורת סיכום שאין בה "חודש חיוב")
function growFeeAmount_(values) {
  if (!values || !values.length) return null;
  const head = values[0].map(function (h) { return String(h == null ? '' : h).trim(); });
  const feeCol = head.indexOf('עמלת אשראי');
  const monCol = head.indexOf('חודש חיוב');
  if (feeCol === -1) return null;
  let sum = 0;
  for (let r = 1; r < values.length; r++) {
    if (monCol >= 0 && !String(values[r][monCol] == null ? '' : values[r][monCol]).trim()) continue;
    const n = Number(values[r][feeCol]);
    if (!isNaN(n)) sum += n;
  }
  return Math.round(sum * 100) / 100;
}

// חודש מתוך עמודת "חודש חיוב" (שם חודש בעברית)
function growMonth_(values, fallbackDate) {
  if (values && values.length) {
    const head = values[0].map(function (h) { return String(h == null ? '' : h).trim(); });
    const monCol = head.indexOf('חודש חיוב');
    if (monCol >= 0) {
      for (let r = 1; r < values.length; r++) {
        const name = String(values[r][monCol] == null ? '' : values[r][monCol]).trim();
        if (HEB_MONTHS[name]) return HEB_MONTHS[name];
      }
    }
  }
  return fallbackDate.getMonth() + 1;
}

// חודש לפי תאריך המייל בפועל (הכי אמין לחיובים חודשיים שנשלחים ברגע החיוב)
function emailMonth_(text, fallbackDate) {
  return fallbackDate.getMonth() + 1;
}

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
