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

  sendNotification(d, file, photoUrl);
  return json({ ok: true, url: file.getUrl(), photoUrl: photoUrl });
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

  sendNutritionEmail(d, file, photoUrl, answers);
  return json({ ok: true, url: file ? file.getUrl() : '', photoUrl: photoUrl });
}

function doGet() {
  return json({ ok: true, msg: 'Matan Kopel endpoint is live' });
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
