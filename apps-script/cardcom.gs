/**
 * קארדקום → גיליון התזרים: הכנסות קורס "אתגר 21 יום"
 * ---------------------------------------------------------------
 * קובץ נפרד בפרויקט של גיליון התזרים (ליד קוד.gs / morning.gs).
 * קורא מיילי רכישה מקארדקום (purchase@out.cardcom.co.il), מסכם לפי שבוע.
 * (משתמש מחדש ב-toNum_ מ-קוד.gs.)
 *
 * שלב נוכחי: cardcomPreview() — בדיקת קריאה בלבד, לא כותב כלום.
 * (בהמשך נוסיף כתיבה ללשונית "הכנסות" + טריגר.)
 */

/* חילוץ מגוף מייל הרכישה של קארדקום */
function cardcomSaleAmount_(body) {
  // ליד "סכום לחיוב"
  let m = body.match(/סכום לחיוב[\s\S]{0,15}?([0-9][0-9,]*\.\d{2})/);
  if (m && toNum_(m[1]) > 0) return toNum_(m[1]);
  // אחרת: הסכום הגדול ביותר עם 2 ספרות עשרוניות (מדלג על כמות "1.0000")
  const nums = (body.match(/[0-9][0-9,]*\.\d{2}/g) || []).map(toNum_).filter(function (x) { return x > 1; });
  return nums.length ? Math.max.apply(null, nums) : null;
}

function cardcomTxnId_(body) {
  const m = body.match(/מספר עסקה פנימי[\s\S]{0,8}?(\d{5,})/);
  return m ? m[1] : null;
}

function cardcomSuccess_(body) {
  return /בוצעה בהצלחה/.test(body) || /חיוב כרטיס[\s\S]{0,6}?0(\D|$)/.test(body);
}

/* תחילת השבוע (יום ראשון) של תאריך */
function cardcomWeekStart_(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());  // 0 = ראשון
  return x;
}

/* בדיקת קריאה בלבד — סורק מיילי רכישה, מחלץ סכומים, ומקבץ לשבועות. לא כותב כלום. */
function cardcomPreview() {
  let out;
  try {
    const threads = GmailApp.search('subject:(רכישה מאתר)', 0, 300);
    const weeks = {};
    let found = 0, ok = 0;
    const bad = [];
    threads.forEach(function (th) {
      th.getMessages().forEach(function (msg) {
        if (!/cardcom/i.test(msg.getFrom())) return;
        if (!/רכישה מאתר/.test(msg.getSubject())) return;
        found++;
        const body = msg.getPlainBody() || '';
        if (!cardcomSuccess_(body)) return;               // רק עסקאות שבוצעו בהצלחה
        const amt = cardcomSaleAmount_(body);
        if (amt == null || !(amt > 0)) { bad.push(msg.getSubject()); return; }
        ok++;
        const ws = cardcomWeekStart_(msg.getDate());
        const key = Utilities.formatDate(ws, 'Asia/Jerusalem', 'yyyy-MM-dd');
        const lbl = Utilities.formatDate(ws, 'Asia/Jerusalem', 'dd/MM/yy');
        if (!weeks[key]) weeks[key] = { lbl: lbl, sum: 0, count: 0 };
        weeks[key].sum = Math.round((weeks[key].sum + amt) * 100) / 100;
        weeks[key].count++;
      });
    });
    const ks = Object.keys(weeks).sort();
    out = 'מיילי רכישה שנמצאו: ' + found + '  |  עסקאות תקינות: ' + ok + '\n\n' +
      'סיכום שבועי (שבוע מתחיל ביום ראשון):\n' +
      (ks.length ? ks.map(function (k) { return 'שבוע ' + weeks[k].lbl + ':  ' + weeks[k].count + ' מכירות  ·  ' + weeks[k].sum + ' ₪'; }).join('\n') : '(לא נמצאו עסקאות)') +
      (bad.length ? ('\n\n⚠️ לא זוהה סכום ב-' + bad.length + ' מיילים') : '');
  } catch (e) { out = 'שגיאה: ' + e.message; }
  Logger.log(out);
  try { SpreadsheetApp.getUi().alert('קארדקום — בדיקת קריאה', out.substring(0, 1450), SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return out;
}
