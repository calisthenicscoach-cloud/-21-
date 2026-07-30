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
const NOTIFY_EMAIL = '';                          // מייל שיקבל התראה בכל חתימה (השאר/י ריק כדי לוותר על מייל)

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

      const docCell   = '=HYPERLINK("' + file.getUrl() + '","פתח מסמך")';
      const photoCell = photoUrl ? ('=HYPERLINK("' + photoUrl + '","פתח תמונה")') : '';
      const baseVals = [
        d.time || new Date(), d.name, d.id, d.track, d.dob, d.phone, d.email, d.addr,
        d.minor ? ('קטין — ' + d.pname + ' (ת"ז ' + d.pid + ')') : '',
        d.flagged ? ('כן ×' + d.flagged) : 'הכל שלילי',
        docCell
      ];
      const row = baseVals
        .concat(intake.map(function (x) { return x.a; }))
        .concat([photoCell, d.notes || '']);
      sheet.appendRow(row);
    }

    // 4) מייל אליך עם ה-PDF בכל חתימה (רק אם NOTIFY_EMAIL מוגדר למעלה)
    sendNotification(d, file, photoUrl);

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

/* שולח מייל התראה עם ה-PDF מצורף וקישורים. עטוף ב-try כדי שכשל במייל לא יפיל את השמירה. */
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

    const html = '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
      '<h2 style="margin:0 0 12px;color:#2e7d32">✅ טופס חתום חדש התקבל</h2>' +
      details + intake + links +
      '<hr style="border:none;border-top:1px solid #ddd;margin:16px 0">' +
      '<p style="color:#999;font-size:12px">נשלח אוטומטית ממערכת החתימות שלך.</p></div>';

    MailApp.sendEmail({
      to: NOTIFY_EMAIL,
      subject: '✍️ טופס חתום חדש — ' + (d.name || '') + ' (' + (d.track || '') + ')',
      htmlBody: html,
      attachments: [file.getAs('application/pdf')]
    });
  } catch (err) { /* מתעלמים — לא מפילים את הבקשה אם המייל נכשל */ }
}

/* מנקה תווים מיוחדים כדי שטקסט מהמשתמש לא ישבור את ה-HTML של המייל */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
  });
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
