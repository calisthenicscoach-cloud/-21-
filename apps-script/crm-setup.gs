/**
 * Matan Kopel — הקמת "מרכז שליטה" בגיליון הלידים (CRM).
 * בונה אוטומטית: טאב "מתאמנים פעילים" + "ארכיון מתאמנים", דרופדאונים, צבעים,
 * עמודת וואטסאפ לחיצה, והעברה אוטומטית לארכיון כשמסמנים "סיים".
 *
 * ⚠️ בטוח: לא משנה ולא מוחק שום עמודה קיימת בטאב הלידים — רק מוסיף.
 *
 * הרצה (פעם אחת):
 *   1. פותחים את גיליון הלידים ← Extensions ▸ Apps Script.
 *   2. מדביקים את כל הקובץ הזה ← שומרים.
 *   3. בוחרים למעלה את הפונקציה setupCRM ▸ Run ▸ מאשרים הרשאה.
 *   4. חוזרים לגיליון — הכל בנוי. (יש גם תפריט "🛠️ CRM" למעלה.)
 */

/* ===== הגדרות ===== */
var LEADS_STATUS  = ['חדש', 'בשיחה', 'לא ענה', 'הצעה נשלחה', 'נסגר ✅', 'לא רלוונטי', 'אבוד'];
var TRAINEE_STATUS = ['פעיל/ה', 'מוקפא', 'המשיך לעוד מסלול', 'סיים'];
var TRACKS = ['חודש ניסיון', '4 חודשים', '10 חודשים', 'מנוי חודשי מתחדש', 'ללא התחייבות'];
var RANKS = ['טירון שלב א', 'טירון שלב ב', 'גובניק שלב א', 'גובניק שלב ב',
             'תומך לחימה שלב א', 'תומך לחימה שלב ב', 'לוחם שלב א', 'לוחם שלב ב',
             'לוחם חוד שלב א', 'לוחם חוד שלב ב', 'לוחם סיירת שלב א', 'לוחם סיירת שלב ב',
             'לוחם קומנדו שלב א', 'לוחם קומנדו שלב ב', 'לוחם עילית'];
var TRAINEE_HEADERS = ['שם', 'מסלול', 'דרגה', 'סטטוס', 'תאריך התחלה', 'תאריך סיום',
                       'תאריך קשר אחרון', 'מחיר חודשי', 'טלפון', 'וואטסאפ', 'הערות'];
var ACTIVE_SHEET  = 'מתאמנים פעילים';
var ARCHIVE_SHEET = 'ארכיון מתאמנים';

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🛠️ CRM')
    .addItem('הקם / רענן מבנה', 'setupCRM')
    .addItem('העבר מסיימים לארכיון (ידני)', 'archiveFinishedNow')
    .addToUi();
}

/* ===== הקמה ראשית (בטוח להריץ שוב) ===== */
function setupCRM() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  enhanceLeads_(ss);
  var active = ensureTraineeSheet_(ss, ACTIVE_SHEET, true);
  ensureTraineeSheet_(ss, ARCHIVE_SHEET, false);
  installArchiveTrigger_();
  SpreadsheetApp.getUi().alert('✅ מרכז השליטה מוכן!\n\nנוצרו/עודכנו: "' + ACTIVE_SHEET + '", "' + ARCHIVE_SHEET +
    '", דרופדאונים, צבעים, עמודת וואטסאפ, והעברה אוטומטית לארכיון.\n\nעכשיו אפשר להעתיק את המתאמנים מנושן ל"' + ACTIVE_SHEET + '".');
}

/* ----- שדרוג טאב הלידים (רק הוספות) ----- */
function enhanceLeads_(ss) {
  var sheet = findLeadsSheet_(ss);
  if (!sheet) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // דרופדאון לעמודת "סטטוס" (בלי לדחות ערכים קיימים)
  var statusCol = headers.indexOf('סטטוס') + 1;
  if (statusCol > 0) {
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(LEADS_STATUS, true).setAllowInvalid(true).build();
    sheet.getRange(2, statusCol, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  }

  // עמודת וואטסאפ לחיצה (אם עוד אין) — מוסיפים בקצה מימין, לא נוגעים בקיים
  if (headers.indexOf('וואטסאפ') === -1) {
    var phoneCol = headers.indexOf('מס טלפון');
    if (phoneCol === -1) phoneCol = headers.indexOf('טלפון');
    if (phoneCol > -1) {
      var newCol = sheet.getLastColumn() + 1;
      var phoneA1 = columnToLetter_(phoneCol + 1);
      sheet.getRange(1, newCol).setValue('וואטסאפ');
      sheet.getRange(2, newCol).setFormula(whatsappArrayFormula_(phoneA1));
    }
  }
}

/* ----- יצירת/רענון טאב מתאמנים ----- */
function ensureTraineeSheet_(ss, name, withValidation) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  // כותרות
  sheet.getRange(1, 1, 1, TRAINEE_HEADERS.length).setValues([TRAINEE_HEADERS])
    .setFontWeight('bold').setBackground('#3a3e26').setFontColor('#F1DC92');
  sheet.setFrozenRows(1);

  var lastRow = Math.max(sheet.getMaxRows() - 1, 1);
  var col = function (h) { return TRAINEE_HEADERS.indexOf(h) + 1; };

  // דרופדאונים
  if (withValidation) {
    setListValidation_(sheet, col('מסלול'), TRACKS, lastRow);
    setListValidation_(sheet, col('דרגה'), RANKS, lastRow);
    setListValidation_(sheet, col('סטטוס'), TRAINEE_STATUS, lastRow);
  } else {
    setListValidation_(sheet, col('דרגה'), RANKS, lastRow);
    setListValidation_(sheet, col('סטטוס'), TRAINEE_STATUS, lastRow);
    setListValidation_(sheet, col('מסלול'), TRACKS, lastRow);
  }

  // עמודת וואטסאפ (נוסחת מערך)
  var phoneA1 = columnToLetter_(col('טלפון'));
  sheet.getRange(2, col('וואטסאפ')).setFormula(whatsappArrayFormula_(phoneA1));

  // תבנית תאריך לעמודות התאריך
  ['תאריך התחלה', 'תאריך סיום', 'תאריך קשר אחרון'].forEach(function (h) {
    sheet.getRange(2, col(h), lastRow, 1).setNumberFormat('dd/mm/yyyy');
  });

  // צביעה לפי סטטוס (על הטאב הזה בלבד — בטוח)
  var statusA1 = columnToLetter_(col('סטטוס'));
  var rowsRange = sheet.getRange(2, 1, lastRow, TRAINEE_HEADERS.length);
  var rules = [
    cfRule_('=$' + statusA1 + '2="פעיל/ה"', '#e7f0dd', rowsRange),
    cfRule_('=$' + statusA1 + '2="מוקפא"', '#dbe7f5', rowsRange),
    cfRule_('=$' + statusA1 + '2="סיים"', '#eeeeee', rowsRange),
    cfRule_('=$' + statusA1 + '2="המשיך לעוד מסלול"', '#fff2cc', rowsRange)
  ];
  sheet.setConditionalFormatRules(rules);
  return sheet;
}

/* ----- העברה אוטומטית לארכיון כשמסמנים "סיים" ----- */
function onEditCRM(e) {
  try {
    var sheet = e.range.getSheet();
    if (sheet.getName() !== ACTIVE_SHEET) return;
    var statusCol = TRAINEE_HEADERS.indexOf('סטטוס') + 1;
    if (e.range.getColumn() !== statusCol || e.range.getNumRows() !== 1) return;
    if (String(e.value).trim() !== 'סיים') return;
    moveRowToArchive_(sheet, e.range.getRow());
  } catch (err) { /* מתעלמים בשקט */ }
}

function moveRowToArchive_(sheet, row) {
  var ss = sheet.getParent();
  var archive = ss.getSheetByName(ARCHIVE_SHEET) || ss.insertSheet(ARCHIVE_SHEET);
  var width = TRAINEE_HEADERS.length;
  var vals = sheet.getRange(row, 1, 1, width).getValues();
  archive.appendRow(vals[0]);                 // קודם מעתיקים
  sheet.deleteRow(row);                        // ורק אז מוחקים
}

function archiveFinishedNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ACTIVE_SHEET);
  if (!sheet) return;
  var statusCol = TRAINEE_HEADERS.indexOf('סטטוס') + 1;
  var last = sheet.getLastRow();
  var moved = 0;
  for (var r = last; r >= 2; r--) {            // מלמטה למעלה כדי שמחיקה לא תזיז אינדקסים
    if (String(sheet.getRange(r, statusCol).getValue()).trim() === 'סיים') {
      moveRowToArchive_(sheet, r); moved++;
    }
  }
  SpreadsheetApp.getUi().alert('הועברו לארכיון: ' + moved + ' מתאמנים.');
}

function installArchiveTrigger_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'onEditCRM'; });
  if (!exists) ScriptApp.newTrigger('onEditCRM').forSpreadsheet(ss).onEdit().create();
}

/* ===== עוזרים ===== */
function findLeadsSheet_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name === ACTIVE_SHEET || name === ARCHIVE_SHEET) continue;
    var hdr = sheets[i].getRange(1, 1, 1, sheets[i].getLastColumn()).getValues()[0];
    if (hdr.indexOf('מס טלפון') > -1 || hdr.indexOf('המטרה שלי היא:') > -1 || hdr.indexOf('שם מלא') > -1) return sheets[i];
  }
  return ss.getSheets()[0];   // נפילה חזרה: הטאב הראשון
}

function setListValidation_(sheet, col, values, numRows) {
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build();
  sheet.getRange(2, col, numRows, 1).setDataValidation(rule);
}

function cfRule_(formula, color, range) {
  return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(color).setRanges([range]).build();
}

/* נוסחת מערך: קישור וואטסאפ לחיץ מכל שורה, כולל תיקון ה-0 בהתחלה */
function whatsappArrayFormula_(phoneA1) {
  var p = phoneA1;
  return '=ARRAYFORMULA(IF(' + p + '2:' + p + '="","",' +
    'HYPERLINK("https://wa.me/972"&IF(LEFT(TRIM(""&' + p + '2:' + p + '),1)="0",' +
    'MID(TRIM(""&' + p + '2:' + p + '),2,15),TRIM(""&' + p + '2:' + p + ')),"💬 וואטסאפ")))';
}

function columnToLetter_(col) {
  var s = '';
  while (col > 0) { var m = (col - 1) % 26; s = String.fromCharCode(65 + m) + s; col = Math.floor((col - m) / 26); }
  return s;
}
