/**
 * תגובה מהירה ללידים (Speed-to-lead) — לחיצה אחת לוואטסאפ
 * ---------------------------------------------------------------
 * קובץ בפרויקט קליטת הטפסים (ליד Code.gs). משתמש מחדש ב:
 *   CRM_SHEET_ID, crmLeadsSheet_, phoneKey_, waIntl_, esc  (מ-Code.gs)
 *
 * מה זה עושה:
 *   סורק את טאב "לידים" בגיליון ה-CRM כל כמה דקות. לכל ליד חדש (לפי טלפון)
 *   שולח אליך מייל-פעולה אחד עם כפתור וואטסאפ ירוק — הודעת פתיחה מוכנה
 *   ומותאמת לשם הליד. לחיצה אחת ← שליחה. זוכר את מי כבר טיפל (מייל אחד לכל ליד).
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

/* ===== ההודעה שתיפתח בוואטסאפ (אפשר לערוך את הנוסח; {{NAME}} = שם הליד) ===== */
const LEAD_WA_MESSAGE =
  'היי{{NAME}}, מה נשמע? 😁\n' +
  'זה מתן קופל מיחידת הקליסטניקס,\n' +
  'ראיתי שהשארת פרטים לגבי הצטרפות ליחידה ⚜️, אשמח לדבר בטלפון להסביר על התוכנית ולראות אם היא מתאימה לך!\n' +
  'באיזה שעה פנוי לדבר?';

/* מקורות לדלג עליהם (הליד כבר יצר קשר ישיר) — אם אחת מהמילים מופיעה ב"מאיפה הגיע".
   כאן: כל ליד שהגיע דרך וואטסאפ (למשל "מודעה לוואצאפ"). אפשר להוסיף מילים (למשל 'אינסטגרם'). */
const LEAD_SKIP_SOURCE_WORDS = ['וואצאפ', 'וואטסאפ', 'וואטסאף', 'ואטסאפ', 'וואטס', 'whatsapp'];

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
    source: find(['מאיפה הגיע', 'מקור', 'מאיפה', 'source', 'פלטפורמה']),
    goal:   find(['המטרה שלי היא:', 'המטרה שלי היא', 'המטרה', 'מטרה', 'goal'])
  };
}

/* האם לדלג על הליד לפי המקור (הגיע דרך וואטסאפ / יצר קשר ישיר) */
function leadSourceSkip_(source) {
  const s = String(source || '').toLowerCase();
  for (let i = 0; i < LEAD_SKIP_SOURCE_WORDS.length; i++) {
    if (s.indexOf(String(LEAD_SKIP_SOURCE_WORDS[i]).toLowerCase()) > -1) return true;
  }
  return false;
}

/* זיכרון הלידים שכבר טופלו: { phoneKey: { t: זמן } } — נשמר ב-Script Properties */
function leadsWaState_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('LEAD_WA_STATE') || '{}'); }
  catch (e) { return {}; }
}
function leadsWaSaveState_(state) {
  let keys = Object.keys(state);
  if (keys.length > 1500) {  // שומר את ה-1500 האחרונים לפי זמן
    keys.sort(function (a, b) { return (state[a].t || 0) - (state[b].t || 0); });
    keys.slice(0, keys.length - 1500).forEach(function (k) { delete state[k]; });
  }
  PropertiesService.getScriptProperties().setProperty('LEAD_WA_STATE', JSON.stringify(state));
}

/* ===== מייל פעולה — כפתור וואטסאפ מוכן ===== */
function leadFirstTouchEmail_(name, phone, extra) {
  extra = extra || {};
  const to = leadNotifyEmail_();
  if (!to) return;
  const waNum = waIntl_(phone);
  const first = String(name || '').trim().split(/\s+/)[0] || '';   // שם פרטי בלבד
  const msg = LEAD_WA_MESSAGE.replace('{{NAME}}', first ? (' ' + first) : '');
  let details = '<b>שם:</b> ' + esc(name || '(ללא שם)') + '<br><b>טלפון:</b> ' + esc(phone || '');
  if (extra.source) details += '<br><b>מאיפה הגיע:</b> ' + esc(extra.source);
  if (extra.goal)   details += '<br><b>המטרה שלו:</b> ' + esc(extra.goal);
  const btn = waNum
    ? ('<div style="margin:18px 0">' +
       '<a href="https://wa.me/' + waNum + '?text=' + encodeURIComponent(msg) + '" ' +
       'style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:8px;font-size:16px">📤 שלח וואטסאפ ל' + esc(name || 'ליד') + '</a>' +
       '<div style="color:#888;font-size:12px;margin-top:6px">לחיצה תפתח וואטסאפ עם ההודעה מוכנה — רק ללחוץ שלח.</div></div>')
    : '<div style="color:#c00;margin:12px 0">⚠️ אין טלפון תקין לליד הזה.</div>';
  MailApp.sendEmail({
    to: to,
    subject: '🔥 ליד חדש — ' + (name || phone),
    htmlBody: '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
      '<h2 style="margin:0 0 6px;color:#2e7d32">🔥 ליד חדש נכנס</h2>' +
      '<p style="margin:0 0 10px">' + details + '</p>' +
      '<p style="margin:0 0 4px;color:#555">ההודעה שתישלח:</p>' +
      '<blockquote style="margin:0 0 6px;padding:10px 14px;background:#f4f7f4;border-right:3px solid #25D366;white-space:pre-line">' + esc(msg) + '</blockquote>' +
      btn +
      '<div style="color:#999;font-size:12px">מהירות התגובה = יותר סגירות. עדיף לענות בדקות הראשונות. 💪</div>' +
      '</div>'
  });
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
    let firstTouch = 0, seen = 0, skipped = 0;

    if (lastRow >= 2) {
      const vals = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      const state = leadsWaState_();
      const now = Date.now();
      vals.forEach(function (row) {
        const phone = String(row[cols.phone] == null ? '' : row[cols.phone]).trim();
        const pk = phoneKey_(phone);
        if (!pk) return;
        const source = cols.source >= 0 ? String(row[cols.source] == null ? '' : row[cols.source]).trim() : '';
        if (leadSourceSkip_(source)) { skipped++; return; }   // הגיע דרך וואטסאפ — כבר בשיחה
        const name = cols.name >= 0 ? String(row[cols.name] == null ? '' : row[cols.name]).trim() : '';
        const goal = cols.goal >= 0 ? String(row[cols.goal] == null ? '' : row[cols.goal]).trim() : '';
        if (state[pk]) { seen++; return; }        // כבר טופל — מדלגים
        firstTouch++;
        report.push('🆕 ' + (name || phone) + (source ? (' — ' + source) : ''));
        if (!dryRun) { leadFirstTouchEmail_(name, phone, { source: source, goal: goal }); state[pk] = { t: now }; }
      });
      if (!dryRun) leadsWaSaveState_(state);
    }

    out = (dryRun ? '[בדיקה — לא נשלח כלום] ' : '') +
      'לידים חדשים: ' + firstTouch + '  ·  כבר טופלו: ' + seen + '  ·  דילוג (וואטסאפ): ' + skipped +
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
      if (pk) { state[pk] = { t: now }; c++; }
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
  leadFirstTouchEmail_('מתן (בדיקה)', '0587979678', { source: 'אתר', goal: 'לבנות גוף ולהתחזק (טקסט לדוגמה)' });
  const ui = leadsSafeUi_();
  if (ui) try {
    ui.alert('נשלח מייל בדיקה', 'שלחתי אליך (' + leadNotifyEmail_() + ') מייל דוגמה. פתח אותו בטלפון ולחץ על הכפתור הירוק לראות איך זה עובד.', ui.ButtonSet.OK);
  } catch (e) {}
}
