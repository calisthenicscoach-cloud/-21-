/**
 * Matan Kopel — קליטת טפסים.
 * מטפל בשני סוגי טפסים:
 *   • חתימות (הצהרת בריאות + תקנון + שאלון פתיחה)  ← index.html
 *   • שאלון תזונה                                   ← tzuna.html
 *
 * הקמה (פעם אחת) — ראה/י apps-script/README.md:
 *   1. תיקייה בדרייב → FOLDER_ID.  2. Google Sheet → SHEET_ID.
 *   3. (רשות) מיילים ל-NOTIFY_EMAIL / NUTRITION_EMAIL.
 *   4. Deploy ▸ New deployment ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone.
 *   5. את כתובת ה-Web App מדביקים ב-index.html וב-tzuna.html ב-DRIVE_ENDPOINT.
 *
 * ⚠️ יש קובץ Code.local.gs עם ה-IDs והמיילים כבר בפנים — השתמש/י בו לעדכונים.
 */

const FOLDER_ID = 'PASTE_DRIVE_FOLDER_ID_HERE';   // ה-ID של התיקייה בדרייב
const SHEET_ID  = 'PASTE_SPREADSHEET_ID_HERE';    // ה-ID של ה-Google Sheet (ריק = בלי טבלה)
const NOTIFY_EMAIL    = '';                        // מייל המאמן (ריק = בלי מייל)
const NUTRITION_EMAIL = '';                        // מייל יועץ התזונה (ריק = בלי מייל)

const SIGN_SUBFOLDER      = 'תקנונים ושאלוני פתיחה חתומים';
const PHOTO_SUBFOLDER     = 'תמונות לפני';
const NUTRITION_SUBFOLDER = 'שאלוני תזונה';
const NUTRITION_SHEET     = 'תפריט תזונה';

/* ── פתיחת מתאמן אוטומטית ב-CRM בכל חתימה ── */
const CRM_SHEET_ID      = 'PASTE_CRM_SHEET_ID';   // ה-ID של גיליון הלידים/CRM (מה-URL שלו, בין /d/ ל-/edit)
const CRM_ACTIVE_SHEET  = 'מתאמנים פעילים';       // טאב המתאמנים הפעילים
const CRM_ARCHIVE_SHEET = 'ארכיון מתאמנים';       // טאב הארכיון
const CRM_LEADS_SHEET   = 'לידים';               // טאב הלידים — לסימון "נסגר ✅" אוטומטי בחתימה
// מיפוי שם המסלול (מהטופס) → [שם המסלול ב-CRM, מחיר חודשי, מספר חודשים למסלול]
const CRM_TRACK_MAP = {
  'חודש ניסיון':        ['חודש ניסיון',  500, 1],
  'מסלול 3 חודשים':     ['3 חודשים',     450, 3],
  'מסלול 8 חודשים':     ['8 חודשים',     350, 8],
  'מסלול ללא התחייבות': ['ללא התחייבות', 500, 0]   // 0 = בלי תאריך סיום
};

/* ── ערכת פתיחה + יצירת תפריט אוטומטית ── */
const KIT_BASE_URL     = 'https://matankopel.pages.dev/kit.html';   // דף ערכת הפתיחה
const MENU_TEMPLATE_ID = 'PASTE_MENU_TEMPLATE_ID';                  // ID של תבנית שיטס התפריט (מעתיקים ממנה)
const MENU_FOLDER_ID   = 'PASTE_MENU_FOLDER_ID';                    // ID של התיקייה המשותפת עם היועץ
const MENU_LINKS_SHEET = 'קישורי תפריט';                            // לשונית מיפוי טלפון→תפריט (בגיליון החתימות)
const MENU_RATE        = 150;                                      // תשלום ליועץ התזונה לכל תפריט (₪)

// ההודעה שנשלחת עם ערכת הפתיחה (בכפתור "שלח למתאמן")
const KIT_MESSAGE =
  'ברוך הבא ליחידת הקליסטניקס!\n' +
  'המסע שלך מתחיל עכשיו — מטירון ועד בוגר היחידה.\n' +
  '\n' +
  'כל ערכת הפתיחה שלך מרוכזת בדף אחד קבוע:\n' +
  '*1.* פתח את הדף:\n' +
  '{{KIT_LINK}}\n' +
  '*2.* בדף לחץ *"הוסף למסך הבית"* (10 שניות) — וכל הכלים שלך תמיד בקליק, בלי לחפש בהודעות.\n' +
  '\n' +
  'בפנים מחכים לך: סרטון פתיחה (חובה לצפייה), קבוצת היחידה, קורס תזונה ומאגר התוכן.\n' +
  '\n' +
  'יאללה, יוצאים לדרך!';

function doPost(e) {
  try {
    const raw = (e && e.parameter && e.parameter.payload) ? e.parameter.payload
              : (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const d = JSON.parse(raw);
    return (d.type === 'nutrition') ? handleNutrition(d) : handleSignature(d);
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/* ============ חתימות (הצהרת בריאות + תקנון) ============ */
function handleSignature(d) {
  // אישור קליטה מוקדם (לאימות מסירה) — ברגע שהמטען המלא הגיע לשרת ונקרא בהצלחה
  try { if (d.sid) CacheService.getScriptCache().put(String(d.sid), '1', 900); } catch (e) {}

  const root = DriveApp.getFolderById(FOLDER_ID);

  const folder = getOrCreateSubfolder(root, SIGN_SUBFOLDER);
  const blob = Utilities.newBlob(Utilities.base64Decode(d.pdfBase64), 'application/pdf', (d.filename || 'signed') + '.pdf');
  const file = folder.createFile(blob);
  file.setDescription('חתימה דיגיטלית — ' + (d.name || '') + ' — ' + (d.track || ''));

  let photoUrl = '';
  if (d.photoBase64) {
    const pf = getOrCreateSubfolder(root, PHOTO_SUBFOLDER);
    const pblob = Utilities.newBlob(Utilities.base64Decode(d.photoBase64), 'image/jpeg', (d.photoFilename || 'תמונת לפני') + '.jpg');
    photoUrl = pf.createFile(pblob).getUrl();
  }

  // התאמה לפי שם-עמודה: שאלות חדשות נוספות כעמודות חדשות בסוף — בלי להזיז שורות קיימות.
  if (SHEET_ID) {
    const sheet  = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
    const intake = Array.isArray(d.intake) ? d.intake : [];
    const baseHead = ['תאריך ושעה', 'שם', 'ת"ז', 'מסלול', 'תאריך לידה',
                      'טלפון', 'מייל', 'כתובת', 'קטין / הורה', 'דגלי בריאות', 'קישור למסמך'];
    const docCell   = '=HYPERLINK("' + file.getUrl() + '","פתח מסמך")';
    const photoCell = photoUrl ? ('=HYPERLINK("' + photoUrl + '","פתח תמונה")') : '';
    const baseVals = [
      d.time || new Date(), d.name, d.id, d.track, d.dob, d.phone, d.email, d.addr,
      d.minor ? ('קטין — ' + d.pname + ' (ת"ז ' + d.pid + ')') : '',
      d.flagged ? ('כן ×' + d.flagged) : 'הכל שלילי', docCell
    ];
    // ערך לכל עמודה לפי שם הכותרת
    const valByCol = {};
    for (let i = 0; i < baseHead.length; i++) valByCol[baseHead[i]] = baseVals[i];
    intake.forEach(function (x) { valByCol[x.q] = x.a; });
    valByCol['תמונת "לפני"'] = photoCell;
    valByCol['הערות לקוח'] = d.notes || '';

    const desiredHead = baseHead.concat(intake.map(function (x) { return x.q; })).concat(['תמונת "לפני"', 'הערות לקוח']);

    // כותרת קיימת בגיליון
    let header = [];
    if (sheet.getLastRow() >= 1 && sheet.getLastColumn() >= 1) {
      header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(function (h) { return String(h); });
    }
    if (!header.length || header.join('') === '') {
      header = desiredHead.slice();
      sheet.getRange(1, 1, 1, header.length).setValues([header]);
    } else {
      // מוסיפים בסוף רק עמודות שעדיין לא קיימות (שאלות חדשות) — בלי להזיז נתונים ישנים
      const missing = desiredHead.filter(function (h) { return header.indexOf(h) === -1; });
      if (missing.length) {
        sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
        header = header.concat(missing);
      }
    }
    // בונים שורה בהתאמה מדויקת לכותרת (לפי שם עמודה)
    const row = header.map(function (h) { return Object.prototype.hasOwnProperty.call(valByCol, h) ? valByCol[h] : ''; });
    sheet.appendRow(row);
  }

  // 4) פתיחת מתאמן חדש ב-CRM ("מתאמנים פעילים") + סימון הליד כ-"נסגר ✅" — אוטומטית
  addTraineeToCRM_(d);
  markLeadClosed_(d);

  sendNotification(d, file, photoUrl);
  return json({ ok: true, url: file.getUrl(), photoUrl: photoUrl });
}

/* מפתח טלפון אחיד להשוואה — מסיר תווים לא-ספרתיים, קידומת 972, ואפס מוביל.
   כך "0587979678" = "587979678" = "972-58-797-9678" (הלידים שמורים בלי האפס המוביל). */
function phoneKey_(p) {
  let s = String(p == null ? '' : p).replace(/\D/g, '');
  if (s.indexOf('972') === 0) s = s.slice(3);
  if (s.charAt(0) === '0') s = s.slice(1);
  return s;
}

/* עטיפה בטוחה — אם ה-CRM נכשל, החתימה עדיין נשמרת (לא מפילים את הטופס). */
function addTraineeToCRM_(d) {
  try { addTraineeToCRMCore_(d); }
  catch (err) { /* מתעלמים בכוונה — עדיף חתימה בלי CRM מאשר חתימה שנכשלה */ }
}

/* הלוגיקה עצמה — פותחת שורת מתאמן חדשה בטאב "מתאמנים פעילים". זורקת שגיאות (כדי ש-testCRM יראה אותן). */
function addTraineeToCRMCore_(d) {
  if (!CRM_SHEET_ID || CRM_SHEET_ID.indexOf('PASTE_') === 0) return;
  const sheet = SpreadsheetApp.openById(CRM_SHEET_ID).getSheetByName(CRM_ACTIVE_SHEET);
  if (!sheet) throw new Error('לא נמצא טאב בשם "' + CRM_ACTIVE_SHEET + '" בגיליון ה-CRM');

  const phone = d.phone || '';

  // קוראים את עמודות "שם" (A) ו"טלפון" (I) בלבד — כדי לא להיות תלויים ב-getLastRow,
  // שמנופח כאן כי נוסחת המערך של הוואטסאפ "תופסת" את כל עמודת J עד תחתית הגיליון.
  const maxR   = sheet.getMaxRows();
  const names  = sheet.getRange(1, 1, maxR, 1).getValues();   // A = שם
  const phones = sheet.getRange(1, 9, maxR, 1).getValues();   // I = טלפון

  // דדופ לפי טלפון (התאמה אחידה שמתעלמת מאפס מוביל / קידומת 972)
  const pk = phoneKey_(phone);
  if (pk) {
    for (let r = 2; r <= maxR; r++) if (phoneKey_(phones[r - 1][0]) === pk) return;
  }

  // שורת יעד = השורה הריקה הראשונה (שם+טלפון ריקים) מ-2 והלאה — כך זה נכנס מיד אחרי המתאמן האחרון
  let target = maxR + 1;
  for (let r = 2; r <= maxR; r++) {
    if (String(names[r - 1][0]).trim() === '' && String(phones[r - 1][0]).trim() === '') { target = r; break; }
  }

  const map    = CRM_TRACK_MAP[d.track] || [d.track || '', '', 0];
  const track  = map[0], price = map[1], months = map[2];
  // d.time הוא טקסט עברי שלא ניתן לפרסור — משתמשים ב-d.ts (ISO), ואם אין, בזמן הנוכחי
  const start  = (d.ts && !isNaN(new Date(d.ts).getTime())) ? new Date(d.ts) : new Date();
  let end = '';
  if (months > 0) { end = new Date(start); end.setMonth(end.getMonth() + months); }

  // סדר עמודות: שם, מסלול, דרגה, סטטוס, תאריך התחלה, תאריך סיום, תאריך קשר אחרון, מחיר חודשי, טלפון
  // עמודה 10 (וואטסאפ) נשארת ריקה — נוסחת המערך תמלא אותה לבד. עמודה 11 (הערות) ריקה.
  sheet.getRange(target, 1, 1, 9).setValues([[
    d.name || '', track, 'טירון שלב א', 'פעיל/ה', start, end, start, price, phone
  ]]);
  sheet.getRange(target, 5, 1, 3).setNumberFormat('dd/mm/yyyy');    // 3 עמודות התאריך
}

/* עטיפה בטוחה — מסמן את הליד שחתם כ-"נסגר ✅" בטאב הלידים. לא מפיל את החתימה אם משהו משתבש. */
function markLeadClosed_(d) {
  try { markLeadClosedCore_(d); }
  catch (err) { /* מתעלמים בכוונה */ }
}

/* מוצא את הליד לפי טלפון ומסמן את עמודת "סטטוס" שלו כ-"נסגר ✅". זורק שגיאות (כדי ש-testCRM יראה אותן). */
function markLeadClosedCore_(d) {
  if (!CRM_SHEET_ID || CRM_SHEET_ID.indexOf('PASTE_') === 0) return;
  const pk = phoneKey_(d.phone);
  if (!pk) return;
  const sheet = crmLeadsSheet_(SpreadsheetApp.openById(CRM_SHEET_ID));
  if (!sheet) return;
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  const header = values[0].map(function (h) { return String(h).trim(); });
  let phoneCol = header.indexOf('מס טלפון');
  if (phoneCol === -1) phoneCol = header.indexOf('טלפון');
  const statusCol = header.indexOf('סטטוס');
  if (phoneCol === -1 || statusCol === -1) return;
  for (let r = 1; r < values.length; r++) {
    if (phoneKey_(values[r][phoneCol]) === pk) sheet.getRange(r + 1, statusCol + 1).setValue('נסגר ✅');
  }
}

/* מאתר את טאב הלידים — לפי השם "לידים", ואם לא, לפי כותרות (סטטוס + טלפון/שם מלא). */
function crmLeadsSheet_(ss) {
  const byName = ss.getSheetByName(CRM_LEADS_SHEET);
  if (byName) return byName;
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const nm = sheets[i].getName();
    if (nm === CRM_ACTIVE_SHEET || nm === CRM_ARCHIVE_SHEET) continue;
    const lc = sheets[i].getLastColumn();
    if (lc < 1) continue;
    const hdr = sheets[i].getRange(1, 1, 1, lc).getValues()[0].map(function (h) { return String(h).trim(); });
    if (hdr.indexOf('סטטוס') > -1 && (hdr.indexOf('מס טלפון') > -1 || hdr.indexOf('טלפון') > -1 || hdr.indexOf('שם מלא') > -1)) return sheets[i];
  }
  return null;
}

/* 🔎 בדיקה ידנית — בעורך בוחרים "testCRM" בבורר הפונקציות ולוחצים "הפעלה".
   מנקה שורות בדיקה קודמות ("בדיקה טסט") מכל מקום בטאב, ואז מוסיפה שורה טרייה במקום הנכון. */
function testCRM() {
  const ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  const sheet = ss.getSheetByName(CRM_ACTIVE_SHEET);
  console.log('✓ הגיליון: ' + ss.getName() + ' | טאבים: ' + ss.getSheets().map(function (s) { return '"' + s.getName() + '"'; }).join(', '));
  const leads = crmLeadsSheet_(ss);
  console.log(leads ? ('✓ טאב לידים לסימון "נסגר ✅": "' + leads.getName() + '"') : '✗ לא נמצא טאב לידים');
  if (leads) {
    const hv = leads.getRange(1, 1, 1, leads.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    let pc = hv.indexOf('מס טלפון'); if (pc === -1) pc = hv.indexOf('טלפון');
    const sc = hv.indexOf('סטטוס');
    console.log('בלידים: עמודת טלפון = ' + (pc > -1 ? ('#' + (pc + 1)) : '✗ לא נמצא!') + ' | עמודת סטטוס = ' + (sc > -1 ? ('#' + (sc + 1)) : '✗ לא נמצא!'));
  }
  // ניקוי שורות "בדיקה טסט" ישנות (כולל כאלה שנפלו בתחתית)
  const maxR = sheet.getMaxRows();
  const names = sheet.getRange(1, 1, maxR, 1).getValues();
  let removed = 0;
  for (let r = maxR; r >= 2; r--) if (String(names[r - 1][0]).trim() === 'בדיקה טסט') { sheet.deleteRow(r); removed++; }
  if (removed) console.log('ניקיתי ' + removed + ' שורות בדיקה ישנות');
  addTraineeToCRMCore_({ name: 'בדיקה טסט', phone: '0509999999', track: 'מסלול 3 חודשים', time: new Date() });
  console.log('✓ נוספה שורת "בדיקה טסט" — עכשיו היא ליד שאר המתאמנים למעלה (אפשר למחוק אחרי).');
}

/* ============ שאלון תזונה ============ */
function handleNutrition(d) {
  const root   = DriveApp.getFolderById(FOLDER_ID);
  const folder = getOrCreateSubfolder(root, NUTRITION_SUBFOLDER);
  const answers = Array.isArray(d.answers) ? d.answers : [];

  const blob = Utilities.newBlob(Utilities.base64Decode(d.pdfBase64), 'application/pdf', (d.filename || 'שאלון תזונה') + '.pdf');
  const file = blob ? folder.createFile(blob) : null;
  if (file) file.setDescription('שאלון תזונה — ' + (d.name || ''));

  let photoUrl = '';
  if (d.photoBase64) {
    const pblob = Utilities.newBlob(Utilities.base64Decode(d.photoBase64), 'image/jpeg', (d.photoFilename || 'תמונת גוף') + '.jpg');
    photoUrl = folder.createFile(pblob).getUrl();
  }

  if (SHEET_ID) {
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(NUTRITION_SHEET) || ss.insertSheet(NUTRITION_SHEET);
    const head = ['תאריך ושעה'].concat(answers.map(function (x) { return x.q; })).concat(['תמונת גוף', 'קישור ל-PDF']);
    if (sheet.getLastRow() === 0 || sheet.getLastColumn() < head.length) {
      sheet.getRange(1, 1, 1, head.length).setValues([head]);
    }
    const photoCell = photoUrl ? ('=HYPERLINK("' + photoUrl + '","פתח תמונה")') : '';
    const docCell   = file ? ('=HYPERLINK("' + file.getUrl() + '","פתח PDF")') : '';
    const row = [d.time || new Date()].concat(answers.map(function (x) { return x.a; })).concat([photoCell, docCell]);
    sheet.appendRow(row);
  }

  // 4) יצירת עותק תפריט אוטומטי בתיקייה המשותפת + שמירת הקישור למתאמן (לפי טלפון)
  const menuUrl = createMenuForTrainee_(d);

  sendNutritionEmail(d, file, photoUrl, answers, menuUrl);
  return json({ ok: true, url: file ? file.getUrl() : '', photoUrl: photoUrl, menuUrl: menuUrl });
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  // אימות מסירת חתימה: ?confirm=<sid> → האם החתימה נקלטה ונשמרה
  if (p.confirm) {
    let found = false;
    try { found = !!CacheService.getScriptCache().get(String(p.confirm)); } catch (er) {}
    const out = JSON.stringify({ found: found });
    return p.callback
      ? ContentService.createTextOutput(p.callback + '(' + out + ')').setMimeType(ContentService.MimeType.JAVASCRIPT)
      : ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
  }
  // API לדף ערכת הפתיחה: ?kit=<טלפון> → מחזיר את קישור התפריט (אם כבר קיים)
  if (p.kit) {
    const out = JSON.stringify({ menu: lookupMenu_(p.kit) });
    return p.callback
      ? ContentService.createTextOutput(p.callback + '(' + out + ')').setMimeType(ContentService.MimeType.JAVASCRIPT)
      : ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
  }
  return json({ ok: true, msg: 'Matan Kopel endpoint is live' });
}

/* ====== ערכת פתיחה + תפריט אוטומטי ====== */
function waIntl_(phone) { const k = phoneKey_(phone); return k ? ('972' + k) : ''; }

function kitUrl_(phone, name) {
  return KIT_BASE_URL + '?id=' + encodeURIComponent(phoneKey_(phone)) + '&name=' + encodeURIComponent(name || '');
}

/* יוצר עותק של תבנית התפריט בתיקייה המשותפת, משתף לעריכה, ושומר מיפוי טלפון→תפריט. מחזיר את הקישור. */
function createMenuForTrainee_(d) {
  try {
    if (!MENU_TEMPLATE_ID || MENU_TEMPLATE_ID.indexOf('PASTE_') === 0) return '';
    const name = String(d.name || 'מתאמן').trim();
    const folder = DriveApp.getFolderById(MENU_FOLDER_ID);
    const copy = DriveApp.getFileById(MENU_TEMPLATE_ID).makeCopy('תפריט תזונה - ' + name, folder);
    try { copy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.EDIT); } catch (e) {}
    // כותבים את שם המתאמן בתא שליד "שם לקוח" בתוך השיטס
    try {
      const ss = SpreadsheetApp.openById(copy.getId());
      const cell = ss.createTextFinder('שם לקוח').findNext();
      if (cell) cell.getSheet().getRange(cell.getRow(), cell.getColumn() + 1).setValue(name);
    } catch (e) {}
    const url = copy.getUrl();
    storeMenuLink_(d.phone, name, url);
    return url;
  } catch (err) { return ''; }
}

/* שומר שורה בלשונית "קישורי תפריט" (בגיליון החתימות): טלפון(מנורמל) | שם | קישור | תאריך */
function storeMenuLink_(phone, name, url) {
  try {
    if (!SHEET_ID) return;
    const ss = SpreadsheetApp.openById(SHEET_ID);
    let sheet = ss.getSheetByName(MENU_LINKS_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(MENU_LINKS_SHEET);
      sheet.getRange(1, 1, 1, 4).setValues([['טלפון', 'שם', 'קישור תפריט', 'תאריך']]);
    }
    sheet.appendRow([phoneKey_(phone), name, url, new Date()]);
  } catch (err) {}
}

/* מחפש קישור תפריט לפי טלפון (החדש ביותר גובר). ריק אם אין. */
function lookupMenu_(phone) {
  try {
    const key = phoneKey_(phone);
    if (!key || !SHEET_ID) return '';
    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = ss.getSheetByName(MENU_LINKS_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return '';
    const vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 3).getValues();
    let url = '';
    for (let i = 0; i < vals.length; i++) {
      if (phoneKey_(vals[i][0]) === key && vals[i][2]) url = String(vals[i][2]);
    }
    return url;
  } catch (err) { return ''; }
}

/* ============ עוזרים ============ */
function getOrCreateSubfolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function sendNotification(d, file, photoUrl) {
  if (!NOTIFY_EMAIL) return;
  try {
    const rows = [
      ['שם', d.name], ['מסלול', d.track], ['ת"ז', d.id], ['טלפון', d.phone],
      ['מייל', d.email], ['כתובת', d.addr], ['תאריך לידה', d.dob]
    ];
    if (d.minor) rows.push(['קטין — הורה/אפוטרופוס', (d.pname || '') + ' (ת"ז ' + (d.pid || '') + ')']);
    rows.push(['שאלון בריאות', d.flagged ? ('סימן/ה "כן" ב-' + d.flagged + ' שאלות') : 'הכל שלילי']);
    if (d.notes) rows.push(['הערות לקוח', d.notes]);
    const details = rows.map(function (r) { return '<b>' + r[0] + ':</b> ' + esc(r[1]); }).join('<br>');

    let intake = '';
    if (Array.isArray(d.intake) && d.intake.length) {
      intake = '<h3 style="margin:16px 0 6px">שאלון פתיחה</h3>' +
        d.intake.filter(function (x) { return x.a; }).map(function (x) {
          return '<div style="margin-bottom:8px"><b>' + esc(x.q) + '</b><br>' + esc(x.a) + '</div>';
        }).join('');
    }
    let links = '<p style="margin-top:16px">📄 <a href="' + file.getUrl() + '">פתח את המסמך החתום (PDF)</a>';
    if (photoUrl) links += '<br>🖼️ <a href="' + photoUrl + '">פתח את תמונת ה"לפני"</a>';
    links += '</p>';

    // כפתור "שלח ערכת פתיחה למתאמן" — וואטסאפ עם ההודעה + הקישור האישי מוכנים
    let sendBtn = '';
    const waNum = waIntl_(d.phone);
    if (waNum) {
      const waText = encodeURIComponent(KIT_MESSAGE.replace('{{KIT_LINK}}', kitUrl_(d.phone, d.name)));
      sendBtn =
        '<div style="margin:18px 0">' +
        '<a href="https://wa.me/' + waNum + '?text=' + waText + '" ' +
        'style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;font-weight:bold;padding:13px 24px;border-radius:8px;font-size:15px">📤 שלח ערכת פתיחה למתאמן</a>' +
        '<div style="color:#888;font-size:12px;margin-top:6px">לחיצה תפתח וואטסאפ עם ההודעה והקישור האישי מוכנים לשליחה.</div></div>';
    }

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: '✍️ טופס חתום חדש — ' + (d.name || '') + ' (' + (d.track || '') + ')',
      htmlBody: '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
        '<h2 style="margin:0 0 12px;color:#2e7d32">✅ טופס חתום חדש התקבל</h2>' + details + intake + sendBtn + links +
        '<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">' +
        '<p style="color:#999;font-size:12px">נשלח אוטומטית ממערכת החתימות שלך.</p></div>',
      attachments: [file.getAs('application/pdf')]
    });
  } catch (err) { /* לא מפילים את הבקשה אם המייל נכשל */ }
}

function sendNutritionEmail(d, file, photoUrl, answers, menuUrl) {
  if (!NUTRITION_EMAIL) return;
  try {
    const qa = (answers || []).filter(function (x) { return x.a; }).map(function (x) {
      return '<div style="margin-bottom:9px"><b>' + esc(x.q) + '</b><br>' + esc(x.a) + '</div>';
    }).join('');
    let menuBtn = '';
    if (menuUrl) {
      menuBtn =
        '<div style="margin:4px 0 16px">' +
        '<a href="' + menuUrl + '" style="display:inline-block;background:#2e7d32;color:#fff;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px">🍽️ פתח את שיטס התפריט (מוכן למילוי)</a>' +
        '<div style="color:#888;font-size:12px;margin-top:6px">שיטס אישי נוצר אוטומטית עם שם המתאמן, בתיקייה המשותפת — פשוט למלא את התפריט.</div></div>';
    }
    let links = '';
    if (file) links += '<p style="margin-top:14px">📄 <a href="' + file.getUrl() + '">פתח את השאלון (PDF)</a>';
    if (photoUrl) links += (links ? '<br>' : '<p style="margin-top:14px">') + '🖼️ <a href="' + photoUrl + '">פתח תמונת גוף</a>';
    if (links) links += '</p>';

    const opts = {
      to: NUTRITION_EMAIL,
      subject: '🥗 שאלון תזונה חדש — ' + (d.name || ''),
      htmlBody: '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
        '<h2 style="margin:0 0 4px;color:#2e7d32">🥗 שאלון תזונה חדש</h2>' +
        '<p style="margin:0 0 14px;color:#555">מתאמן: <b>' + esc(d.name || '') + '</b></p>' +
        menuBtn + qa + links +
        '<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">' +
        '<p style="color:#999;font-size:12px">נשלח אוטומטית משאלון התזונה של יחידת הקליסטניקס.</p></div>'
    };
    if (NOTIFY_EMAIL) opts.cc = NOTIFY_EMAIL;
    if (file) opts.attachments = [file.getAs('application/pdf')];
    MailApp.sendEmail(opts);
  } catch (err) { /* לא מפילים את הבקשה אם המייל נכשל */ }
}

/* ====== סיכום חודשי לתשלום ליועץ התזונה ====== */
/* הרץ פעם אחת מהעורך (בורר הפונקציות ▸ installMenuBillingTrigger ▸ Run) — מפעיל מייל חודשי ב-1 לחודש, 09:00. */
function installMenuBillingTrigger() {
  const have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('sendMenuBillingSummary') === -1) {
    ScriptApp.newTrigger('sendMenuBillingSummary').timeBased().onMonthDay(1).atHour(9).create();
  }
  return 'טריגר חודשי הופעל ✓';
}

/* סופר את התפריטים שנוצרו בחודש שעבר (לשונית "קישורי תפריט") ושולח סיכום לתשלום ל-NOTIFY_EMAIL. */
function sendMenuBillingSummary() {
  if (!NOTIFY_EMAIL || !SHEET_ID) return;
  const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  const now = new Date();
  const lm = (now.getMonth() === 0) ? 11 : now.getMonth() - 1;
  const ly = (now.getMonth() === 0) ? now.getFullYear() - 1 : now.getFullYear();

  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(MENU_LINKS_SHEET);
  const names = [];
  if (sheet && sheet.getLastRow() >= 2) {
    const vals = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();  // טלפון, שם, קישור, תאריך
    vals.forEach(function (r) {
      let d = r[3];
      if (!(d instanceof Date)) d = d ? new Date(d) : null;
      if (d && !isNaN(d) && d.getMonth() === lm && d.getFullYear() === ly) names.push(r[1] || '(ללא שם)');
    });
  }
  const count = names.length;
  const total = count * MENU_RATE;
  const list = count
    ? ('<ol style="margin:6px 0;padding-inline-start:22px">' + names.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ol>')
    : '<p style="color:#777">לא הוכנו תפריטים בחודש שעבר.</p>';

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    // "תשלום עובד" = תגית קבועה לכל מיילי התשלום לעובדים (לסינון אוטומטי בתווית ב-Gmail)
    subject: '🧾 תשלום עובד — יועץ תזונה — ' + months[lm] + ' ' + ly + ' (' + count + ' תפריטים)',
    htmlBody: '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
      '<h2 style="margin:0 0 10px;color:#2e7d32">🧾 סיכום תפריטים לתשלום — ' + months[lm] + ' ' + ly + '</h2>' +
      '<p style="font-size:16px"><b>כמות תפריטים:</b> ' + count + '<br>' +
      '<b>לתשלום:</b> ' + count + ' × ' + MENU_RATE + ' ₪ = <b style="color:#2e7d32">' + total + ' ₪</b></p>' +
      '<h3 style="margin:14px 0 4px">המתאמנים:</h3>' + list +
      '<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">' +
      '<p style="color:#999;font-size:12px">נשלח אוטומטית בכל 1 לחודש. הספירה לפי תאריך יצירת התפריט (לשונית "קישורי תפריט").</p></div>'
  });
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
  });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
