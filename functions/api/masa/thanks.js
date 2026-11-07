/**
 * GET/POST /api/masa/thanks   — העמוד שהגולש נוחת עליו כשהוא חוזר מקארדקום
 *
 * ‼️ העמוד הזה לא מחליט כלום לבד.
 *
 *    קארדקום מחזיר לכאן גם אחרי הצלחה וגם אחרי כישלון (?fail=1), אבל
 *    ההחזרה היא בדפדפן — והיא מקדימה לפעמים את סגירת החיוב בפועל
 *    (3D-Secure, רשת איטית, "אחורה" בדפדפן). לכן:
 *
 *      1. העמוד נפתח במצב "בודקים", בלי להכריז כלום.
 *      2. הוא שואל את /api/masa/status, שמאמת מול קארדקום (GetLpResult).
 *      3. רק תשובה "paid" מציגה "אתה בפנים" ומפעילה את הפיקסל.
 *      4. אחרי חלון של כ-30 שניות בלי אישור הוא מציג "עוד לא קיבלנו
 *         אישור" — **לא "נדחה", ולא "לא חויבת"**, כי אנחנו לא יודעים.
 *         עם שורה מפורשת: אם חויבת, אל תשלם שוב, כתוב לי.
 *
 *    זה מכוון. עדיף שמי שבאמת נדחה יחכה חצי דקה, מאשר שמי ששילם
 *    יקבל הודעה שהוא לא שילם.
 *
 * ‼️ העמוד עדיין לא פותח גישה ולא שולח את מייל הגישה. את זה עושה רק
 *    webhook.js, שרת-לשרת, אחרי אימות. מי שיקליד את הכתובת הזאת ידנית
 *    לא יקבל כלום — גם אם במקרה יראה מסך ירוק.
 *
 * משתני סביבה (כולם אופציונליים):
 *    MASA_SALES_URL        — דף המכירה, לכפתור "חזרה לדף"
 *    MASA_META_PIXEL_ID    — ברירת מחדל: הפיקסל של העסק
 *    MASA_SUPPORT_EMAIL    — ברירת מחדל: calisthenics.coach@matankopel.co.il
 */

const DEFAULT_PIXEL = '2163728420872746';
const DEFAULT_SUPPORT = 'calisthenics.coach@matankopel.co.il';

/* רק http(s) נכנס ל-href, כדי שאי אפשר יהיה להשתיל javascript: */
function safeUrl(raw) {
  const s = String(raw || '').trim();
  return /^https?:\/\//i.test(s) ? s.replace(/"/g, '%22') : '';
}

function page({ sales, pixelId, support }) {
  return `<!doctype html>
<html lang="he" dir="rtl"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex">
<title>מסע הכוח · תודה</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Secular+One&family=Heebo:wght@400;500;700;800;900&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#F2EFE7; --card:#FFFFFF; --card2:#FAF7F0; --ink:#17171B; --ink2:#55514A;
    --muted:#948D80; --line:#E7E1D4; --line2:#D9D2C3;
    --cta:#15A65A; --cta-d:#128049; --ok:#E6F5EC; --wait:#FBF3E3; --wait-ink:#9A6B12;
    --c1:#1FA9CE; --c2:#2F6BFF; --c3:#6D5BF0; --c4:#A64BE0; --c5:#E0477F; --c6:#E8862A;
    --disp:'Secular One',system-ui,sans-serif; --body:'Heebo',system-ui,Arial,sans-serif;
    color-scheme:light;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);
       line-height:1.75;
       padding:calc(26px + env(safe-area-inset-top,0px)) 16px calc(48px + env(safe-area-inset-bottom,0px))}
  .wrap{max-width:560px;margin:0 auto}
  .card{background:var(--card);border:1px solid var(--line);border-radius:22px;
        padding:30px 22px;margin-bottom:16px}
  h1{font-family:var(--disp);font-weight:400;font-size:28px;line-height:1.3;margin:0 0 12px}
  h2{font-family:var(--disp);font-weight:400;font-size:20px;margin:0 0 14px}
  p{font-size:16px;color:var(--ink2);margin:0 0 12px}
  p:last-child{margin-bottom:0}
  b{color:var(--ink);font-weight:700}
  .center{text-align:center}
  .mark{width:66px;height:66px;border-radius:50%;display:grid;place-items:center;
        margin:0 auto 16px;font-size:32px;line-height:1}
  .mark.ok{background:var(--ok);color:var(--cta)}
  .mark.wait{background:var(--wait);color:var(--wait-ink);font-family:var(--disp)}
  .pill{display:inline-block;background:var(--ok);color:var(--cta-d);font-weight:700;
        font-size:13.5px;padding:7px 15px;border-radius:999px;margin-bottom:14px}
  .spin{width:40px;height:40px;border-radius:50%;margin:6px auto 18px;
        border:3px solid var(--line2);border-top-color:var(--cta);
        animation:sp .9s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
  @media (prefers-reduced-motion:reduce){.spin{animation-duration:2.4s}}
  .steps{list-style:none;margin:0;padding:0;counter-reset:s}
  .steps li{counter-increment:s;position:relative;padding:0 46px 0 0;margin-bottom:18px;
            font-size:16px;color:var(--ink2)}
  .steps li:last-child{margin-bottom:0}
  .steps li::before{content:counter(s);position:absolute;right:0;top:1px;
       width:32px;height:32px;border-radius:50%;background:var(--cta);color:#fff;
       font-family:var(--disp);font-size:16px;display:grid;place-items:center}
  /* רק הכותרת של השלב יורדת לשורה משלה. <b> רגיל בתוך השלב נשאר בשורה,
     אחרת "תבדוק בספאם או בקידומי מכירות" מתפרק לשלוש שורות. */
  .steps li .t{display:block;color:var(--ink);font-weight:700;margin-bottom:2px}
  .ladder{display:flex;gap:6px;margin:4px 0 14px}
  .ladder span{flex:1;height:8px;border-radius:999px}
  .note{background:var(--card2);border:1px solid var(--line);border-radius:14px;
        padding:14px 16px;font-size:15px;color:var(--ink2);margin:16px 0 0;text-align:right}
  .sig{display:flex;align-items:center;gap:14px}
  .sig img{width:62px;height:62px;border-radius:50%;object-fit:cover;flex:none;
           border:2px solid var(--line)}
  .sig .t{font-size:15.5px;color:var(--ink2)}
  .sig .t b{display:block;font-family:var(--disp);font-weight:400;font-size:17px;color:var(--ink)}
  .btn{display:inline-block;background:var(--cta);color:#fff;text-decoration:none;
       font-weight:700;font-size:16px;padding:14px 26px;border-radius:13px;border:0;
       cursor:pointer;font-family:var(--body)}
  .btn:hover{background:var(--cta-d)}
  .btn.ghost{background:transparent;color:var(--ink2);border:1px solid var(--line2)}
  .btn.ghost:hover{background:var(--card2)}
  .row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:18px}
  .rs{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
  .rs input{flex:1;min-width:190px;font-family:var(--body);font-size:15.5px;
            padding:13px 14px;border:1px solid var(--line2);border-radius:12px;
            background:#fff;color:var(--ink)}
  .rs input:focus{outline:2px solid var(--cta);outline-offset:1px}
  small{display:block;font-size:13.5px;color:var(--muted);margin-top:16px;line-height:1.7}
  a.mail{color:var(--cta-d);font-weight:700}
  .warn{background:#FFF8EA;border:1px solid #F0DFBC;border-radius:14px;
        padding:15px 17px;margin:16px 0 0;font-size:15.5px;color:#6E5212;text-align:right}
  .warn b{color:#4E3A08}
  [hidden]{display:none!important}
</style></head>
<body>
<div class="wrap">

  <!-- ============ 1. בודקים. ברירת המחדל — לפני שיודעים משהו ============ -->
  <section id="checking" class="card center">
    <div class="spin" role="status" aria-label="בודקים"></div>
    <h1>רגע, בודקים את התשלום</h1>
    <p>שואלים את חברת הסליקה מה קרה בפועל. זה לוקח כמה שניות.</p>
    <p id="slow" hidden><b>לוקח קצת יותר מהרגיל.</b> זה קורה כשהחיוב עוד
       נסגר מול הבנק — אל תסגור את הדף.</p>
    <noscript>
      <p>הדפדפן שלך חוסם סקריפטים, ולכן אי אפשר לבדוק כאן את מצב התשלום.
         <b>אם קיבלת אישור חיוב — הגישה שלך נפתחת אוטומטית ומייל הכניסה
         בדרך אליך.</b> אם לא הגיע כלום, כתוב לי:
         <a class="mail" href="mailto:${support}">${support}</a></p>
    </noscript>
  </section>

  <!-- ============ 2. שולם. רק אחרי אישור מקארדקום ============ -->
  <section id="paid" hidden>
    <div class="card center">
      <div class="mark ok">✓</div>
      <span class="pill">✔ התשלום התקבל</span>
      <h1>מזל טוב, אתה בפנים!</h1>
      <p>קנית את <b>מסע הכוח</b> — ומכאן זה כבר עניין של רמה אחרי רמה.</p>
      <p><b>קישור הכניסה האישי שלך כבר בדרך אליך למייל 💌</b></p>
      <div class="ladder" aria-hidden="true">
        <span style="background:var(--c1)"></span><span style="background:var(--c2)"></span>
        <span style="background:var(--c3)"></span><span style="background:var(--c4)"></span>
        <span style="background:var(--c5)"></span><span style="background:var(--c6)"></span>
      </div>
      <p style="font-size:14.5px;color:var(--muted);margin:0">6 רמות · 12 שלבים · מהיסודות עד מאסטר</p>
    </div>

    <div class="card">
      <h2>מה עושים עכשיו</h2>
      <ol class="steps">
        <li><span class="t">תיכנס לתיבת המייל</span>
            תחפש מייל בשם "הגישה שלך למסע הכוח פתוחה". אם הוא לא שם —
            תבדוק ב<b>ספאם</b> או ב<b>קידומי מכירות</b>, ותסמן אותו
            כ"לא ספאם" כדי שהעדכונים הבאים יגיעו ישר לתיבה.</li>
        <li><span class="t">תשמור את האפליקציה במסך הבית</span>
            בכניסה הראשונה תתבקש לעשות את זה. אחרי זה נכנסים בלחיצה אחת,
            בלי לחפש את המייל כל פעם.</li>
        <li><span class="t">תעשה את מבחן הכוח</span>
            שלוש שאלות: כמה מתח, כמה מקבילים וכמה שכיבות שמיכה אתה עושה
            היום. לכל אחת יש סרטון שמראה איך נראית חזרה נקייה — אל תרמה
            את עצמך, המבחן הזה קובע מאיפה אתה מתחיל.</li>
        <li><span class="t">ותתחיל את האימון הראשון</span>
            המבחן מכניס אותך לרמה, והרמה נותנת לך תוכנית כתובה: כמה סטים,
            כמה חזרות, כמה מנוחה ובאיזה סדר. אפשר להתחיל כבר היום.</li>
      </ol>
      <div class="note">
        <b>טיפ קטן ממני:</b> אל תמהר לעלות רמה. מבחן המעבר קיים בדיוק
        בשביל זה — הגוף גדל בין האימונים, לא בתוכם.
      </div>
    </div>

    <div class="card">
      <div class="sig">
        <img src="/masa/assets/about-portrait.jpg" alt="מתן קופל" width="62" height="62" loading="lazy">
        <div class="t">נתראה באימון,<b>מתן קופל</b></div>
      </div>
      <div class="note" style="margin-top:18px">
        <b>המייל לא הגיע?</b> תקליד כאן את המייל שאיתו קנית ואשלח אותו שוב.
        <form class="rs" id="rsform" novalidate>
          <input id="rsmail" type="email" inputmode="email" autocomplete="email"
                 placeholder="המייל שאיתו קנית" aria-label="המייל שאיתו קנית">
          <button class="btn" type="submit" id="rsbtn">שלח לי שוב</button>
        </form>
        <p id="rsdone" hidden style="margin:10px 0 0;color:var(--cta-d)"><b>נשלח.</b>
           תבדוק גם בספאם ובקידומי מכירות.</p>
      </div>
      <small>עדיין תקוע? כתוב לי ואני פותח לך את הגישה ידנית:<br>
      <a class="mail" href="mailto:${support}">${support}</a></small>
    </div>
  </section>

  <!-- ============ 3. לא קיבלנו אישור. בזהירות — לא "נדחה" ============ -->
  <section id="unconfirmed" class="card center" hidden>
    <div class="mark wait">!</div>
    <h1>עוד לא קיבלנו אישור על התשלום</h1>
    <p>יכול להיות שהוא עדיין בעיבוד אצל חברת הסליקה, ויכול להיות
       שהוא פשוט לא הושלם — מכאן אי אפשר לדעת בוודאות.</p>

    <div class="warn">
      <b>אם הכרטיס שלך כן חויב — אל תשלם שוב.</b><br>
      הגישה נפתחת אוטומטית ברגע שהחיוב נסגר, ומייל הכניסה יגיע אליך.
      אם לא הגיע תוך כמה דקות, כתוב לי ואפתח לך אותה ידנית — יש לי את
      העסקה מול העיניים.
    </div>

    <div class="row">
      <button class="btn" type="button" id="again">בדוק שוב</button>
      ${sales ? `<a class="btn ghost" href="${sales}">חזרה לדף ←</a>` : ''}
    </div>

    <small>לא חויבת ורוצה לנסות שוב? לפעמים זה הכרטיס, ולפעמים אישור של
    הבנק שצריך ללחוץ עליו באפליקציה.<br>
    <a class="mail" href="mailto:${support}">${support}</a></small>
  </section>

</div>

<script>
(function () {
  "use strict";

  var PIXEL = ${JSON.stringify(pixelId)};
  var params = new URLSearchParams(location.search);

  /* אותו מזהה חוזר מקארדקום תחת שמות שונים. */
  var ID_KEYS = ['lpid','LowProfileId','lowProfileId','lowprofileid',
                 'LowProfileCode','lowprofilecode','UID','uid'];
  var lpid = '';
  for (var i = 0; i < ID_KEYS.length; i++) {
    var v = params.get(ID_KEYS[i]);
    if (v && /^[A-Za-z0-9-]{8,64}$/.test(v.trim())) { lpid = v.trim(); break; }
  }
  var cameFromFail = params.get('fail') === '1';

  var elChecking = document.getElementById('checking');
  var elPaid     = document.getElementById('paid');
  var elUnconf   = document.getElementById('unconfirmed');
  var elSlow     = document.getElementById('slow');

  function show(el) {
    elChecking.hidden = true; elPaid.hidden = true; elUnconf.hidden = true;
    el.hidden = false;
  }

  /* ---- הפיקסל. נורה אך ורק על אישור מאומת, ופעם אחת. ---- */
  var fired = false;
  function trackPurchase(amount) {
    if (fired || !PIXEL) return;
    fired = true;
    try {
      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
      (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');

      fbq('init', PIXEL);
      fbq('track', 'PageView');

      var val = Number(amount);
      if (!isFinite(val) || val <= 0) val = null;

      fbq('track', 'Purchase', {
        value: val,
        currency: 'ILS',
        content_ids: ['masa-hakoach'],
        content_name: 'מסע הכוח',
        content_type: 'product',
        contents: [{ id: 'masa-hakoach', quantity: 1, item_price: val }],
        num_items: 1
      }, { eventID: 'masa-' + (lpid || 'noid') });   /* לניכוי כפילויות מול אירוע שרת */
    } catch (e) { /* פיקסל חסום — לא שובר את הדף */ }
  }

  /* ---- שליחת המייל שוב ---- */
  var form = document.getElementById('rsform');
  if (form) {
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var mail = (document.getElementById('rsmail').value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) return;
      document.getElementById('rsbtn').disabled = true;
      fetch('/api/masa/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: mail })
      })['catch'](function(){}).then(function () {
        form.hidden = true;
        document.getElementById('rsdone').hidden = false;
      });
    });
  }

  /* ---- הבדיקה מול השרת ----
     לוח זמנים עולה: בודקים מיד, ואז מרווחים. סך הכל כ-30 שניות לפני
     שמוותרים. מי שבאמת שילם נקלט כמעט תמיד בניסיון הראשון או השני. */
  var DELAYS = [0, 1500, 2500, 3000, 4000, 5000, 6000, 8000];
  var attempt = 0;

  function giveUp() {
    /* הגענו לכאן בלי אישור. זה *לא* אומר שנדחה — והטקסט בדף אומר את זה. */
    show(elUnconf);
  }

  function ask() {
    if (attempt >= DELAYS.length) return giveUp();
    if (attempt >= 3) elSlow.hidden = false;
    var wait = DELAYS[attempt++];
    setTimeout(function () {
      fetch('/api/masa/status?lpid=' + encodeURIComponent(lpid), { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : { state: 'unknown' }; })
        ['catch'](function () { return { state: 'unknown' }; })
        .then(function (d) {
          if (d && d.state === 'paid') { show(elPaid); trackPurchase(d.amount); return; }
          ask();   /* pending או unknown — ממשיכים לשאול, לא מכריזים */
        });
    }, wait);
  }

  document.getElementById('again').addEventListener('click', function () {
    attempt = 0; elSlow.hidden = true; show(elChecking); ask();
  });

  /* ---- נקודת הפתיחה ----
     בלי מזהה עסקה אי אפשר לאמת כלום מול קארדקום. במקרה הזה הולכים
     לפי הכתובת שקארדקום בחר: דף ההצלחה מציג "אתה בפנים" (בלי פיקסל,
     כי אין הוכחה), ודף הכישלון מציג את מסך "עוד לא קיבלנו אישור". */
  if (!lpid) {
    show(cameFromFail ? elUnconf : elPaid);
  } else {
    ask();
  }
})();
</script>
</body></html>`;
}

function handle(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const body = page({
    sales: safeUrl(env.MASA_SALES_URL) || (url.origin + '/masa/'),
    pixelId: String(env.MASA_META_PIXEL_ID || DEFAULT_PIXEL).replace(/[^0-9]/g, ''),
    support: String(env.MASA_SUPPORT_EMAIL || DEFAULT_SUPPORT).replace(/[<>"'&]/g, ''),
  });

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export const onRequestGet = handle;
// קארדקום שולח לפעמים POST לכתובת החזרה. שלא ייפול על 405.
export const onRequestPost = handle;
