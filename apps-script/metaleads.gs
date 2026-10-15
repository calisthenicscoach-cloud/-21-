/**
 * חיבור לידים מקמפיין Meta (Instant Form / Lead Ads) → טאב הלידים הראשי
 * ---------------------------------------------------------------
 * קובץ בפרויקט קליטת הטפסים (לצד leads.gs / Code.gs). משתמש מחדש ב:
 *   CRM_SHEET_ID, crmLeadsSheet_, leadColIndexes_, phoneKey_, leadsSafeUi_
 *
 * מה זה עושה:
 *   מטא מייצאת את הלידים לגיליון נפרד (בפורמט שלה). הפונקציה הזו קוראת משם
 *   לידים חדשים, ממפה אותם לעמודות של הטאב הראשי ("לידים"), ומוסיפה אותם
 *   כ*שורות אמיתיות* — כך שמערכת התגובה-מהירה הקיימת (leadsWaScan) שולחת
 *   עליהם מייל בדיוק כמו על כל ליד אחר. המקור מסומן "קמפיין מילואים".
 *
 * הגדרה (פעם אחת):
 *   Project Settings → Script Properties:
 *     META_LEADS_SHEET_ID = ה-ID של הגיליון שמטא יצרה (מתוך ה-URL שלו)
 *     META_LEADS_TAB      = (אופציונלי) שם הטאב; ריק = הטאב הראשון
 *
 * הפעלה:
 *   metaLeadsPreview()        – בדיקה: מראה אילו עמודות זוהו ודוגמת מיפוי (בלי לשנות כלום).
 *   installMetaLeadsTrigger() – מתקין טריגר כל 5 דק' (ריצה ראשונה מסמנת קיימים, בלי לייבא).
 *   metaLeadsImportExisting() – ייבוא חד-פעמי של כל הלידים הקיימים בגיליון מטא (אם רוצים את הבאצ').
 *   metaLeadsSync()           – הריצה האמיתית (רצה בטריגר).
 */

const META_LEAD_SOURCE = 'קמפיין מילואים';   // ייכתב בעמודת "מאיפה הגיע"

function metaSheetId_() { return (PropertiesService.getScriptProperties().getProperty('META_LEADS_SHEET_ID') || '').trim(); }
function metaTabName_() { return (PropertiesService.getScriptProperties().getProperty('META_LEADS_TAB') || '').trim(); }

/* מאתר עמודות בגיליון של מטא לפי מילות מפתח בכותרת (עמיד לעברית/אנגלית).
   find סורק לפי סדר עדיפות של התנאים (predicate-first) כדי שהתאמה מדויקת
   תנצח התאמה כללית — למשל "full_name" ולא "ad_name"/"campaign_name". */
function metaColIndexes_(header) {
  const h = header.map(function (x) { return String(x == null ? '' : x).trim().toLowerCase(); });
  const has = function (sub) { return function (s) { return s.indexOf(sub) > -1; }; };
  const eq  = function (val) { return function (s) { return s === val; }; };
  function find(preds) {
    for (let p = 0; p < preds.length; p++) for (let i = 0; i < h.length; i++) if (preds[p](h[i])) return i;
    return -1;
  }
  return {
    id:     find([eq('id'), has('leadgen_id'), has('lead_id'), has('מזהה')]),
    time:   find([has('created'), has('זמן'), has('תאריך'), eq('time')]),
    name:   find([eq('full_name'), eq('full name'), eq('שם מלא'), eq('שם_מלא'), has('full_name'), has('full name'), eq('name'), eq('שם')]),
    phone:  find([has('phone'), has('טלפון'), has('נייד')]),
    miluim: find([has('מילואים')]),
    goal:   find([has('מטרה')])
  };
}

/* זיכרון לידים שכבר יובאו ממטא (לפי מזהה, או תאריך+טלפון) — נשמר ב-Script Properties */
function metaSeenLoad_() {
  const o = {};
  const raw = PropertiesService.getScriptProperties().getProperty('META_LEAD_SEEN') || '';
  raw.split('\n').forEach(function (x) { if (x) o[x] = 1; });
  return o;
}
function metaSeenSave_(o) {
  let keys = Object.keys(o);
  if (keys.length > 5000) keys = keys.slice(keys.length - 5000);
  PropertiesService.getScriptProperties().setProperty('META_LEAD_SEEN', keys.join('\n'));
}

/* תאריך d.M מתוך created_time של מטא (אם ניתן), אחרת תאריך היום */
function metaDateStr_(timeVal) {
  try {
    const d = (timeVal instanceof Date) ? timeVal : new Date(String(timeVal));
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'Asia/Jerusalem', 'd.M');
  } catch (e) {}
  return Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'd.M');
}

/* מוסיף ליד כשורה אמיתית בטאב הראשי (אחרי השורה האחרונה עם שם) */
function metaAppendLead_(sheet, cols, L) {
  const last = sheet.getLastRow();
  let lastNameRow = 1;
  if (last >= 2) {
    const vals = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
    for (let i = 0; i < vals.length; i++) {
      const a = String(vals[i][cols.name >= 0 ? cols.name : 0] || '').trim();
      if (a !== '') lastNameRow = i + 2;
    }
  }
  const row = lastNameRow + 1;
  if (cols.name   >= 0 && L.name)   sheet.getRange(row, cols.name   + 1).setValue(L.name);
  if (cols.phone  >= 0 && L.phone)  sheet.getRange(row, cols.phone  + 1).setValue(L.phone);
  if (cols.goal   >= 0 && L.goal)   sheet.getRange(row, cols.goal   + 1).setValue(L.goal);
  if (cols.source >= 0 && L.source) sheet.getRange(row, cols.source + 1).setValue(L.source);
  if (cols.notes  >= 0 && L.notes)  sheet.getRange(row, cols.notes  + 1).setValue(L.notes);
  if (cols.date   >= 0)             sheet.getRange(row, cols.date   + 1).setValue(L.dateStr || Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'd.M'));
  return row;
}

/* הליבה: קורא מגיליון מטא. primeOnly=true → מסמן קיימים בלי לייבא. מחזיר {added, primed, err}. */
function metaImport_(primeOnly) {
  const id = metaSheetId_();
  if (!id) return { err: 'לא הוגדר META_LEADS_SHEET_ID ב-Script Properties.' };
  const mss = SpreadsheetApp.openById(id);
  const tab = metaTabName_();
  const msheet = tab ? mss.getSheetByName(tab) : mss.getSheets()[0];
  if (!msheet) return { err: 'טאב Meta לא נמצא (' + (tab || 'ראשון') + ').' };
  const lastRow = msheet.getLastRow();
  if (lastRow < 2) return { added: 0, primed: 0 };
  const width = msheet.getLastColumn();
  const header = msheet.getRange(1, 1, 1, width).getValues()[0];
  const mc = metaColIndexes_(header);
  if (mc.phone < 0) return { err: 'לא נמצאה עמודת טלפון בגיליון Meta.' };
  const vals = msheet.getRange(2, 1, lastRow - 1, width).getValues();

  const ss = SpreadsheetApp.openById(CRM_SHEET_ID);
  const sheet = crmLeadsSheet_(ss);
  if (!sheet) return { err: 'טאב לידים ראשי לא נמצא.' };
  const cols = leadColIndexes_(sheet);

  const seen = metaSeenLoad_();
  let added = 0, primed = 0;
  vals.forEach(function (row) {
    const phone = String(row[mc.phone] == null ? '' : row[mc.phone]).trim();
    if (!phoneKey_(phone)) return;
    const idv = mc.id >= 0 ? String(row[mc.id] == null ? '' : row[mc.id]).trim() : '';
    const timeStr = mc.time >= 0 ? String(row[mc.time] == null ? '' : row[mc.time]).trim() : '';
    const key = idv || (timeStr + '|' + phoneKey_(phone));
    if (seen[key]) return;
    if (primeOnly) { seen[key] = 1; primed++; return; }
    const name = mc.name  >= 0 ? String(row[mc.name]  == null ? '' : row[mc.name]).trim()  : '';
    const goal = mc.goal  >= 0 ? String(row[mc.goal]  == null ? '' : row[mc.goal]).trim()  : '';
    const mil  = mc.miluim >= 0 ? String(row[mc.miluim] == null ? '' : row[mc.miluim]).trim() : '';
    const notes = mil ? ('מילואים 10/2023–היום: ' + mil) : '';
    metaAppendLead_(sheet, cols, {
      name: name, phone: phone, goal: goal, notes: notes, source: META_LEAD_SOURCE,
      dateStr: metaDateStr_(mc.time >= 0 ? row[mc.time] : null)
    });
    seen[key] = 1; added++;
  });
  metaSeenSave_(seen);
  return { added: added, primed: primed };
}

/* ===== נקודות כניסה ===== */
function metaLeadsSync() {
  try {
    const props = PropertiesService.getScriptProperties();
    const firstRun = props.getProperty('META_LEAD_INIT') !== '1';
    const r = metaImport_(firstRun);
    if (r.err) { Logger.log('metaLeadsSync: ' + r.err); return; }
    if (firstRun) { props.setProperty('META_LEAD_INIT', '1'); Logger.log('metaLeadsSync אותחל: ' + r.primed + ' לידים קיימים סומנו (לא יובאו).'); }
    else if (r.added) Logger.log('metaLeadsSync: יובאו ' + r.added + ' לידים חדשים ממטא.');
  } catch (e) { Logger.log('metaLeadsSync שגיאה: ' + e.message); }
}

/* בדיקה: אילו עמודות זוהו בגיליון מטא + דוגמת מיפוי. לא משנה כלום. */
function metaLeadsPreview() {
  const out = [];
  try {
    const id = metaSheetId_();
    if (!id) { out.push('⚠️ לא הוגדר META_LEADS_SHEET_ID ב-Script Properties.'); }
    else {
      const mss = SpreadsheetApp.openById(id);
      const tab = metaTabName_();
      const msheet = tab ? mss.getSheetByName(tab) : mss.getSheets()[0];
      if (!msheet) { out.push('⚠️ טאב Meta לא נמצא.'); }
      else {
        const width = msheet.getLastColumn();
        const header = msheet.getRange(1, 1, 1, width).getValues()[0];
        const mc = metaColIndexes_(header);
        const col = function (idx) { return idx >= 0 ? ('עמודה ' + (idx + 1) + ' → "' + String(header[idx]).trim() + '"') : '❌ לא נמצא'; };
        out.push('גיליון מטא · טאב "' + msheet.getName() + '" · ' + Math.max(msheet.getLastRow() - 1, 0) + ' לידים');
        out.push('');
        out.push('עמודות שזוהו:');
        out.push('  שם:     ' + col(mc.name));
        out.push('  טלפון:  ' + col(mc.phone));
        out.push('  מטרה:   ' + col(mc.goal));
        out.push('  מילואים: ' + col(mc.miluim));
        out.push('  תאריך:  ' + (mc.time >= 0 ? col(mc.time) : '(אין — ישתמש בתאריך היום)'));
        out.push('  מזהה:   ' + (mc.id >= 0 ? col(mc.id) : '(אין — דדופ לפי תאריך+טלפון)'));
        const lastRow = msheet.getLastRow();
        if (lastRow >= 2 && mc.phone >= 0) {
          const n = Math.min(2, lastRow - 1);
          const vals = msheet.getRange(lastRow - n + 1, 1, n, width).getValues();
          out.push('');
          out.push('דוגמה (כפי שייכתב בטאב הראשי):');
          vals.forEach(function (row) {
            const name = mc.name >= 0 ? String(row[mc.name] || '').trim() : '';
            const phone = String(row[mc.phone] || '').trim();
            const goal = mc.goal >= 0 ? String(row[mc.goal] || '').trim() : '';
            const mil = mc.miluim >= 0 ? String(row[mc.miluim] || '').trim() : '';
            out.push('  • ' + (name || '(ללא שם)') + ' | ' + phone + ' | מטרה: ' + (goal || '-') +
                     ' | הערות: מילואים=' + (mil || '-') + ' | מקור: ' + META_LEAD_SOURCE);
          });
        }
      }
    }
  } catch (e) { out.push('שגיאה: ' + e.message); }
  const s = out.join('\n');
  Logger.log(s);
  const ui = leadsSafeUi_();
  if (ui) try { ui.alert('Meta Leads — בדיקה', s.substring(0, 1450), ui.ButtonSet.OK); } catch (e) {}
  return s;
}

/* ייבוא חד-פעמי של כל הלידים הקיימים בגיליון מטא (למי שרוצה גם את הבאצ' הקיים) */
function metaLeadsImportExisting() {
  PropertiesService.getScriptProperties().setProperty('META_LEAD_INIT', '1');  // לא במצב אתחול → מייבא
  const r = metaImport_(false);
  let msg;
  if (r.err) msg = 'שגיאה: ' + r.err;
  else msg = 'יובאו ' + r.added + ' לידים קיימים ממטא לטאב הראשי.\nתוך כמה דקות תקבל עליהם מייל (או הרץ leadsWaScan עכשיו).';
  Logger.log(msg);
  const ui = leadsSafeUi_();
  if (ui) try { ui.alert('Meta Leads — ייבוא קיימים', msg, ui.ButtonSet.OK); } catch (e) {}
  return msg;
}

function installMetaLeadsTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'metaLeadsSync') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('metaLeadsSync').timeBased().everyMinutes(5).create();
  const ui = leadsSafeUi_();
  if (ui) try {
    ui.alert('Meta Leads — הופעל',
      'לידים חדשים מקמפיין המילואים ייקלטו כל 5 דקות לטאב הראשי, ותקבל עליהם מייל כרגיל.\n' +
      '(הריצה הראשונה סימנה את הקיימים בלי לייבא — כדי לא להציף. לייבוא הקיימים: metaLeadsImportExisting.)',
      ui.ButtonSet.OK);
  } catch (e) {}
}
