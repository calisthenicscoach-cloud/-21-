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

/* ===================================================================== */
/* חיבור לקליטת ההוצאות (expenses.gs): כל קבלה שנקלטת → הוצאה במורנינג      */
/* ===================================================================== */

// שולח למורנינג רק קבלות מהתאריך הזה והלאה (מונע כפילות עם מה שהוזן ידנית).
// ניתן לשנות ב-Script Properties: MORNING_START_AFTER (פורמט YYYY/MM/DD)
const MORNING_START_AFTER = '2026/08/24';
// סיווג הוצאה לצורכי מס ("עלויות אחרות"). ניתן לעקוף ב-Script Properties: MORNING_CLASS_ID
const MORNING_CLASS_ID_DEFAULT = '8c0a94f2-49fa-4432-8ac9-f7fd98cf1e24';

// שם הספק במורנינג לפי שם הספק בגיליון (ברירת מחדל: שם הספק עצמו)
const MORNING_SUPPLIER = {
  'ממומן':                 'Meta Platforms Ireland',
  'וי כחול אינסטגרם':       'Meta Platforms Ireland',
  'קארדקום':               'Cardcom',
  'מייל עסקי':             'Google',
  'עמלות אשראי חודשיות':    'Grow',
  'קלוד':                  'Anthropic',
  'canva':                 'Canva'
};

let _morningToken = null;
function morningTokenCached_() {
  if (!_morningToken) _morningToken = morningToken_();
  return _morningToken;
}

// האם החיבור פעיל (מפתחות קיימים ולא כובה ידנית)
function morningEnabled_() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('MORNING_DISABLED') === '1') return false;
  return !!(p.getProperty('MORNING_KEY_ID') && p.getProperty('MORNING_KEY_SECRET'));
}

function morningClassId_() {
  return PropertiesService.getScriptProperties().getProperty('MORNING_CLASS_ID') || MORNING_CLASS_ID_DEFAULT;
}

function morningStartDate_() {
  const s = PropertiesService.getScriptProperties().getProperty('MORNING_START_AFTER') || MORNING_START_AFTER;
  const p = s.split('/');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

/* מזהי מיילים שכבר נשלחו למורנינג — מונע כפילות (נשמר ב-Script Properties) */
let _morningSent = null;
function morningSentLoad_() {
  if (_morningSent === null) {
    _morningSent = {};
    const raw = PropertiesService.getScriptProperties().getProperty('MORNING_SENT') || '';
    raw.split('\n').forEach(function (x) { if (x) _morningSent[x] = 1; });
  }
  return _morningSent;
}
function morningSentHas_(id) { return !!morningSentLoad_()[id]; }
function morningSentAdd_(id) {
  const s = morningSentLoad_(); s[id] = 1;
  let keys = Object.keys(s);
  if (keys.length > 1000) keys = keys.slice(keys.length - 1000);
  PropertiesService.getScriptProperties().setProperty('MORNING_SENT', keys.join('\n'));
}

/* מספר מסמך נומרי דטרמיניסטי מתוך מזהה המייל (אותו מייל → אותו מספר תמיד) */
function morningNumber_(seed) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(seed));
  let digits = '';
  for (let i = 0; i < bytes.length && digits.length < 14; i++) {
    digits += ('00' + (bytes[i] & 0xff)).slice(-3);
  }
  return digits.substring(0, 12);
}

/* יוצר הוצאה אחת במורנינג מתוך קבלה שנקלטה. מחזיר true אם הצליח.
   הסכום כבר בשקלים (מומר במחלצים של expenses.gs). כעוסק פטור: vat=0, כל הסכום כהוצאה. */
function sendToMorning_(vendorName, amountILS, dateObj, month, seed) {
  const token = morningTokenCached_();
  const amt = Math.round(Number(amountILS) * 100) / 100;
  // חודש הדיווח לפי תאריך המייל בפועל — תמיד תקופה עדכנית ותקינה (לא לפי החודש שזוהה לשיטס, שיכול להיות בעבר)
  const payload = {
    description: vendorName,
    date: Utilities.formatDate(dateObj, 'Asia/Jerusalem', 'yyyy-MM-dd'),
    reportingDate: Utilities.formatDate(dateObj, 'Asia/Jerusalem', 'yyyy-MM') + '-01',
    documentType: 305,
    number: morningNumber_(seed),
    currency: 'ILS',
    currencyRate: 1,
    amount: amt,
    vatType: 0,
    vat: 0,
    amountExcludeVat: amt,
    accountingClassification: { id: morningClassId_() },
    supplier: { name: MORNING_SUPPLIER[vendorName] || vendorName }
  };
  const r = morningCreateExpense_(token, payload);
  if (r.code === 200 || r.code === 201) return true;
  Logger.log('מורנינג יצירת הוצאה נכשלה (' + r.code + '): ' + String(r.body).substring(0, 200));
  return false;
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
