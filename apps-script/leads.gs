/**
 * תגובה מהירה ללידים (Speed-to-lead) — לחיצה אחת לוואטסאפ
 * ---------------------------------------------------------------
 * קובץ בפרויקט קליטת הטפסים (ליד Code.gs). משתמש מחדש ב:
 *   CRM_SHEET_ID, crmLeadsSheet_, phoneKey_, waIntl_, esc  (מ-Code.gs)
 *
 * מה זה עושה:
 *   סורק את טאב "לידים" בגיליון ה-CRM כל כמה דקות. לכל ליד חדש (לפי טלפון)
 *   שולח אליך מייל-פעולה אחד עם כפתור וואטסאפ ירוק — הודעת פתיחה מוכנה
 *   ומותאמת לשם הליד. לחיצה אחת ← שליחה. זוכר את מי כבר טיפל (לא שולח פעמיים).
 *   אם עברו 24 שעות והליד עדיין לא סומן "נסגר ✅" — תזכורת מעקב אחת.
 *
 * מכסה את שני מקורות הלידים (אתר דרך Make + מודעה) כי שניהם כותבים לאותו טאב.
 *
 * הפעלה:
 *   leadsWaPreview()        – בדיקה בלבד: מראה מה היה נשלח, בלי לשלוח כלום.
 *   leadsWaTestSelf()       – שולח אליך מייל דוגמה לראות איך זה נראה.
 *   leadsWaScan()           – הריצה האמיתית (רצה בטריגר).
 *   installLeadsWaTrigger() – מסמן לידים קיימים כ"טופלו" ומתקין טריגר כל 5 דק'.
 *   leadsWaPrimeExisting()  – מסמן את כל הלידים הקיימים כ"טופלו" (בלי לשלוח).
 */

/* ===== הודעות (אפשר לערוך את הנוסח) ===== */
const LEAD_WA_MESSAGE =
  'היי {{NAME}}! 💪\n' +
  'כאן מתן — מאמן הכושר לחיילים.\n' +
  'ראיתי שהשארת פרטים לגבי האימונים 🙌\n' +
  'מתי נוח לך שנדבר 2 דקות כדי להבין מה אתה מחפש ואיך אני יכול לעזור?';

const LEAD_FOLLOWUP_MESSAGE =
  'היי {{NAME}}, רק מוודא שראית 🙂\n' +
  'עדיין אשמח לתפוס אותך ל-2 דקות לגבי האימונים. מתי נוח לך?';

const LEAD_FOLLOWUP_HOURS = 24;   // אחרי כמה שעות לשלוח תזכורת אם הליד לא נסגר

/* ===== עזרים ===== */
function leadsSafeUi_() { try { return SpreadsheetApp.getUi(); } catch (e) { return null; } }

function leadNotifyEmail_() {
  if (typeof NOTIFY_EMAIL === 'string' && NOTIFY_EMAIL) return NOTIFY_EMAIL;
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; }
}

/* איתור עמודות בטאב הלידים לפי כותרות (עמיד לשמות שונים) */
function leadColIndexes_(sheet) {
  const header = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h == null ? '' : h).trim(); });
  function find(cands) {
    for (let i = 0; i < cands.length; i++) { const idx = header.indexOf(cands[i]); if (idx > -1) return idx; }
    return -1;
  }
  return {
    name:   find(['שם מלא', 'שם', 'שם פרטי', 'full name', 'name']),
    phone:  find(['מס טלפון', 'מספר טלפון', 'טלפון', 'נייד', 'phone']),
    status: find(['סטטוס', 'status'])
  };
}

/* מצב הלידים שכבר טופלו: { phoneKey: { t: זמן-מגע-ראשון, r: 0/1 האם כבר נשלחה תזכורת } } */
function leadsWaState_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('LEAD_WA_STATE') || '{}'); }
  catch (e) { return {}; }
}
function leadsWaSaveState_(state) {
  let keys = Object.keys(state);
  if (keys.length > 800) {  // שומר את ה-800 האחרונים לפי זמן
    keys.sort(function (a, b) { return (state[a].t || 0) - (state[b].t || 0); });
    keys.slice(0, keys.length - 800).forEach(function (k) { delete state[k]; });
  }
  PropertiesService.getScriptProperties().setProperty('LEAD_WA_STATE', JSON.stringify(state));
}

/* האם הסטטוס מציין שהליד טופל/סגור (ואז לא צריך תזכורת) */
function leadResolved_(status) {
  return /נסגר|✅|לא רלוונטי|לא מעוניין|סירב|בוטל|הצטרף/.test(String(status || ''));
}

/* ===== מיילי פעולה ===== */
function leadActionEmail_(name, phone, message, subjectPrefix, headline, headColor) {
  const to = leadNotifyEmail_();
  if (!to) return;
  const waNum = waIntl_(phone);
  const msg = message.replace('{{NAME}}', name || 'שלום');
  const btn = waNum
    ? ('<div style="margin:18px 0">' +
       '<a href="https://wa.me/' + waNum + '?text=' + encodeURIComponent(msg) + '" ' +
       'style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:8px;font-size:16px">📤 שלח וואטסאפ ל' + esc(name || 'ליד') + '</a>' +
       '<div style="color:#888;font-size:12px;margin-top:6px">לחיצה תפתח וואטסאפ עם ההודעה מוכנה — רק ללחוץ שלח.</div></div>')
    : '<div style="color:#c00;margin:12px 0">⚠️ אין טלפון תקין לליד הזה.</div>';
  MailApp.sendEmail({
    to: to,
    subject: subjectPrefix + ' ' + (name || phone),
    htmlBody: '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
      '<h2 style="margin:0 0 6px;color:' + headColor + '">' + headline + '</h2>' +
      '<p style="margin:0 0 10px"><b>שם:</b> ' + esc(name || '(ללא שם)') + '<br><b>טלפון:</b> ' + esc(phone || '') + '</p>' +
      '<p style="margin:0 0 4px;color:#555">ההודעה שתישלח:</p>' +
      '<blockquote style="margin:0 0 6px;padding:10px 14px;background:#f4f7f4;border-right:3px solid #25D366;white-space:pre-line">' + esc(msg) + '</blockquote>' +
      btn +
      '<div style="color:#999;font-size:12px">מהירות התגובה = יותר סגירות. עדיף לענות בדקות הראשונות. 💪</div>' +
      '</div>'
  });
}

function leadFirstTouchEmail_(name, phone) {
  leadActionEmail_(name, phone, LEAD_WA_MESSAGE, '🔥 ליד חדש —', '🔥 ליד חדש נכנס', '#2e7d32');
}
function leadFollowupEmail_(name, phone) {
  leadActionEmail_(name, phone, LEAD_FOLLOWUP_MESSAGE, '⏰ תזכורת מעקב —', '⏰ ליד שעדיין לא נסגר', '#c77700');
}

/* ===== סריקה ===== */
function leadsWaScan()    { return leadsWaRun_(false); }
function leadsWaPreview() { return leadsWaRun_(true);  }

function leadsWaRun_(dryRun) {
  let out;
  try {
    const ss = SpreadsheetApp.openById(CRM_SHEET_ID);
    const sheet = crmLeadsSheet_(ss);
    if (!sheet) throw new Error('לא נמצא טאב לידים בגיליון ה-CRM.');
    const cols = leadColIndexes_(sheet);
    if (cols.phone < 0) throw new Error('לא נמצאה עמודת טלפון בטאב הלידים.');

    const lastRow = sheet.getLastRow();
    const report = [];
    let firstTouch = 0, followups = 0, seen = 0;

    if (lastRow >= 2) {
      const vals = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      const state = leadsWaState_();
      const now = Date.now();
      vals.forEach(function (row) {
        const pk = phoneKey_(String(row[cols.phone] == null ? '' : row[cols.phone]).trim());
        if (!pk) return;
        const name   = cols.name   >= 0 ? String(row[cols.name]   == null ? '' : row[cols.name]).trim()   : '';
        const phone  = String(row[cols.phone] == null ? '' : row[cols.phone]).trim();
        const status = cols.status >= 0 ? String(row[cols.status] == null ? '' : row[cols.status]).trim() : '';
        const st = state[pk];
        if (!st) {
          firstTouch++;
          report.push('🆕 ' + (name || phone));
          if (!dryRun) { leadFirstTouchEmail_(name, phone); state[pk] = { t: now, r: 0 }; }
        } else if (st.r === 0) {
          if (leadResolved_(status)) { if (!dryRun) st.r = 1; }
          else if (now - (st.t || 0) >= LEAD_FOLLOWUP_HOURS * 3600000) {
            followups++;
            report.push('⏰ תזכורת: ' + (name || phone));
            if (!dryRun) { leadFollowupEmail_(name, phone); st.r = 1; }
          } else { seen++; }
        } else { seen++; }
      });
      if (!dryRun) leadsWaSaveState_(state);
    }

    out = (dryRun ? '[בדיקה — לא נשלח כלום] ' : '') +
      'לידים חדשים: ' + firstTouch + '  ·  תזכורות: ' + followups + '  ·  כבר טופלו: ' + seen +
      (report.length ? ('\n\n' + report.join('\n')) : '');
  } catch (e) { out = 'שגיאה: ' + e.message; }
  Logger.log(out);
  const ui = leadsSafeUi_();
  if (ui) try { ui.alert('לידים — תגובה מהירה', out.substring(0, 1450), ui.ButtonSet.OK); } catch (e) {}
  return out;
}

/* ===== התקנה / איפוס ===== */
// מסמן את כל הלידים הקיימים כ"טופלו" כדי שלא יישלחו התראות על לידים ישנים
function leadsWaPrimeExisting() {
  const ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  const sheet = crmLeadsSheet_(ss);
  if (!sheet) throw new Error('לא נמצא טאב לידים בגיליון ה-CRM.');
  const cols = leadColIndexes_(sheet);
  const state = {};
  const lastRow = sheet.getLastRow();
  let c = 0;
  if (lastRow >= 2 && cols.phone >= 0) {
    const vals = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const now = Date.now();
    vals.forEach(function (row) {
      const pk = phoneKey_(String(row[cols.phone] == null ? '' : row[cols.phone]).trim());
      if (pk) { state[pk] = { t: now, r: 1 }; c++; }
    });
  }
  leadsWaSaveState_(state);
  const msg = 'סומנו ' + c + ' לידים קיימים כ"כבר טופלו". מכאן והלאה רק לידים חדשים יקבלו התראה.';
  Logger.log(msg);
  const ui = leadsSafeUi_();
  if (ui) try { ui.alert('לידים — איפוס בסיס', msg, ui.ButtonSet.OK); } catch (e) {}
  return msg;
}

function installLeadsWaTrigger() {
  leadsWaPrimeExisting();  // שלא יפוצץ התראות על לידים ישנים
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'leadsWaScan') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('leadsWaScan').timeBased().everyMinutes(5).create();
  const ui = leadsSafeUi_();
  if (ui) try {
    ui.alert('תגובה מהירה ללידים — הופעל',
      'המערכת תבדוק לידים חדשים כל 5 דקות. ליד חדש → מייל אליך עם כפתור וואטסאפ מוכן.',
      ui.ButtonSet.OK);
  } catch (e) {}
}

/* שולח אליך מייל דוגמה (למספר שלך) כדי לראות איך זה נראה */
function leadsWaTestSelf() {
  leadFirstTouchEmail_('מתן (בדיקה)', '0587979678');
  const ui = leadsSafeUi_();
  if (ui) try {
    ui.alert('נשלח מייל בדיקה', 'שלחתי אליך (' + leadNotifyEmail_() + ') מייל דוגמה. פתח אותו בטלפון ולחץ על הכפתור הירוק לראות איך זה עובד.', ui.ButtonSet.OK);
  } catch (e) {}
}
