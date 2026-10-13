/**
 * תגובה מהירה ללידים (Speed-to-lead) — לחיצה אחת לוואטסאפ
 * ---------------------------------------------------------------
 * קובץ בפרויקט קליטת הטפסים (ליד Code.gs). משתמש מחדש ב:
 *   CRM_SHEET_ID, crmLeadsSheet_, phoneKey_, waIntl_, esc  (מ-Code.gs)
 *
 * מה זה עושה:
 *   סורק את טאב "לידים" בגיליון ה-CRM כל כמה דקות. לכל ליד חדש (לפי טלפון)
 *   שולח אליך מייל-פעולה אחד עם כפתור וואטסאפ ירוק — הודעת פתיחה מוכנה
 *   ומותאמת לשם הליד. לחיצה אחת ← שליחה.
 *
 *   לידים חוזרים: אם מספר טלפון שכבר הכרנו משאיר פרטים *שוב* (שורה נוספת בגיליון),
 *   תקבל התראת "🔄 ליד חוזר" מובלטת — כי זה לקוח חם. הזיהוי לפי *מספר השורות*
 *   של אותו טלפון (עמיד למיון/עריכה/תאריכים חסרים, ולא מציף על לידים קיימים).
 *
 * מכסה את שני מקורות הלידים (אתר דרך Make + מודעה) כי שניהם כותבים לאותו טאב.
 *
 * הפעלה:
 *   leadsWaPreview()        – בדיקה בלבד: מראה מה היה נשלח, בלי לשלוח כלום.
 *   leadsWaTestSelf()       – שולח אליך 2 מיילים לדוגמה (חדש + חוזר) לראות איך זה נראה.
 *   leadsWaScan()           – הריצה האמיתית (רצה בטריגר).
 *   installLeadsWaTrigger() – מסמן לידים קיימים כבסיס ומתקין טריגר כל 5 דק'.
 *   leadsWaPrimeExisting()  – מסמן את כל הלידים הקיימים כבסיס (בלי לשלוח).
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
    goal:   find(['המטרה שלי היא:', 'המטרה שלי היא', 'המטרה', 'מטרה', 'goal']),
    notes:  find(['הערות', 'הערה', 'notes']),
    date:   find(['תאריך השארת פרטים', 'תאריך', 'date'])
  };
}

/* ===== גיבוי: קליטת לידי אתר ישירות מהמייל (Elementor) — עצמאי מ-Make ===== */
// קורא מיילי "הודעה חדשה מאת..." מהאתר, מחלץ שם/טלפון/מטרה.
function leadsFromEmail_() {
  const out = [];
  let threads = [];
  try { threads = GmailApp.search('subject:(הודעה חדשה מאת) newer_than:14d', 0, 50); } catch (e) { return out; }
  threads.forEach(function (th) {
    th.getMessages().forEach(function (msg) {
      const body = msg.getPlainBody() || '';
      const mPhone = body.match(/מס\s*טלפון[\s:]*([0-9][0-9\-\s]{6,})/);
      if (!mPhone) return;                                  // חייב להיראות כמו ליד
      const mName = body.match(/שם\s*מלא[\s:]*([^\n\r]+)/);
      const mGoal = body.match(/המטרה שלי היא[\s:]*([^\n\r]+)/);
      out.push({
        name:  (mName ? mName[1] : '').trim(),
        phone: mPhone[1].replace(/\s/g, '').trim(),
        goal:  (mGoal ? mGoal[1] : '').trim(),
        source: 'אתר'
      });
    });
  });
  return out;
}

/* מוסיף ליד לטאב הלידים אם הטלפון עוד לא קיים שם. מחזיר true אם נוסף. */
function leadsAddToSheet_(sheet, cols, L) {
  const pk = phoneKey_(L.phone);
  const last = sheet.getLastRow();
  let lastNameRow = 1;
  if (last >= 2) {
    const vals = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (cols.phone >= 0 && phoneKey_(String(vals[i][cols.phone] || '')) === pk) return false;  // כבר קיים
      const a = String(vals[i][cols.name >= 0 ? cols.name : 0] || '').trim();
      if (a !== '') lastNameRow = i + 2;
    }
  }
  const row = lastNameRow + 1;
  if (cols.name   >= 0)            sheet.getRange(row, cols.name   + 1).setValue(L.name);
  if (cols.phone  >= 0)            sheet.getRange(row, cols.phone  + 1).setValue(L.phone);
  if (cols.goal   >= 0 && L.goal)  sheet.getRange(row, cols.goal   + 1).setValue(L.goal);
  if (cols.source >= 0)            sheet.getRange(row, cols.source + 1).setValue(L.source);
  if (cols.date   >= 0)            sheet.getRange(row, cols.date   + 1).setValue(Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'd.M'));
  return true;
}

/* האם לדלג על הליד לפי המקור (הגיע דרך וואטסאפ / יצר קשר ישיר) */
function leadSourceSkip_(source) {
  const s = String(source || '').toLowerCase();
  for (let i = 0; i < LEAD_SKIP_SOURCE_WORDS.length; i++) {
    if (s.indexOf(String(LEAD_SKIP_SOURCE_WORDS[i]).toLowerCase()) > -1) return true;
  }
  return false;
}

/* זיכרון הלידים: { phoneKey: { t: זמן, n: כמה שורות ראינו לטלפון } } — נשמר ב-Script Properties */
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
  const ret = !!extra.returning;
  const waNum = waIntl_(phone);
  const first = String(name || '').trim().split(/\s+/)[0] || '';   // שם פרטי בלבד
  const msg = LEAD_WA_MESSAGE.replace('{{NAME}}', first ? (' ' + first) : '');
  let details = '<b>שם:</b> ' + esc(name || '(ללא שם)') + '<br><b>טלפון:</b> ' + esc(phone || '');
  if (extra.goal)  details += '<br><b>המטרה שלו:</b> ' + esc(extra.goal);
  if (extra.notes) details += '<br><b>הערות:</b> ' + esc(extra.notes);
  const btn = waNum
    ? ('<div style="margin:18px 0">' +
       '<a href="https://wa.me/' + waNum + '?text=' + encodeURIComponent(msg) + '" ' +
       'style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:8px;font-size:16px">📤 שלח וואטסאפ ל' + esc(name || 'ליד') + '</a>' +
       '<div style="color:#888;font-size:12px;margin-top:6px">לחיצה תפתח וואטסאפ עם ההודעה מוכנה — רק ללחוץ שלח.</div></div>')
    : '<div style="color:#c00;margin:12px 0">⚠️ אין טלפון תקין לליד הזה.</div>';
  MailApp.sendEmail({
    to: to,
    subject: (ret ? '🔄 ליד חוזר — ' : '🔥 ליד חדש — ') + (name || phone),
    htmlBody: '<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#222">' +
      '<h2 style="margin:0 0 6px;color:' + (ret ? '#b26a00' : '#2e7d32') + '">' + (ret ? '🔄 ליד חוזר נכנס' : '🔥 ליד חדש נכנס') + '</h2>' +
      (ret ? '<p style="margin:0 0 10px;padding:8px 12px;background:#fff6e5;border-right:3px solid #ff9800;font-weight:bold;color:#8a4b00">⚡ האדם הזה כבר השאיר פרטים בעבר וחזר עכשיו — סיגנל חם! שווה לתפוס מהר.</p>' : '') +
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

    const props = PropertiesService.getScriptProperties();
    const state = leadsWaState_();     // { phoneKey: { t, n } }  — n = כמה שורות ראינו לטלפון הזה
    const now = Date.now();

    // ספירת שורות לכל טלפון + שמירת פרטי השורה האחרונה (העדכנית) לכל טלפון
    const counts = {}, info = {};
    const lastRow = sheet.getLastRow();
    if (lastRow >= 2) {
      const vals = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
      vals.forEach(function (row) {
        const phone = String(row[cols.phone] == null ? '' : row[cols.phone]).trim();
        const pk = phoneKey_(phone);
        if (!pk) return;
        counts[pk] = (counts[pk] || 0) + 1;
        info[pk] = {
          name:   cols.name   >= 0 ? String(row[cols.name]   == null ? '' : row[cols.name]).trim()   : '',
          phone:  phone,
          source: cols.source >= 0 ? String(row[cols.source] == null ? '' : row[cols.source]).trim() : '',
          goal:   cols.goal   >= 0 ? String(row[cols.goal]   == null ? '' : row[cols.goal]).trim()   : '',
          notes:  cols.notes  >= 0 ? String(row[cols.notes]  == null ? '' : row[cols.notes]).trim()  : ''
        };
      });
    }

    // אתחול ראשוני: אם מנגנון הספירה עוד לא אותחל — מסמנים הכל כבסיס ולא שולחים (מונע הצפה)
    if (props.getProperty('LEAD_COUNT_INIT') !== '1') {
      Object.keys(counts).forEach(function (pk) { state[pk] = { t: now, n: counts[pk] }; });
      if (!dryRun) { leadsWaSaveState_(state); props.setProperty('LEAD_COUNT_INIT', '1'); }
      out = 'אותחל מנגנון לידים חוזרים (ללא שליחה): ' + Object.keys(counts).length + ' טלפונים סומנו כבסיס.';
      Logger.log(out);
      const ui0 = leadsSafeUi_();
      if (ui0) try { ui0.alert('לידים — אתחול', out, ui0.ButtonSet.OK); } catch (e) {}
      return out;
    }

    const report = [];
    let firstTouch = 0, returning = 0, skipped = 0;

    // מעבר 1: ליד חדש (טלפון חדש) + ליד חוזר (טלפון מוכר שהופיע בשורה נוספת)
    Object.keys(counts).forEach(function (pk) {
      const cur = counts[pk];
      const prev = state[pk];
      let isReturning;
      if (!prev) { isReturning = false; }              // טלפון חדש לגמרי
      else if (cur > prev.n) { isReturning = true; }   // חזר — הופיע בשורה נוספת
      else {                                           // אין הגשה חדשה
        if (!dryRun && cur < (prev.n || 0)) { state[pk].n = cur; }  // נמחקו שורות — מעדכנים בסיס כלפי מטה
        return;
      }
      const L = info[pk] || { name: '', phone: '', source: '', goal: '', notes: '' };
      if (leadSourceSkip_(L.source)) { skipped++; if (!dryRun) state[pk] = { t: now, n: cur }; return; }
      if (isReturning) returning++; else firstTouch++;
      report.push((isReturning ? '🔄 ליד חוזר: ' : '🆕 ') + (L.name || L.phone) + (L.source ? (' — ' + L.source) : ''));
      if (!dryRun) {
        leadFirstTouchEmail_(L.name, L.phone, { goal: L.goal, notes: L.notes, returning: isReturning });
        state[pk] = { t: now, n: cur };
      }
    });

    // מעבר 2: גיבוי מהמייל — מוסיף לידי אתר שחסרים בשיטס (אם Make נפל). ההתראה תגיע בסריקה הבאה.
    if (!dryRun) {
      leadsFromEmail_().forEach(function (L) {
        if (phoneKey_(L.phone)) leadsAddToSheet_(sheet, cols, L);
      });
    }

    if (!dryRun) leadsWaSaveState_(state);

    out = (dryRun ? '[בדיקה — לא נשלח כלום] ' : '') +
      'חדשים: ' + firstTouch + '  ·  חוזרים: ' + returning + '  ·  דילוג (וואטסאפ): ' + skipped +
      (report.length ? ('\n\n' + report.join('\n')) : '');
  } catch (e) { out = 'שגיאה: ' + e.message; }
  Logger.log(out);
  const ui = leadsSafeUi_();
  if (ui) try { ui.alert('לידים — תגובה מהירה', out.substring(0, 1450), ui.ButtonSet.OK); } catch (e) {}
  return out;
}

/* ===== התקנה / איפוס ===== */
// מסמן את כל הלידים הקיימים כבסיס (ספירת שורות לכל טלפון) כדי שלא יישלחו התראות על לידים ישנים
function leadsWaPrimeExisting() {
  const ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  const sheet = crmLeadsSheet_(ss);
  if (!sheet) throw new Error('לא נמצא טאב לידים בגיליון ה-CRM.');
  const cols = leadColIndexes_(sheet);
  const state = {};
  const now = Date.now();
  const counts = {};
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2 && cols.phone >= 0) {
    const vals = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    vals.forEach(function (row) {
      const pk = phoneKey_(String(row[cols.phone] == null ? '' : row[cols.phone]).trim());
      if (pk) counts[pk] = (counts[pk] || 0) + 1;
    });
  }
  Object.keys(counts).forEach(function (pk) { state[pk] = { t: now, n: counts[pk] }; });
  // גם לידי אתר מהמייל (14 ימים) — בסיס נקי
  leadsFromEmail_().forEach(function (L) {
    const pk = phoneKey_(L.phone);
    if (pk && !state[pk]) { state[pk] = { t: now, n: 1 }; }
  });
  leadsWaSaveState_(state);
  PropertiesService.getScriptProperties().setProperty('LEAD_COUNT_INIT', '1');
  const msg = 'סומנו ' + Object.keys(state).length + ' טלפונים קיימים כבסיס.\n' +
    'מכאן: ליד חדש → התראה 🔥  ·  ליד שחוזר (משאיר פרטים שוב) → התראת "ליד חוזר" 🔄.';
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
      'המערכת תבדוק לידים חדשים כל 5 דקות. ליד חדש → מייל עם כפתור וואטסאפ. ליד חוזר → התראת "ליד חוזר". ',
      ui.ButtonSet.OK);
  } catch (e) {}
}

/* שולח אליך 2 מיילים לדוגמה (חדש + חוזר) כדי לראות איך זה נראה */
function leadsWaTestSelf() {
  leadFirstTouchEmail_('דני (ליד חדש — בדיקה)', '0587979678', { goal: 'לרזות ולהתחזק (דוגמה)', notes: 'הגיע מהמודעה (דוגמה)' });
  leadFirstTouchEmail_('מתן (ליד חוזר — בדיקה)', '0587979678', { goal: 'חזרה לאימונים (דוגמה)', notes: 'השאיר פרטים שוב אחרי כמה חודשים (דוגמה)', returning: true });
  const ui = leadsSafeUi_();
  if (ui) try {
    ui.alert('נשלחו 2 מיילי בדיקה', 'שלחתי אליך (' + leadNotifyEmail_() + ') שני מיילים לדוגמה — "ליד חדש" ו-"ליד חוזר". פתח אותם לראות את ההבדל.', ui.ButtonSet.OK);
  } catch (e) {}
}
