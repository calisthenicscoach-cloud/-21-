/**
 * GET /api/masa/thanks        — העמוד שהגולש נוחת עליו כשהוא חוזר מ-Cardcom
 * GET /api/masa/thanks?fail=1 — אותו עמוד, בנוסח של תשלום שלא עבר
 *
 * למה פונקציה ולא קובץ HTML רגיל: ככה הכתובת יושבת תחת /api/masa/ יחד עם
 * כל השאר, ו-buy.js יכול לגזור אותה מהבקשה בלי שתצטרך להזין אותה בסביבה.
 *
 * ‼️ העמוד הזה לא פותח גישה ולא שולח כלום. הוא טקסט בלבד.
 *    הגישה נפתחת רק ב-webhook, אחרי אימות מול Cardcom. אם מישהו יקליד את
 *    הכתובת הזאת ישירות — הוא יראה עמוד נחמד ושום דבר לא יקרה.
 *
 * משתני סביבה (אופציונליים):
 *    MASA_SALES_URL — כתובת דף המכירה, לכפתור "חזרה לדף" במסך הכישלון
 */

const PAGE = (body) => `<!doctype html>
<html lang="he" dir="rtl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>מסע הכוח</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Secular+One&family=Heebo:wght@400;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:grid;place-items:center;
       background:#F2EFE7;color:#1A1A1E;font-family:Heebo,Arial,sans-serif;
       padding:28px 20px;text-align:center;line-height:1.75}
  .card{background:#fff;border:1px solid #E7E1D4;border-radius:20px;
        padding:34px 26px;max-width:460px;width:100%}
  h1{font-family:'Secular One',Heebo,Arial,sans-serif;font-weight:400;
     font-size:26px;margin:0 0 14px;line-height:1.35}
  p{font-size:16px;color:#57534B;margin:0 0 12px}
  p:last-child{margin-bottom:0}
  b{color:#1A1A1E}
  .mark{width:62px;height:62px;border-radius:50%;display:grid;place-items:center;
        margin:0 auto 18px;font-size:30px}
  .ok{background:#E6F5EC}
  .no{background:#FBECEC}
  a.btn{display:inline-block;margin-top:18px;background:#15A65A;color:#fff;
        text-decoration:none;font-weight:700;font-size:16px;
        padding:14px 28px;border-radius:12px}
  small{display:block;margin-top:20px;font-size:13.5px;color:#938D80}
  a.mail{color:#15A65A}
</style></head>
<body><div class="card">${body}</div></body></html>`;

const OK_BODY = `
  <div class="mark ok">✓</div>
  <h1>התשלום נקלט. אתה בפנים.</h1>
  <p>שלחתי לך עכשיו מייל עם <b>קישור הכניסה האישי שלך</b> למסע הכוח.
     הוא אמור להגיע תוך דקה.</p>
  <p>אם הוא לא מופיע — תבדוק בקידומי מכירות ובספאם, ותסמן אותו כ"לא ספאם"
     כדי שהעדכונים הבאים יגיעו ישר לתיבה.</p>
  <small>לא הגיע כלום אחרי כמה דקות? כתוב לי ואפתח לך את הגישה ידנית:<br>
  <a class="mail" href="mailto:calisthenics.coach@matankopel.co.il">calisthenics.coach@matankopel.co.il</a></small>`;

const FAIL_BODY = (sales) => `
  <div class="mark no">✕</div>
  <h1>התשלום לא עבר</h1>
  <p>לא חויבת. זה קורה — לפעמים זה הכרטיס, לפעמים אישור של הבנק
     שצריך ללחוץ עליו באפליקציה.</p>
  <p>אפשר פשוט לנסות שוב.</p>
  ${sales ? `<a class="btn" href="${sales}">חזרה לדף ←</a>` : ''}
  <small>נתקעת פעמיים? כתוב לי ואסדר את זה איתך:<br>
  <a class="mail" href="mailto:calisthenics.coach@matankopel.co.il">calisthenics.coach@matankopel.co.il</a></small>`;

function html(body) {
  return new Response(PAGE(body), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

function handle(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const failed = url.searchParams.get('fail') === '1';

  if (!failed) return html(OK_BODY);

  // רק כתובת http(s) נכנסת ל-href, כדי שלא יהיה אפשר להשתיל כאן javascript:
  let sales = '';
  const raw = (env.MASA_SALES_URL || '').trim();
  if (/^https?:\/\//i.test(raw)) sales = raw.replace(/"/g, '%22');

  return html(FAIL_BODY(sales));
}

export const onRequestGet = handle;
// Cardcom שולח לפעמים POST לכתובת החזרה. שלא ייפול על 405.
export const onRequestPost = handle;
