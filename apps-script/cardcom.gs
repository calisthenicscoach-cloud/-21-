/**
 * קארדקום → גיליון התזרים (הכנסות קורס 21 יום)
 * ---------------------------------------------------------------
 * קובץ נפרד בפרויקט של גיליון התזרים (ליד קוד.gs ו-morning.gs).
 * המפתחות נשמרים ב-Script Properties: CARDCOM_TERMINAL , CARDCOM_API_NAME , CARDCOM_API_PASSWORD
 *
 * קריאה בלבד — שולף עסקאות (לא מחייב/מזכה/מבטל).
 * שלב 3 (כרגע): cardcomAuthTest() — מוודא חיבור + מציג את מבנה שדות העסקה.
 */

const CARDCOM_BASE = 'https://secure.cardcom.solutions/api/v11';

/* פרטי החיבור מ-Script Properties (לקריאה מספיק Terminal + ApiName) */
function cardcomCreds_() {
  const p = PropertiesService.getScriptProperties();
  const term = p.getProperty('CARDCOM_TERMINAL');
  const apiName = p.getProperty('CARDCOM_API_NAME');
  if (!term || !apiName) {
    throw new Error('חסרים מפתחות. הוסף ב-Script Properties: CARDCOM_TERMINAL ו-CARDCOM_API_NAME');
  }
  return { terminal: Number(term), apiName: apiName };
}

/* תאריך בפורמט DDMMYYYY שקארדקום מצפה לו */
function cardcomDate_(d) {
  return Utilities.formatDate(d, 'Asia/Jerusalem', 'ddMMyyyy');
}

/* שולף עסקאות לטווח תאריכים. status: 'Success' | 'All' | 'Failure'. מחזיר את ה-JSON המפוענח. */
function cardcomListTransactions_(fromDate, toDate, status, page, pageSize) {
  const c = cardcomCreds_();
  const body = {
    ApiName: c.apiName,
    TerminalNumber: c.terminal,
    FromDate: cardcomDate_(fromDate),
    ToDate: cardcomDate_(toDate),
    TranStatus: status || 'Success',
    Page: page || 1,
    Page_size: pageSize || 100
  };
  const res = UrlFetchApp.fetch(CARDCOM_BASE + '/Transactions/ListTransactions', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  return { code: res.getResponseCode(), json: JSON.parse(res.getContentText() || '{}') };
}

/* בדיקת חיבור — הרץ מהעורך (בחר cardcomAuthTest → Run) ותסתכל בחלון/ביומן.
   שולף עסקאות מ-7 הימים האחרונים, מוודא הצלחה, ומדפיס את שדות העסקה הראשונה כדי שנדע איך לסכם. */
function cardcomAuthTest() {
  let out;
  try {
    const to = new Date();
    const from = new Date(); from.setDate(from.getDate() - 7);
    const r = cardcomListTransactions_(from, to, 'Success', 1, 50);
    const j = r.json;
    const list = j.Tranzactions || [];
    let msg = 'HTTP ' + r.code + '  |  ResponseCode ' + j.ResponseCode + '  ' + (j.Description || '');
    msg += '\nעסקאות ב-7 ימים אחרונים: ' + list.length;
    if (list.length) {
      const t0 = list[0];
      const lines = [];
      Object.keys(t0).forEach(function (k) {
        let v = t0[k];
        if (v && typeof v === 'object') v = JSON.stringify(v);
        v = (v === null || v === undefined) ? '' : String(v);
        if (v.length > 60) v = v.substring(0, 60) + '…';
        lines.push(k + ': ' + v);
      });
      msg += '\n\nשדות עסקה ראשונה:\n' + lines.join('\n');
    } else {
      msg += '\n(אין עסקאות בטווח — אם אתה יודע שהיו, ננסה טווח רחב יותר)';
    }
    out = msg;
  } catch (e) { out = 'שגיאה: ' + e.message; }
  Logger.log(out);
  try { SpreadsheetApp.getUi().alert('קארדקום — בדיקת חיבור', out.substring(0, 1450), SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return out;
}
