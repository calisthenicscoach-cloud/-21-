/**
 * קארדקום → גיליון התזרים: הכנסות קורס "אתגר 21 יום"
 * ---------------------------------------------------------------
 * קובץ נפרד בפרויקט של גיליון התזרים (ליד קוד.gs / morning.gs).
 * קורא מיילי רכישה מקארדקום, ומכניס סיכום שבועי לטאב ההכנסות.
 * (משתמש מחדש ב-toNum_ ו-writeExpenseRow_ מ-קוד.gs.)
 *
 * הפעלה:
 *   cardcomPreview()        – בדיקה בלבד: מציג סיכום שבועי, לא כותב כלום.
 *   cardcomSync()           – הריצה האמיתית: מוסיף מכירות חדשות לטאב ההכנסות.
 *   cardcomAddManual()      – הוספת מכירה ידנית (למשל מייל שלא הגיע).
 *   installCardcomTrigger() – מתקין טריגר יומי אוטומטי.
 *
 * כל מכירה נספרת פעם אחת בלבד (דדופ לפי מספר עסקה פנימי, נשמר ב-Script Properties).
 * שורה אחת לכל שבוע (מתחיל ביום ראשון): "קורס 21 יום — שבוע DD/MM/YY".
 */

/* ===== הגדרות ===== */
const CARDCOM_START_AFTER = '2026/08/24';        // קולט רק רכישות מהתאריך הזה והלאה (YYYY/MM/DD)
const CARDCOM_METHOD      = 'אשראי';             // עמודה B (דרך העברה)
const COURSE_PREFIX       = 'קורס 21 יום — שבוע '; // תחילית שם השורה (עמודה A)

/* ===== חילוץ מגוף מייל הרכישה ===== */
function cardcomSaleAmount_(body) {
  // ליד "סכום לחיוב"
  let m = body.match(/סכום לחיוב[\s\S]{0,15}?([0-9][0-9,]*\.\d{2})/);
  if (m && toNum_(m[1]) > 0) return toNum_(m[1]);
  // אחרת: הסכום הגדול ביותר עם 2 ספרות עשרוניות (מדלג על כמות "1.0000")
  const nums = (body.match(/[0-9][0-9,]*\.\d{2}/g) || []).map(toNum_).filter(function (x) { return x > 1; });
  return nums.length ? Math.max.apply(null, nums) : null;
}

function cardcomTxnId_(body) {
  const m = body.match(/מספר עסקה פנימי[\s\S]{0,8}?(\d{5,})/);
  return m ? m[1] : null;
}

function cardcomSuccess_(body) {
  return /בוצעה בהצלחה/.test(body) || /חיוב כרטיס[\s\S]{0,6}?0(\D|$)/.test(body);
}

/* תחילת השבוע (יום ראשון) של תאריך */
function cardcomWeekStart_(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());  // 0 = ראשון
  return x;
}

/* קבוצת השבוע של עסקה: החודש נקבע לפי תאריך העסקה בפועל (לא לפי תחילת השבוע).
   כשהשבוע חוצה חודשים — התווית מוצמדת לתחילת חודש העסקה, כך שכל עסקה נכנסת לחודש הנכון. */
function cardcomWeekBucket_(d) {
  const ws = cardcomWeekStart_(d);
  let labelDate = ws;
  if (ws.getMonth() !== d.getMonth() || ws.getFullYear() !== d.getFullYear()) {
    labelDate = new Date(d.getFullYear(), d.getMonth(), 1);  // תחילת חודש העסקה
  }
  return {
    month: d.getMonth() + 1,
    label: COURSE_PREFIX + Utilities.formatDate(labelDate, 'Asia/Jerusalem', 'dd/MM/yy')
  };
}

/* ===== עזרים ===== */
function safeUi_() { try { return SpreadsheetApp.getUi(); } catch (e) { return null; } }

function cardcomStartDate_() {
  const s = PropertiesService.getScriptProperties().getProperty('CARDCOM_START_AFTER') || CARDCOM_START_AFTER;
  const p = s.split('/');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

/* מאתר את טאב ההכנסות: לפי כותרת A1="שם לקוח" (או Script Property CARDCOM_INCOME_SHEET) */
function cardcomIncomeSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const forced = PropertiesService.getScriptProperties().getProperty('CARDCOM_INCOME_SHEET');
  if (forced) return ss.getSheetByName(forced);
  const shs = ss.getSheets();
  for (let i = 0; i < shs.length; i++) {
    const a1 = String(shs[i].getRange(1, 1).getValue() || '').trim();
    if (a1 === 'שם לקוח') return shs[i];
  }
  return null;
}

/* דדופ מכירות שכבר נקלטו (לפי מספר עסקה) — נשמר ב-Script Properties */
let _cardcomSeen = null;
function cardcomSeenLoad_() {
  if (_cardcomSeen === null) {
    _cardcomSeen = {};
    const raw = PropertiesService.getScriptProperties().getProperty('CARDCOM_SEEN') || '';
    raw.split('\n').forEach(function (x) { if (x) _cardcomSeen[x] = 1; });
  }
  return _cardcomSeen;
}
function cardcomSeenHas_(k) { return !!cardcomSeenLoad_()[k]; }
function cardcomSeenAdd_(k) {
  const s = cardcomSeenLoad_(); s[k] = 1;
  let keys = Object.keys(s);
  if (keys.length > 3000) keys = keys.slice(keys.length - 3000);
  PropertiesService.getScriptProperties().setProperty('CARDCOM_SEEN', keys.join('\n'));
}

/* מוסיף סכום לשורת השבוע (מגדיל אם קיימת, אחרת יוצר שורה חדשה מיד אחרי הלקוח האחרון).
   מוסיף לפי השורה האחרונה עם שם בעמודה A — לא לפי getLastRow (שמושפע מנוסחאות ריקות למטה). */
function cardcomAddToWeek_(sh, label, method, amount, month) {
  const last = Math.max(sh.getLastRow(), 1);
  const n = Math.max(last - 1, 1);
  const aVals = sh.getRange(2, 1, n, 1).getValues();  // עמודה A (שם)
  const eVals = sh.getRange(2, 5, n, 1).getValues();  // עמודה E (חודש)
  let lastNameRow = 1;  // שורת הכותרת
  for (let i = 0; i < aVals.length; i++) {
    const a = (aVals[i][0] == null ? '' : String(aVals[i][0])).trim();
    if (a !== '') lastNameRow = i + 2;
    if (a === label && Number(eVals[i][0]) === Number(month)) {
      const target = i + 2;
      const cur = Number(sh.getRange(target, 3).getValue()) || 0;
      sh.getRange(target, 3).setValue(Math.round((cur + amount) * 100) / 100);
      return sh.getRange(target, 3).getValue();
    }
  }
  writeExpenseRow_(sh, lastNameRow + 1, label, method, amount, month);  // מ-קוד.gs
  return amount;
}

/* איפוס זיכרון המכירות — כדי לקלוט מחדש (למשל אחרי תיקון מיקום שורה) */
function cardcomReset() {
  PropertiesService.getScriptProperties().deleteProperty('CARDCOM_SEEN');
  _cardcomSeen = null;
  const ui = safeUi_();
  if (ui) try { ui.alert('אופס זיכרון קארדקום', 'הזיכרון אופס. ההרצה הבאה של cardcomSync תקלוט מחדש את כל המכירות מ-' + CARDCOM_START_AFTER + ' והלאה.', ui.ButtonSet.OK); } catch (e) {}
}

/* ===== בדיקת קריאה בלבד — לא כותב כלום ===== */
function cardcomPreview() {
  let out;
  try {
    const threads = GmailApp.search('subject:(רכישה מאתר)', 0, 300);
    const weeks = {};
    let found = 0, ok = 0;
    const bad = [];
    threads.forEach(function (th) {
      th.getMessages().forEach(function (msg) {
        if (!/cardcom/i.test(msg.getFrom())) return;
        if (!/רכישה מאתר/.test(msg.getSubject())) return;
        found++;
        const body = msg.getPlainBody() || '';
        if (!cardcomSuccess_(body)) return;
        const amt = cardcomSaleAmount_(body);
        if (amt == null || !(amt > 0)) { bad.push(msg.getSubject()); return; }
        ok++;
        const b = cardcomWeekBucket_(msg.getDate());
        if (!weeks[b.label]) weeks[b.label] = { lbl: b.label.replace(COURSE_PREFIX, ''), month: b.month, sum: 0, count: 0 };
        weeks[b.label].sum = Math.round((weeks[b.label].sum + amt) * 100) / 100;
        weeks[b.label].count++;
      });
    });
    const ks = Object.keys(weeks).sort();
    out = 'מיילי רכישה שנמצאו: ' + found + '  |  עסקאות תקינות: ' + ok + '\n\n' +
      'סיכום שבועי (שבוע מתחיל ביום ראשון):\n' +
      (ks.length ? ks.map(function (k) { return 'שבוע ' + weeks[k].lbl + ' (חודש ' + weeks[k].month + '):  ' + weeks[k].count + ' מכירות  ·  ' + weeks[k].sum + ' ₪'; }).join('\n') : '(לא נמצאו עסקאות)') +
      (bad.length ? ('\n\n⚠️ לא זוהה סכום ב-' + bad.length + ' מיילים') : '');
  } catch (e) { out = 'שגיאה: ' + e.message; }
  Logger.log(out);
  const ui = safeUi_();
  if (ui) try { ui.alert('קארדקום — בדיקת קריאה', out.substring(0, 1450), ui.ButtonSet.OK); } catch (e) {}
  return out;
}

/* ===== הריצה האמיתית — מוסיף מכירות חדשות לטאב ההכנסות ===== */
function cardcomSync() {
  let out;
  try {
    const sh = cardcomIncomeSheet_();
    if (!sh) throw new Error('לא נמצא טאב הכנסות (A1 צריך להיות "שם לקוח"). אפשר לקבוע ידנית ב-Script Property CARDCOM_INCOME_SHEET.');
    const startDate = cardcomStartDate_();
    const threads = GmailApp.search('subject:(רכישה מאתר)', 0, 300);
    let added = 0, dup = 0;
    const report = [];
    threads.forEach(function (th) {
      th.getMessages().forEach(function (msg) {
        if (msg.getDate() < startDate) return;
        if (!/cardcom/i.test(msg.getFrom())) return;
        if (!/רכישה מאתר/.test(msg.getSubject())) return;
        const body = msg.getPlainBody() || '';
        if (!cardcomSuccess_(body)) return;
        const amt = cardcomSaleAmount_(body);
        if (amt == null || !(amt > 0)) { report.push('⚠️ לא זוהה סכום: ' + msg.getSubject()); return; }
        const key = cardcomTxnId_(body) || msg.getId();
        if (cardcomSeenHas_(key)) { dup++; return; }
        const b = cardcomWeekBucket_(msg.getDate());
        cardcomAddToWeek_(sh, b.label, CARDCOM_METHOD, amt, b.month);
        cardcomSeenAdd_(key);
        added++;
        report.push('✓ ' + amt + ' ₪ → ' + b.label + ' (חודש ' + b.month + ')');
      });
    });
    out = 'נוספו ' + added + ' מכירות חדשות' + (dup ? ('  ·  דילוג על ' + dup + ' שכבר נקלטו') : '') +
      '\n\n' + (report.length ? report.join('\n') : 'אין מכירות חדשות.');
  } catch (e) { out = 'שגיאה: ' + e.message; }
  Logger.log(out);
  const ui = safeUi_();
  if (ui) try { ui.alert('קארדקום — קליטת הכנסות', out.substring(0, 1450), ui.ButtonSet.OK); } catch (e) {}
  return out;
}

/* ===== הוספת מכירה ידנית (מייל שלא הגיע) ===== */
function cardcomAddManual() {
  const ui = SpreadsheetApp.getUi();
  const sh = cardcomIncomeSheet_();
  if (!sh) { ui.alert('לא נמצא טאב הכנסות.'); return; }
  const rA = ui.prompt('הוספת מכירה ידנית — קורס 21 יום', 'סכום בשקלים (למשל 147):', ui.ButtonSet.OK_CANCEL);
  if (rA.getSelectedButton() !== ui.Button.OK) return;
  const amt = toNum_(rA.getResponseText());
  if (!(amt > 0)) { ui.alert('סכום לא תקין.'); return; }
  const rD = ui.prompt('תאריך המכירה', 'פורמט DD/MM/YYYY (השאר ריק = היום):', ui.ButtonSet.OK_CANCEL);
  if (rD.getSelectedButton() !== ui.Button.OK) return;
  let d = new Date();
  const t = (rD.getResponseText() || '').trim();
  if (t) { const p = t.split('/'); if (p.length === 3) d = new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0])); }
  const b = cardcomWeekBucket_(d);
  const total = cardcomAddToWeek_(sh, b.label, CARDCOM_METHOD, amt, b.month);
  ui.alert('נוסף ' + amt + ' ₪ ל“' + b.label + '” (חודש ' + b.month + ').\nסה"כ בשבוע כעת: ' + total + ' ₪.');
}

/* ===== טריגר אוטומטי ===== */
function installCardcomTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cardcomSync') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cardcomSync').timeBased().everyDays(1).atHour(7).create();
  const ui = safeUi_();
  if (ui) try { ui.alert('טריגר קארדקום הותקן', 'cardcomSync ירוץ אוטומטית פעם ביום (סביב 07:00).', ui.ButtonSet.OK); } catch (e) {}
}
