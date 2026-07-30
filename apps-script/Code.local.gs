/**
 * ⭐ זו הגרסה המוכנה של Matan Kopel — עם ה-IDs שלך כבר בפנים.
 *
 * מעכשיו, בכל עדכון: פשוט מעתיקים את **כל** התוכן של הקובץ הזה,
 * מדביקים ב-script.google.com (במקום הקוד הישן), שומרים, ואז:
 *   Deploy ▸ Manage deployments ▸ ✏️ ▸ Version: New version ▸ Deploy.
 *
 * אין צורך לגעת בשורות ה-IDs — הן כבר נכונות. (הקובץ Code.gs שליד הוא
 * גרסת התבנית הכללית עם PASTE_... — אל תשתמש/י בו, הוא רק לתיעוד.)
 */

const FOLDER_ID = '1mCW8AzwDwcTyvB5ekYaW28psE2Nxyyf_';                 // התיקייה בדרייב
const SHEET_ID  = '17I2u_BcgOpN9tuHTah2ZKdDuw_hM6GJHnKy5ZghzhG4';     // ה-Google Sheet

function doPost(e) {
  try {
    // הנתונים מגיעים כשדה טופס 'payload' (שליחה דרך iframe), עם נפילה חזרה ל-body גולמי
    const raw = (e && e.parameter && e.parameter.payload) ? e.parameter.payload
              : (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    const d = JSON.parse(raw);

    // 1) שמירת ה-PDF החתום בתיקייה
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const bytes  = Utilities.base64Decode(d.pdfBase64);
    const blob   = Utilities.newBlob(bytes, 'application/pdf', (d.filename || 'signed') + '.pdf');
    const file   = folder.createFile(blob);
    file.setDescription('חתימה דיגיטלית — ' + (d.name || '') + ' — ' + (d.track || ''));

    // 2) שמירת תמונת ה"לפני" (אם צורפה) — בתוך תיקיית משנה "תמונות לפני", כדי לא לפזר תמונות בין ה-PDF-ים
    let photoUrl = '';
    if (d.photoBase64) {
      const photosFolder = getOrCreateSubfolder(folder, 'תמונות לפני');
      const pblob = Utilities.newBlob(Utilities.base64Decode(d.photoBase64),
                                      'image/jpeg', (d.photoFilename || 'תמונת לפני') + '.jpg');
      photoUrl = photosFolder.createFile(pblob).getUrl();
    }

    // 3) רישום שורה בגיליון — כולל תשובות שאלון הפתיחה + קישור לתמונה
    if (SHEET_ID) {
      const sheet  = SpreadsheetApp.openById(SHEET_ID).getSheets()[0];
      const intake = Array.isArray(d.intake) ? d.intake : [];

      // כותרות: העמודות הקבועות + שאלה לכל שאלה בשאלון + תמונה + הערות
      const baseHead = ['תאריך ושעה', 'שם', 'ת"ז', 'מסלול', 'תאריך לידה',
                        'טלפון', 'מייל', 'כתובת', 'קטין / הורה', 'דגלי בריאות', 'קישור למסמך'];
      const head = baseHead
        .concat(intake.map(function (x) { return x.q; }))
        .concat(['תמונת "לפני"', 'הערות לקוח']);

      // כתיבת/הרחבת שורת הכותרת (בטוח גם על גיליון קיים — רק מוסיף עמודות מימין)
      if (sheet.getLastRow() === 0) {
        sheet.getRange(1, 1, 1, head.length).setValues([head]);
      } else if (sheet.getLastColumn() < head.length) {
        sheet.getRange(1, 1, 1, head.length).setValues([head]);
      }

      const baseVals = [
        d.time || new Date(), d.name, d.id, d.track, d.dob, d.phone, d.email, d.addr,
        d.minor ? ('קטין — ' + d.pname + ' (ת"ז ' + d.pid + ')') : '',
        d.flagged ? ('כן ×' + d.flagged) : 'הכל שלילי',
        file.getUrl()
      ];
      const row = baseVals
        .concat(intake.map(function (x) { return x.a; }))
        .concat([photoUrl, d.notes || '']);
      sheet.appendRow(row);
    }

    // 4) (אופציונלי) מייל אליך עם ה-PDF — הסר/י את הסימון // כדי להפעיל, ומלא/י את הכתובת:
    // MailApp.sendEmail({ to: 'your@email.com',
    //   subject: 'טופס חתום חדש — ' + d.name + ' (' + d.track + ')',
    //   body: 'התקבל טופס חתום. מצורף ה-PDF.\nקישור: ' + file.getUrl(),
    //   attachments: [file.getAs('application/pdf')] });

    return json({ ok: true, url: file.getUrl(), photoUrl: photoUrl });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/* בדיקת חיים — פתיחת כתובת ה-Web App בדפדפן צריכה להחזיר {"ok":true} */
function doGet() {
  return json({ ok: true, msg: 'Matan Kopel endpoint is live' });
}

/* מחזיר תיקיית משנה בשם הנתון בתוך התיקייה ההורה — יוצר אותה רק אם עוד לא קיימת */
function getOrCreateSubfolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
