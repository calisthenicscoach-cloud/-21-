/**
 * Matan Kopel — קליטת טפסים חתומים.
 * שומר את ה-PDF החתום בתיקייה בגוגל-דרייב, ורושם שורה בגיליון Google Sheet.
 *
 * הקמה (פעם אחת) — ראה/י apps-script/README.md:
 *   1. צור/י תיקייה בדרייב, והעתק/י את ה-ID שלה (מה-URL) אל FOLDER_ID למטה.
 *   2. צור/י Google Sheet, והעתק/י את ה-ID שלו אל SHEET_ID למטה.
 *   3. Deploy ▸ New deployment ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone.
 *   4. העתק/י את כתובת ה-Web App אל DRIVE_ENDPOINT ב-index.html.
 */

const FOLDER_ID = 'PASTE_DRIVE_FOLDER_ID_HERE';   // ה-ID של התיקייה בדרייב
const SHEET_ID  = 'PASTE_SPREADSHEET_ID_HERE';    // ה-ID של ה-Google Sheet (השאר/י ריק כדי לוותר על טבלה)

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

    // 2) שמירת תמונת ה"לפני" (אם צורפה) — כקובץ נפרד באותה תיקייה
    let photoUrl = '';
    if (d.photoBase64) {
      const pblob = Utilities.newBlob(Utilities.base64Decode(d.photoBase64),
                                      'image/jpeg', (d.photoFilename || 'תמונת לפני') + '.jpg');
      photoUrl = folder.createFile(pblob).getUrl();
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

    // 3) (אופציונלי) מייל אליך עם ה-PDF — הסר/י את הסימון // כדי להפעיל, ומלא/י את הכתובת:
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

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
