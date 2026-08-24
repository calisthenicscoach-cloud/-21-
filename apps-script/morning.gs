/**
 * אינטגרציה למורנינג (Green Invoice) — יצירת הוצאות אוטומטית מהקבלות
 * ---------------------------------------------------------------
 * קובץ נפרד בתוך אותו פרויקט Apps Script של גיליון הכספים.
 * המפתחות נשמרים ב-Script Properties (Project Settings → Script Properties),
 * לא בקוד: MORNING_KEY_ID , MORNING_KEY_SECRET
 *
 * שלב 1 (הקובץ הזה): חיבור בלבד — morningAuthTest() מוודא שהמפתח עובד.
 */

const MORNING_BASE = 'https://api.greeninvoice.co.il/api/v1';

/* מקבל טוקן גישה מהמפתחות ששמורים ב-Script Properties */
function morningToken_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('MORNING_KEY_ID');
  const secret = props.getProperty('MORNING_KEY_SECRET');
  if (!id || !secret) {
    throw new Error('חסרים מפתחות. הוסף ב-Project Settings → Script Properties: MORNING_KEY_ID ו-MORNING_KEY_SECRET');
  }
  const res = UrlFetchApp.fetch(MORNING_BASE + '/account/token', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ id: id, secret: secret }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error('בקשת טוקן נכשלה (' + code + '): ' + body.substring(0, 300));
  const j = JSON.parse(body);
  if (!j.token) throw new Error('לא התקבל token בתשובה: ' + body.substring(0, 300));
  return j.token;
}

/* בדיקת חיבור — הרץ מהעורך (בחר morningAuthTest → Run), ותסתכל ב"יומן ביצוע" */
function morningAuthTest() {
  let msg;
  try {
    const t = morningToken_();
    msg = 'התחברות הצליחה ✅  (טוקן תקין, ' + String(t).length + ' תווים)';
  } catch (e) {
    msg = 'ההתחברות נכשלה ❌  ' + e.message;
  }
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('מורנינג — בדיקת חיבור', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return msg;
}

/* יוצר הוצאה במורנינג ומחזיר את התשובה הגולמית (קוד + גוף) */
/* שולף הוצאות קיימות ומדפיס אחת — כדי ללמוד את שמות השדות והפורמטים האמיתיים */
function morningInspectExpense() {
  let out;
  try {
    const token = morningToken_();
    const res = UrlFetchApp.fetch(MORNING_BASE + '/expenses/search', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ page: 1, pageSize: 3, sort: 'creationDate' }),
      muteHttpExceptions: true
    });
    out = 'קוד: ' + res.getResponseCode() + '\n\n' + res.getContentText().substring(0, 2500);
  } catch (e) { out = 'שגיאה: ' + e.message; }
  Logger.log(out);
  try { SpreadsheetApp.getUi().alert('מורנינג — הוצאות קיימות', out.substring(0, 1400), SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return out;
}

function morningCreateExpense_(token, d) {
  const res = UrlFetchApp.fetch(MORNING_BASE + '/expenses', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(d),
    muteHttpExceptions: true
  });
  return { code: res.getResponseCode(), body: res.getContentText() };
}

/* שלב 2: יוצר הוצאת בדיקה אחת (סכום 1 ₪) ומדפיס את התשובה של ה-API.
   מריצים מהעורך (בחר morningTestExpense → Run) ובודקים ב"יומן ביצוע". */
function morningTestExpense() {
  let out;
  try {
    const token = morningToken_();
    const payload = {
      description: 'בדיקת אוטומציה — נא למחוק',
      date: Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd'),
      supplier: { name: 'בדיקה אוטומציה' },
      number: 'TEST-001',
      documentType: 305,
      reportingDate: Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM') + '-01',
      currency: 'ILS',
      vatType: 0,
      amount: 1
    };
    const r = morningCreateExpense_(token, payload);
    out = 'קוד תשובה: ' + r.code + '\n\n' + r.body.substring(0, 1000);
  } catch (e) { out = 'שגיאה: ' + e.message; }
  Logger.log(out);
  try { SpreadsheetApp.getUi().alert('מורנינג — הוצאת בדיקה', out, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return out;
}
