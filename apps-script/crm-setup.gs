/**
 * Matan Kopel — "מרכז שליטה" בגיליון הלידים (CRM) + מייל שבועי.
 * הרצה פעם אחת: setupCRM. יש גם תפריט "🛠️ CRM" למעלה.
 * ⚠️ בטוח: לא משנה ולא מוחק עמודות קיימות בטאב הלידים — רק מוסיף.
 *
 * הרצה: פותחים את גיליון הלידים ▸ Extensions ▸ Apps Script ▸ מדביקים ▸ שומרים ▸
 *       בוחרים setupCRM ▸ Run ▸ מאשרים הרשאה.
 */

/* ===== הגדרות ===== */
var CRM_EMAIL = 'calisthenics.coach@matankopel.co.il';   // לאן נשלח המייל השבועי

var RENEW_DAYS = 14;   // חידוש מתקרב — כמה ימים לפני תאריך הסיום
var QUIET_DAYS = 3;    // "לא דיברת" — מעל כמה ימים בלי קשר
var NEWLEAD_DAYS = 3;  // ליד חדש שממתין — מעל כמה ימים בסטטוס "חדש"
var NEWLEADS_WINDOW = 7; // חלון לספירת "לידים חדשים השבוע"

var LEADS_STATUS = ['חדש', 'פולואפ', 'לא ענה 1', 'לא ענה 2', 'לא ענה 3', 'הצעה נשלחה', 'לא נסגר', 'נסגר ✅', 'לא רלוונטי'];
var LEADS_COLORS = {
  'חדש': '#cfe2f3', 'פולואפ': '#ffe599', 'לא ענה 1': '#fce5cd', 'לא ענה 2': '#f9cb9c', 'לא ענה 3': '#f4cccc',
  'הצעה נשלחה': '#d9d2e9', 'לא נסגר': '#e06666', 'נסגר ✅': '#d9ead3', 'לא רלוונטי': '#efefef'
};

var TRAINEE_STATUS = ['פעיל/ה', 'מוקפא', 'המשיך לעוד מסלול', 'סיים'];
var TRACKS = ['חודש ניסיון', '3 חודשים', '8 חודשים', 'ללא התחייבות'];
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
    .addItem('מיין פעילים לפי תאריך סיום', 'sortActiveByEndDate')
    .addItem('שלח לי סיכום עכשיו (בדיקה)', 'sendWeeklyDigest')
    .addItem('העבר מסיימים לארכיון (ידני)', 'archiveFinishedNow')
    .addSeparator()
    .addItem('הקם / רענן מבנה', 'setupCRM')
    .addToUi();
}

function setupCRM() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  enhanceLeads_(ss);
  ensureTraineeSheet_(ss, ACTIVE_SHEET);
  ensureTraineeSheet_(ss, ARCHIVE_SHEET);
  installTriggers_();
  SpreadsheetApp.getUi().alert('✅ הכל מוכן!\n\n• טאבים, דרופדאונים, צבעים ועמודת וואטסאפ.\n• צבעים + סטטוסים בטבלת הלידים.\n• מייל שבועי — ראשון ב-09:00 (אפשר "שלח לי סיכום עכשיו" מהתפריט לבדיקה).');
}

/* ----- טאב לידים (רק הוספות) ----- */
function enhanceLeads_(ss) {
  var sheet = findLeadsSheet_(ss);
  if (!sheet) return;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });

  // דרופדאון לסטטוס
  var statusCol = headers.indexOf('סטטוס') + 1;
  if (statusCol > 0) {
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(LEADS_STATUS, true).setAllowInvalid(true).build();
    sheet.getRange(2, statusCol, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);

    // צביעה לפי סטטוס
    var lastCol = sheet.getLastColumn();
    var rng = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), lastCol);
    var letter = columnToLetter_(statusCol);
    var rules = LEADS_STATUS.map(function (st) {
      return cfRule_('=$' + letter + '2="' + st + '"', LEADS_COLORS[st] || '#ffffff', rng);
    });
    sheet.setConditionalFormatRules(rules);
  }

  // עמודת וואטסאפ (אם עוד אין)
  if (headers.indexOf('וואטסאפ') === -1) {
    var phoneCol = headers.indexOf('מס טלפון');
    if (phoneCol === -1) phoneCol = headers.indexOf('טלפון');
    if (phoneCol > -1) {
      var newCol = sheet.getLastColumn() + 1;
      sheet.getRange(1, newCol).setValue('וואטסאפ');
      sheet.getRange(2, newCol).setFormula(whatsappArrayFormula_(columnToLetter_(phoneCol + 1)));
    }
  }

  // בורר תאריך (לוח שנה) לעמודות התאריך
  var lastRow2 = Math.max(sheet.getMaxRows() - 1, 1);
  ['תאריך השארת פרטים', 'תאריך חזרה', 'תאריך לפולואפ'].forEach(function (h) {
    var c = headers.indexOf(h) + 1;
    if (c > 0) setDateValidation_(sheet, c, lastRow2);
  });
}

/* ----- טאב מתאמנים / ארכיון ----- */
function ensureTraineeSheet_(ss, name) {
  var created = false;
  var sheet = ss.getSheetByName(name);
  if (!sheet) { sheet = ss.insertSheet(name); created = true; }

  sheet.getRange(1, 1, 1, TRAINEE_HEADERS.length).setValues([TRAINEE_HEADERS])
    .setFontWeight('bold').setBackground('#3a3e26').setFontColor('#F1DC92');
  sheet.setFrozenRows(1);

  var lastRow = Math.max(sheet.getMaxRows() - 1, 1);
  var col = function (h) { return TRAINEE_HEADERS.indexOf(h) + 1; };

  setListValidation_(sheet, col('מסלול'), TRACKS, lastRow);
  setListValidation_(sheet, col('דרגה'), RANKS, lastRow);
  setListValidation_(sheet, col('סטטוס'), TRAINEE_STATUS, lastRow);

  // נוסחת וואטסאפ — רק כשהטאב ריק (כדי לא להתנגש עם נתונים קיימים)
  if (sheet.getLastRow() <= 1) {
    sheet.getRange(2, col('וואטסאפ')).setFormula(whatsappArrayFormula_(columnToLetter_(col('טלפון'))));
  }

  ['תאריך התחלה', 'תאריך סיום', 'תאריך קשר אחרון'].forEach(function (h) {
    sheet.getRange(2, col(h), lastRow, 1).setNumberFormat('dd/mm/yyyy');
    setDateValidation_(sheet, col(h), lastRow);
  });

  var letter = columnToLetter_(col('סטטוס'));
  var rng = sheet.getRange(2, 1, lastRow, TRAINEE_HEADERS.length);
  sheet.setConditionalFormatRules([
    cfRule_('=$' + letter + '2="פעיל/ה"', '#e7f0dd', rng),
    cfRule_('=$' + letter + '2="מוקפא"', '#dbe7f5', rng),
    cfRule_('=$' + letter + '2="סיים"', '#eeeeee', rng),
    cfRule_('=$' + letter + '2="המשיך לעוד מסלול"', '#fff2cc', rng)
  ]);
  return sheet;
}

/* ===== מייל שבועי ===== */
function sendWeeklyDigest() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var active = ss.getSheetByName(ACTIVE_SHEET);
  var leads = findLeadsSheet_(ss);
  var today = atMidnight_(new Date());

  var A = active ? sheetObjects_(active) : [];
  var L = leads ? sheetObjects_(leads) : [];

  var renew = A.filter(function (r) {
    if (t_(r['סטטוס']) === 'סיים') return false;
    var d = toDate_(r['תאריך סיום']); if (!d) return false;
    var diff = days_(today, d); return diff >= 0 && diff <= RENEW_DAYS;
  }).sort(function (a, b) { return toDate_(a['תאריך סיום']) - toDate_(b['תאריך סיום']); });

  var frozen = A.filter(function (r) { return t_(r['סטטוס']) === 'מוקפא'; });

  var quiet = A.filter(function (r) {
    if (t_(r['סטטוס']) === 'סיים') return false;
    var d = toDate_(r['תאריך קשר אחרון']); if (!d) return false;
    return days_(d, today) > QUIET_DAYS;
  });

  var followDue = L.filter(function (r) {
    var st = t_(r['סטטוס']); if (st === 'נסגר ✅' || st === 'לא רלוונטי') return false;
    var d = toDate_(r['תאריך לפולואפ']); if (!d) return false;
    return days_(d, today) >= 0;
  });

  var newWaiting = L.filter(function (r) {
    if (t_(r['סטטוס']) !== 'חדש') return false;
    var d = toDate_(r['תאריך השארת פרטים']); if (!d) return false;
    return days_(d, today) > NEWLEAD_DAYS;
  });

  var newCount = L.filter(function (r) {
    var d = toDate_(r['תאריך השארת פרטים']); if (!d) return false;
    var g = days_(d, today); return g >= 0 && g <= NEWLEADS_WINDOW;
  }).length;

  var html = '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222;max-width:640px">';
  html += '<h2 style="margin:0 0 4px;color:#3a3e26">📋 מרכז השליטה — סיכום שבועי</h2>';
  html += '<p style="margin:0 0 14px;color:#777">' + fmt_(today) + '</p>';
  html += '<div style="background:#eef3e6;border-radius:10px;padding:12px 14px;margin-bottom:16px;font-size:15px">📊 <b>לידים חדשים השבוע: ' + newCount + '</b></div>';

  html += section_('💳 חידושים מתקרבים (' + RENEW_DAYS + ' יום)', renew, function (r) {
    return line_(r['שם'], (r['דרגה'] || r['מסלול'] || '') + ' · מסתיים ' + fmt_(toDate_(r['תאריך סיום'])), r['טלפון']);
  });
  html += section_('❄️ מתאמנים בהקפאה', frozen, function (r) {
    return line_(r['שם'], r['דרגה'] || '', r['טלפון']);
  });
  html += section_('🔕 לא דיברת איתם מעל ' + QUIET_DAYS + ' ימים', quiet, function (r) {
    return line_(r['שם'], 'קשר אחרון ' + fmt_(toDate_(r['תאריך קשר אחרון'])), r['טלפון']);
  });
  html += section_('🎯 לידים לחזור אליהם', followDue, function (r) {
    return line_(r['שם מלא'], t_(r['סטטוס']), r['מס טלפון']);
  });
  html += section_('🆕 לידים חדשים שממתינים מעל ' + NEWLEAD_DAYS + ' ימים', newWaiting, function (r) {
    return line_(r['שם מלא'], r['המטרה שלי היא:'] || '', r['מס טלפון']);
  });

  if (!renew.length && !frozen.length && !quiet.length && !followDue.length && !newWaiting.length) {
    html += '<p style="background:#d9ead3;border-radius:10px;padding:12px 14px">אין פעולות דחופות השבוע 👍</p>';
  }
  html += '<hr style="border:none;border-top:1px solid #ddd;margin:18px 0"><p style="color:#999;font-size:12px">נשלח אוטומטית ממרכז השליטה שלך.</p></div>';

  MailApp.sendEmail({ to: CRM_EMAIL, subject: '📋 סיכום שבועי — מה דורש תשומת לב', htmlBody: html });
}

function section_(title, rows, lineFn) {
  if (!rows.length) return '';
  return '<h3 style="margin:16px 0 6px;color:#3a3e26">' + title + ' (' + rows.length + ')</h3>' +
    '<ul style="margin:0;padding-inline-start:18px">' + rows.map(lineFn).join('') + '</ul>';
}
function line_(name, extra, phone) {
  var wa = waLink_(phone);
  var waHtml = wa ? ' — <a href="' + wa + '">💬 וואטסאפ</a>' : '';
  return '<li style="margin-bottom:5px"><b>' + esc_(name) + '</b>' + (extra ? ' — ' + esc_(extra) : '') + waHtml + '</li>';
}

/* ===== ארכוב אוטומטי ===== */
function onEditCRM(e) {
  try {
    var sheet = e.range.getSheet();
    if (sheet.getName() !== ACTIVE_SHEET) return;
    var statusCol = TRAINEE_HEADERS.indexOf('סטטוס') + 1;
    if (e.range.getColumn() !== statusCol || e.range.getNumRows() !== 1) return;
    if (String(e.value).trim() !== 'סיים') return;
    moveRowToArchive_(sheet, e.range.getRow());
  } catch (err) {}
}
function moveRowToArchive_(sheet, row) {
  var ss = sheet.getParent();
  var archive = ss.getSheetByName(ARCHIVE_SHEET) || ss.insertSheet(ARCHIVE_SHEET);
  var vals = sheet.getRange(row, 1, 1, TRAINEE_HEADERS.length).getValues();
  archive.appendRow(vals[0]);
  sheet.deleteRow(row);
}
/* מיון טאב הפעילים לפי "תאריך סיום" (הקרוב לסיום למעלה) — בלי לשבור את נוסחת הוואטסאפ */
function sortActiveByEndDate() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ACTIVE_SHEET);
  if (!sheet || sheet.getLastRow() < 3) return;
  var col = function (h) { return TRAINEE_HEADERS.indexOf(h) + 1; };
  var last = sheet.getLastRow();
  var waCol = col('וואטסאפ');
  // מסירים זמנית את נוסחת המערך של הוואטסאפ (אחרת המיון שובר אותה)
  sheet.getRange(2, waCol, last - 1, 1).clearContent();
  // ממיינים את שאר הנתונים לפי תאריך סיום (עולה; ריקים יורדים למטה)
  sheet.getRange(2, 1, last - 1, TRAINEE_HEADERS.length).sort({ column: col('תאריך סיום'), ascending: true });
  // מחזירים את נוסחת הוואטסאפ — היא תחשב מחדש לפי הסדר החדש
  sheet.getRange(2, waCol).setFormula(whatsappArrayFormula_(columnToLetter_(col('טלפון'))));
}

function archiveFinishedNow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ACTIVE_SHEET);
  if (!sheet) return;
  var statusCol = TRAINEE_HEADERS.indexOf('סטטוס') + 1;
  var moved = 0;
  for (var r = sheet.getLastRow(); r >= 2; r--) {
    if (String(sheet.getRange(r, statusCol).getValue()).trim() === 'סיים') { moveRowToArchive_(sheet, r); moved++; }
  }
  SpreadsheetApp.getUi().alert('הועברו לארכיון: ' + moved + ' מתאמנים.');
}

function installTriggers_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('onEditCRM') === -1) ScriptApp.newTrigger('onEditCRM').forSpreadsheet(ss).onEdit().create();
  if (have.indexOf('sendWeeklyDigest') === -1)
    ScriptApp.newTrigger('sendWeeklyDigest').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(9).create();
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
  return ss.getSheets()[0];
}
function sheetObjects_(sheet) {
  var vals = sheet.getDataRange().getValues();
  if (vals.length < 2) return [];
  var hdr = vals[0].map(function (h) { return String(h).trim(); });
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    if (vals[i].every(function (c) { return c === '' || c === null; })) continue;
    var o = {};
    for (var j = 0; j < hdr.length; j++) o[hdr[j]] = vals[i][j];
    out.push(o);
  }
  return out;
}
function t_(v) { return String(v == null ? '' : v).trim(); }
function atMidnight_(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function days_(a, b) { return Math.round((atMidnight_(b) - atMidnight_(a)) / 86400000); }
function toDate_(v) {
  if (v instanceof Date && !isNaN(v)) return atMidnight_(v);
  var s = t_(v); if (!s) return null;
  var m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (!m) return null;
  var dd = +m[1], mm = +m[2], yy = +m[3]; if (yy < 100) yy += 2000;
  var d = new Date(yy, mm - 1, dd);
  return isNaN(d) ? null : atMidnight_(d);
}
function fmt_(d) { return d ? (d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear()) : ''; }
function waLink_(phone) {
  var p = t_(phone); if (!p) return '';
  p = p.replace(/\D/g, ''); if (!p) return '';
  if (p.charAt(0) === '0') p = p.substring(1);
  return 'https://wa.me/972' + p;
}
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
function setListValidation_(sheet, col, values, numRows) {
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build();
  sheet.getRange(2, col, numRows, 1).setDataValidation(rule);
}
function setDateValidation_(sheet, col, numRows) {
  var rule = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true).build();
  sheet.getRange(2, col, numRows, 1).setDataValidation(rule);
}
function cfRule_(formula, color, range) {
  return SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setBackground(color).setRanges([range]).build();
}
function whatsappArrayFormula_(p) {
  return '=ARRAYFORMULA(IF(' + p + '2:' + p + '="","",' +
    'HYPERLINK("https://wa.me/972"&IF(LEFT(TRIM(""&' + p + '2:' + p + '),1)="0",' +
    'MID(TRIM(""&' + p + '2:' + p + '),2,15),TRIM(""&' + p + '2:' + p + ')),"💬 וואטסאפ")))';
}
function columnToLetter_(col) {
  var s = ''; while (col > 0) { var m = (col - 1) % 26; s = String.fromCharCode(65 + m) + s; col = Math.floor((col - m) / 26); } return s;
}
