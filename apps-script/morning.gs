/**
 * אינטגרציה למורנינג (Green Invoice) — יצירת הוצאות אוטומטית מהקבלות
 * המפתחות נשמרים ב-Script Properties: MORNING_KEY_ID , MORNING_KEY_SECRET
 */

const MORNING_BASE = 'https://api.greeninvoice.co.il/api/v1';

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

function morningAuthTest() {
  let msg;
  try {
    const t = morningToken_();
    msg = 'התחברות הצליחה  (טוקן תקין, ' + String(t).length + ' תווים)';
  } catch (e) {
    msg = 'ההתחברות נכשלה  ' + e.message;
  }
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert('מורנינג — בדיקת חיבור', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return msg;
}

function morningInspectExpense() {
  let out;
  try {
    const token = morningToken_();
    const sres = UrlFetchApp.fetch(MORNING_BASE + '/expenses/search', {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify({ page: 1, pageSize: 1, sort: 'creationDate' }),
      muteHttpExceptions: true
    });
    const sj = JSON.parse(sres.getContentText());
    const item = (sj.items && sj.items[0]) || (sj.rows && sj.rows[0]) || null;
    if (!item) { out = 'לא נמצאו הוצאות. תשובת search:\n' + sres.getContentText().substring(0, 1200); }
    else {
      const id = item.id;
      const dres = UrlFetchApp.fetch(MORNING_BASE + '/expenses/' + id, {
        method: 'get',
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true
      });
      const full = JSON.parse(dres.getContentText());
      const lines = [];
      Object.keys(full).forEach(function (k) {
        let v = full[k];
        if (v && typeof v === 'object') v = JSON.stringify(v);
        v = (v === null || v === undefined) ? '' : String(v);
        if (v.length > 80) v = v.substring(0, 80) + '…';
        lines.push(k + ': ' + v);
      });
      out = 'שדות ההוצאה האמיתית:\n\n' + lines.join('\n');
    }
  } catch (e) { out = 'שגיאה: ' + e.message; }
  Logger.log(out);
  try { SpreadsheetApp.getUi().alert('מורנינג — שדות הוצאה אמיתית', out.substring(0, 1450), SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
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

/* בדיקה חכמה: מנסה כמה גרסאות payload עד שאחת עוברת. עוצר בהצלחה הראשונה
   (כך נוצרת לכל היותר הוצאת בדיקה אחת של 1 ₪ למחיקה). */
function morningTestExpense() {
  let out;
  try {
    const token = morningToken_();
    const today = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM-dd');
    const rep = Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'yyyy-MM') + '-01';
    const CLS = { id: '8c0a94f2-49fa-4432-8ac9-f7fd98cf1e24' };

    const base = {
      description: 'בדיקת אוטומציה — נא למחוק',
      date: today,
      reportingDate: rep,
      documentType: 305,
      number: '1001',
      currency: 'ILS',
      currencyRate: 1,
      amount: 1,
      accountingClassification: CLS
    };
    function clone(extra) { return Object.assign({}, base, extra); }

    const variants = [
      ['V1 sup.name',        clone({ supplier: { name: 'בדיקה אוטומציה' } })],
      ['V2 vatType0',        clone({ supplier: { name: 'בדיקה אוטומציה' }, vatType: 0 })],
      ['V3 country',         clone({ supplier: { name: 'בדיקה אוטומציה', country: 'IL' } })],
      ['V4 taxId',           clone({ supplier: { name: 'בדיקה אוטומציה', taxId: '212739486' } })],
      ['V5 vat0+excl',       clone({ supplier: { name: 'בדיקה אוטומציה' }, vatType: 0, vat: 0, amountExcludeVat: 1 })],
      ['V6 docType320',      clone({ supplier: { name: 'בדיקה אוטומציה' }, documentType: 320 })],
      ['V7 docType400',      clone({ supplier: { name: 'בדיקה אוטומציה' }, documentType: 400 })],
      ['V8 payment[]',       clone({ supplier: { name: 'בדיקה אוטומציה' }, payment: [{ type: 4, price: 1, currency: 'ILS' }] })]
    ];

    const lines = [];
    let done = false;
    for (let i = 0; i < variants.length && !done; i++) {
      const nm = variants[i][0], p = variants[i][1];
      const r = morningCreateExpense_(token, p);
      let msg;
      try { const j = JSON.parse(r.body); msg = 'ec=' + j.errorCode + ' ' + (j.errorMessage || ''); }
      catch (e) { msg = r.body.substring(0, 120); }
      lines.push(nm + ' -> ' + r.code + '  ' + msg);
      if (r.code === 200 || r.code === 201) { lines.push('*** הצליח: ' + nm + ' ***'); done = true; }
    }
    out = lines.join('\n');
  } catch (e) { out = 'שגיאה: ' + e.message; }
  Logger.log(out);
  try { SpreadsheetApp.getUi().alert('מורנינג — בדיקות', out.substring(0, 1450), SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return out;
}
