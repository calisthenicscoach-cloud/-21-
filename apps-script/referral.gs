/**
 * קמפיין הפניות — הודעת "מביא חבר ליחידה" למתאמנים הפעילים, מוכנה לשליחה בלחיצה.
 * ---------------------------------------------------------------
 * קובץ בפרויקט קליטת הטפסים (ליד Code.gs / leads.gs). משתמש מחדש ב:
 *   CRM_SHEET_ID, CRM_ACTIVE_SHEET, phoneKey_, waIntl_, esc, leadNotifyEmail_ (מ-Code.gs / leads.gs)
 *
 * ההצעה: הממליץ מקבל חודש חינם · החבר מקבל 100 ₪ הנחה על החודש הראשון.
 *
 * הפעלה:
 *   referralPreview()  – בדיקה: כמה מתאמנים פעילים ומי, בלי לשלוח כלום.
 *   referralCampaign() – בונה מייל אחד עם כפתור וואטסאפ לכל מתאמן פעיל, ושולח אליך.
 */

/* ===== ההודעה (אפשר לערוך; {{NAME}} = שם פרטי, מוחלף אוטומטית) ===== */
const REFERRAL_MESSAGE =
  'מה קורה{{NAME}}? 💪⚜️\n' +
  'אני רואה כמה אתה מתקדם — ובא לי להרחיב את הגזרה עם עוד לוחמים כמוך.\n' +
  'יש לך חבר מהיחידה שחבל שהוא לא מתאמן?\n' +
  'תכיר בינינו, ואם הוא מצטרף לתוכנית:\n' +
  '🎁 אתה מקבל חודש אימונים חינם\n' +
  '🎁 והוא מקבל 100 ₪ הנחה על החודש הראשון\n' +
  'כל מה שצריך — תשלח לי שם + מספר שלו (או תעביר לו את ההודעה 👊)\n' +
  'מוגבל עד סוף החודש. יאללה, מרחיבים את היחידה! ⚜️';

/* ===== עזרים ===== */
function referralSafeUi_() { try { return SpreadsheetApp.getUi(); } catch (e) { return null; } }
function referralNotifyEmail_() {
  if (typeof leadNotifyEmail_ === 'function') return leadNotifyEmail_();
  if (typeof NOTIFY_EMAIL === 'string' && NOTIFY_EMAIL) return NOTIFY_EMAIL;
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; }
}

function referralActiveSheet_() {
  const ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  return ss.getSheetByName(CRM_ACTIVE_SHEET);
}

function referralColIndexes_(sheet) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h == null ? '' : h).trim(); });
  function find(cands) {
    for (let i = 0; i < cands.length; i++) { const idx = header.indexOf(cands[i]); if (idx > -1) return idx; }
    return -1;
  }
  return {
    name:   find(['שם', 'שם מלא', 'שם פרטי', 'name']),
    phone:  find(['טלפון', 'מס טלפון', 'מספר טלפון', 'נייד', 'phone']),
    status: find(['סטטוס', 'status'])
  };
}

/* כפתור וואטסאפ אחד למתאמן, עם ההודעה מוכנה בשמו */
function referralWaButton_(name, phone) {
  const waNum = waIntl_(phone);
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  const msg = REFERRAL_MESSAGE.replace('{{NAME}}', first ? (' ' + first) : '');
  if (!waNum) return '<div style="margin:8px 0;color:#c00">⚠️ אין טלפון תקין: ' + esc(name || '') + '</div>';
  return '<div style="margin:0;padding:10px 0;border-bottom:1px solid #eee">' +
    '<b>' + esc(name || '(ללא שם)') + '</b> · ' + esc(phone || '') + '<br>' +
    '<a href="https://wa.me/' + waNum + '?text=' + encodeURIComponent(msg) + '" ' +
    'style="display:inline-block;margin-top:6px;background:#25D366;color:#fff;text-decoration:none;font-weight:bold;padding:10px 20px;border-radius:8px;font-size:15px">📤 שלח ל' + esc(first || 'מתאמן') + '</a></div>';
}

/* ===== מנוע ===== */
function referralRun_(dryRun) {
  let out;
  try {
    const sheet = referralActiveSheet_();
    if (!sheet) throw new Error('לא נמצא טאב "' + CRM_ACTIVE_SHEET + '" בגיליון ה-CRM.');
    const cols = referralColIndexes_(sheet);
    if (cols.phone < 0) throw new Error('לא נמצאה עמודת טלפון בטאב המתאמנים.');

    const lastRow = sheet.getLastRow();
    const items = [];
    const names = [];
    const seen = {};
    if (lastRow >= 2) {
      const vals = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      vals.forEach(function (row) {
        const phone = String(row[cols.phone] == null ? '' : row[cols.phone]).trim();
        const pk = phoneKey_(phone);
        if (!pk) return;
        const status = cols.status >= 0 ? String(row[cols.status] == null ? '' : row[cols.status]).trim() : '';
        if (!/פעיל/.test(status)) return;                 // רק פעילים (מדלג על מוקפא/סיים)
        const name = cols.name >= 0 ? String(row[cols.name] == null ? '' : row[cols.name]).trim() : '';
        if (/בדיקה|טסט/.test(name)) return;               // מדלג על שורות בדיקה
        if (seen[pk]) return;
        seen[pk] = 1;
        names.push(name || phone);
        items.push(referralWaButton_(name, phone));
      });
    }

    if (!dryRun && items.length) {
      const to = referralNotifyEmail_();
      if (to) {
        MailApp.sendEmail({
          to: to,
          subject: '⚜️ קמפיין הפניות — ' + items.length + ' מתאמנים פעילים',
          htmlBody: '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222">' +
            '<h2 style="color:#2e7d32;margin:0 0 6px">⚜️ הודעת הפניות — מוכן לשליחה</h2>' +
            '<p style="color:#555;margin:0 0 12px">לחץ על כל כפתור ירוק כדי לשלוח למתאמן את ההודעה המוכנה (השם שלו כבר בפנים). ' +
            items.length + ' מתאמנים פעילים.</p>' +
            items.join('') +
            '<p style="color:#999;font-size:12px;margin-top:14px">טיפ: פתח את המייל בטלפון כדי שהכפתורים יפתחו וואטסאפ ישירות.</p>' +
            '</div>'
        });
      }
    }

    out = (dryRun ? '[בדיקה — לא נשלח כלום] ' : '') + 'מתאמנים פעילים: ' + names.length +
      (names.length ? ('\n\n' + names.join('\n')) : '') +
      (!dryRun && names.length ? '\n\n✅ נשלח אליך מייל עם כפתור לכל מתאמן.' : '');
  } catch (e) { out = 'שגיאה: ' + e.message; }
  Logger.log(out);
  const ui = referralSafeUi_();
  if (ui) try { ui.alert('קמפיין הפניות', out.substring(0, 1450), ui.ButtonSet.OK); } catch (e) {}
  return out;
}

function referralPreview()  { return referralRun_(true);  }
function referralCampaign() { return referralRun_(false); }
