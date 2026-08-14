/**
 * ⭐ זו הגרסה המוכנה של Matan Kopel — עם ה-IDs והמיילים שלך כבר בפנים.
 *
 * מטפל בשני סוגי טפסים:
 *   • חתימות (הצהרת בריאות + תקנון + שאלון פתיחה)  ← index.html
 *   • שאלון תזונה                                   ← tzuna.html
 *
 * בכל עדכון: מעתיקים את כל הקובץ הזה, מדביקים ב-script.google.com, שומרים, ואז:
 *   Deploy ▸ Manage deployments ▸ ✏️ ▸ Version: New version ▸ Deploy.
 */

const FOLDER_ID = '1mCW8AzwDwcTyvB5ekYaW28psE2Nxyyf_';                 // התיקייה הראשית בדרייב
const SHEET_ID  = '17I2u_BcgOpN9tuHTah2ZKdDuw_hM6GJHnKy5ZghzhG4';     // ה-Google Sheet
const NOTIFY_EMAIL    = 'calisthenics.coach@matankopel.co.il';       // המאמן — מקבל התראה בכל חתימה + עותק משאלוני תזונה
const NUTRITION_EMAIL = 'dorbarpt@gmail.com';                        // יועץ התזונה — מקבל את שאלוני התזונה

/* שמות תיקיות המשנה והגיליון — לשמירה מסודרת */
const SIGN_SUBFOLDER      = 'תקנונים ושאלוני פתיחה חתומים';   // ה-PDF-ים החתומים
const PHOTO_SUBFOLDER     = 'תמונות לפני';                    // תמונות ה"לפני" משאלון הכניסה
const NUTRITION_SUBFOLDER = 'שאלוני תזונה';                   // PDF + תמונת גוף משאלון התזונה
const NUTRITION_SHEET     = 'תפריט תזונה';                    // לשונית (גיליון) נפרד/ת לשאלוני התזונה

/* ── פתיחת מתאמן אוטומטית ב-CRM בכל חתימה ── */
const CRM_SHEET_ID     = 'PASTE_CRM_SHEET_ID';   // ה-ID של גיליון הלידים/CRM (מה-URL שלו, בין /d/ ל-/edit)
const CRM_ACTIVE_SHEET = 'מתאמנים פעילים';        // שם הטאב של המתאמנים הפעילים
// מיפוי שם המסלול (מהטופס) → [שם המסלול ב-CRM, מחיר חודשי, מספר חודשים למסלול]
const CRM_TRACK_MAP = {
  'חודש ניסיון':        ['חודש ניסיון',  500, 1],
  'מסלול 3 חודשים':     ['3 חודשים',     450, 3],
  'מסלול 8 חודשים':     ['8 חודשים',     350, 8],
  'מסלול ללא התחייבות': ['ללא התחייבות', 500, 0]   // 0 = בלי תאריך סיום
};

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
  const root = DriveApp.getFolderById(FOLDER_ID);

  // 1) ה-PDF החתום → תיקיית משנה מסודרת
  const folder = getOrCreateSubfolder(root, SIGN_SUBFOLDER);
  const blob = Utilities.newBlob(Utilities.base64Decode(d.pdfBase64), 'application/pdf', (d.filename || 'signed') + '.pdf');
  const file = folder.createFile(blob);
  file.setDescription('חתימה דיגיטלית — ' + (d.name || '') + ' — ' + (d.track || ''));

  // 2) תמונת ה"לפני" → תיקיית "תמונות לפני"
  let photoUrl = '';
  if (d.photoBase64) {
    const pf = getOrCreateSubfolder(root, PHOTO_SUBFOLDER);
    const pblob = Utilities.newBlob(Utilities.base64Decode(d.photoBase64), 'image/jpeg', (d.photoFilename || 'תמונת לפני') + '.jpg');
    photoUrl = pf.createFile(pblob).getUrl();
  }

  // 3) רישום בגיליון (הלשונית הראשית) — כולל שאלון הכניסה
  if (SHEET_ID) {
    const sheet  = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
    const intake = Array.isArray(d.intake) ? d.intake : [];
    const baseHead = ['תאריך ושעה', 'שם', 'ת"ז', 'מסלול', 'תאריך לידה',
                      'טלפון', 'מייל', 'כתובת', 'קטין / הורה', 'דגלי בריאות', 'קישור למסמך'];
    const head = baseHead.concat(intake.map(function (x) { return x.q; })).concat(['תמונת "לפני"', 'הערות לקוח']);
    if (sheet.getLastRow() === 0 || sheet.getLastColumn() < head.length) {
      sheet.getRange(1, 1, 1, head.length).setValues([head]);
    }
    const docCell   = '=HYPERLINK("' + file.getUrl() + '","פתח מסמך")';
    const photoCell = photoUrl ? ('=HYPERLINK("' + photoUrl + '","פתח תמונה")') : '';
    const baseVals = [
      d.time || new Date(), d.name, d.id, d.track, d.dob, d.phone, d.email, d.addr,
      d.minor ? ('קטין — ' + d.pname + ' (ת"ז ' + d.pid + ')') : '',
      d.flagged ? ('כן ×' + d.flagged) : 'הכל שלילי', docCell
    ];
    sheet.appendRow(baseVals.concat(intake.map(function (x) { return x.a; })).concat([photoCell, d.notes || '']));
  }

  // 4) פתיחת מתאמן חדש ב-CRM ("מתאמנים פעילים") — אוטומטית
  addTraineeToCRM_(d);

  sendNotification(d, file, photoUrl);
  return json({ ok: true, url: file.getUrl(), photoUrl: photoUrl });
}

/* פותח שורת מתאמן חדשה בטאב "מתאמנים פעילים" שב-CRM.
   עטוף ב-try — אם משהו משתבש, החתימה עדיין נשמרת (עדיף חתימה בלי CRM מאשר חתימה שנכשלה). */
function addTraineeToCRM_(d) {
  try {
    if (!CRM_SHEET_ID || CRM_SHEET_ID.indexOf('PASTE_') === 0) return;
    const sheet = SpreadsheetApp.openById(CRM_SHEET_ID).getSheetByName(CRM_ACTIVE_SHEET);
    if (!sheet) return;

    const phone = d.phone || '';
    const norm  = function (p) { return String(p == null ? '' : p).replace(/\D/g, ''); };

    // דדופ: אם כבר קיים מתאמן פעיל עם אותו טלפון — לא מוסיפים כפול (למשל שליחה חוזרת)
    const last = sheet.getLastRow();
    if (phone && last >= 2) {
      const np = norm(phone);
      const phones = sheet.getRange(2, 9, last - 1, 1).getValues();   // עמודה 9 = טלפון
      for (let i = 0; i < phones.length; i++) {
        if (np && norm(phones[i][0]) === np) return;
      }
    }

    const map    = CRM_TRACK_MAP[d.track] || [d.track || '', '', 0];
    const track  = map[0], price = map[1], months = map[2];
    const start  = d.time ? new Date(d.time) : new Date();
    let end = '';
    if (months > 0) { end = new Date(start); end.setMonth(end.getMonth() + months); }

    // סדר עמודות: שם, מסלול, דרגה, סטטוס, תאריך התחלה, תאריך סיום, תאריך קשר אחרון, מחיר חודשי, טלפון
    // עמודה 10 (וואטסאפ) נשארת ריקה — נוסחת המערך תמלא אותה לבד. עמודה 11 (הערות) ריקה.
    const target = sheet.getLastRow() + 1;
    sheet.getRange(target, 1, 1, 9).setValues([[
      d.name || '', track, 'טירון שלב א', 'פעיל/ה', start, end, start, price, phone
    ]]);
    sheet.getRange(target, 5, 1, 3).setNumberFormat('dd/mm/yyyy');    // 3 עמודות התאריך
  } catch (err) {
    // מתעלמים בכוונה — לא מפילים את החתימה בגלל תקלת CRM
  }
}

/* ============ שאלון תזונה ============ */
function handleNutrition(d) {
  const root   = DriveApp.getFolderById(FOLDER_ID);
  const folder = getOrCreateSubfolder(root, NUTRITION_SUBFOLDER);
  const answers = Array.isArray(d.answers) ? d.answers : [];

  // 1) PDF של השאלון → תיקיית "שאלוני תזונה"
  const blob = Utilities.newBlob(Utilities.base64Decode(d.pdfBase64), 'application/pdf', (d.filename || 'שאלון תזונה') + '.pdf');
  const file = blob ? folder.createFile(blob) : null;
  if (file) file.setDescription('שאלון תזונה — ' + (d.name || ''));

  // 2) תמונת גוף (אם צורפה) → אותה תיקייה
  let photoUrl = '';
  if (d.photoBase64) {
    const pblob = Utilities.newBlob(Utilities.base64Decode(d.photoBase64), 'image/jpeg', (d.photoFilename || 'תמונת גוף') + '.jpg');
    photoUrl = folder.createFile(pblob).getUrl();
  }

  // 3) רישום בלשונית "תפריט תזונה" (נוצרת אם עוד לא קיימת)
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

  sendNutritionEmail(d, file, photoUrl, answers);
  return json({ ok: true, url: file ? file.getUrl() : '', photoUrl: photoUrl });
}

/* בדיקת חיים */
function doGet() {
  return json({ ok: true, msg: 'Matan Kopel endpoint is live' });
}

/* ============ עוזרים ============ */
function getOrCreateSubfolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/* מייל למאמן בכל חתימה, עם ה-PDF מצורף */
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

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: '✍️ טופס חתום חדש — ' + (d.name || '') + ' (' + (d.track || '') + ')',
      htmlBody: '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
        '<h2 style="margin:0 0 12px;color:#2e7d32">✅ טופס חתום חדש התקבל</h2>' + details + intake + links +
        '<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">' +
        '<p style="color:#999;font-size:12px">נשלח אוטומטית ממערכת החתימות שלך.</p></div>',
      attachments: [file.getAs('application/pdf')]
    });
  } catch (err) { /* לא מפילים את הבקשה אם המייל נכשל */ }
}

/* מייל ליועץ התזונה (+ עותק למאמן) עם ה-PDF מצורף */
function sendNutritionEmail(d, file, photoUrl, answers) {
  if (!NUTRITION_EMAIL) return;
  try {
    const qa = (answers || []).filter(function (x) { return x.a; }).map(function (x) {
      return '<div style="margin-bottom:9px"><b>' + esc(x.q) + '</b><br>' + esc(x.a) + '</div>';
    }).join('');
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
        qa + links +
        '<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">' +
        '<p style="color:#999;font-size:12px">נשלח אוטומטית משאלון התזונה של יחידת הקליסטניקס.</p></div>'
    };
    if (NOTIFY_EMAIL) opts.cc = NOTIFY_EMAIL;
    if (file) opts.attachments = [file.getAs('application/pdf')];
    MailApp.sendEmail(opts);
  } catch (err) { /* לא מפילים את הבקשה אם המייל נכשל */ }
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
  });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
