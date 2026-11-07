/**
 * /thanks
 * Post-payment "thank you" page. Cardcom redirects the buyer here after a
 * successful payment (see /api/buy SuccessRedirectUrl). It fires the Meta Pixel
 * "Purchase" event so paid campaigns can measure and optimise for real buyers,
 * then forwards the buyer into the course.
 *
 * The buyer's login link arrives by email separately (from the payment webhook);
 * this page is only about conversion tracking + a friendly hand-off.
 *
 * Env (Cloudflare Pages → Variables and Secrets):
 *   META_PIXEL_ID   the course's Meta Pixel id (e.g. 2163728420872746)
 *   CARDCOM_AMOUNT  purchase value in ILS, used as the Purchase event value
 *   COURSE_URL      where to send the buyer next (the course)
 */

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const pixelId = (env.META_PIXEL_ID || '').trim();
  const amount = Number(env.CARDCOM_AMOUNT) || 0;
  const courseUrl = env.COURSE_URL || (url.origin + '/course');

  // Meta Pixel snippet (only when a pixel id is configured).
  //
  // This is the Cardcom-aware version that used to live on the WordPress
  // thank-you page at matankopel.co.il/thank/. That host is being dropped,
  // so the logic moved here: the real sum, the deal number and the buyer's
  // details all arrive as query parameters on Cardcom's redirect, and they
  // give Meta a deduplicated Purchase with advanced matching instead of a
  // flat guess.
  //
  // One fix over the old page: there, `hasPurchaseParams` was computed and
  // never used, so a plain visit or a refresh fired another Purchase and
  // inflated the conversion count. Here it actually gates the event.
  const pixel = pixelId ? `
    <script>
    (function () {
      var PIXEL = ${JSON.stringify(pixelId)};
      var DEFAULT_VALUE = ${amount};
      var DEFAULT_COUNTRY_CODE = "972";

      function numberOrZero(x){ var n = parseFloat(x); return isNaN(n) ? 0 : n; }
      function normPhone(ph){
        var d = (ph || "").replace(/\\D+/g, "");
        if (!d) return "";
        if (d.charAt(0) === "0") d = DEFAULT_COUNTRY_CODE + d.slice(1);
        return d;
      }

      var p = {};
      try {
        new URL(window.location.href).searchParams.forEach(function (v, k) { p[k] = v; });
      } catch (e) {}

      // רק חזרה אמיתית מקארדקום נחשבת רכישה. רענון של הדף — לא.
      var hasPurchaseParams = !!(
        p.suminfull || p.suminagorot || p.ProdPrice ||
        p.internaldealnumber || p.invNumber || p.invoicenumber || p.UID
      );

      var value =
        p.suminfull   ? numberOrZero(p.suminfull) :
        p.suminagorot ? numberOrZero(p.suminagorot) / 100 :
        p.ProdPrice   ? numberOrZero(p.ProdPrice) : DEFAULT_VALUE;
      if (!value) value = DEFAULT_VALUE;

      var currency = (p.cointype === "2") ? "USD" : "ILS";

      var transactionId =
        p.internaldealnumber || p.invNumber || p.invoicenumber || p.UID || "";
      var eventId = transactionId ? ("evt_" + transactionId) : "";

      var itemName = decodeURIComponent((p.ProdName || "").replace(/\\+/g, " ")) || "purchase";
      var itemId   = p.ProductID || p.ProdItemID || "unknown";
      var qty      = parseInt(p.ProdQuantity || "1", 10) || 1;

      var nameParts = (p.CardOwnerName || "").trim().split(/\\s+/);
      var userData = {
        em:      (p.UserEmail || "").toLowerCase().trim(),
        ph:      normPhone(p.InvMobile || p.CardOwnerPhone || ""),
        fn:      (nameParts[0] || "").toLowerCase(),
        ln:      (nameParts.slice(1).join(" ") || "").toLowerCase(),
        ct:      (p.intCity || "").toLowerCase().replace(/\\s+/g, ""),
        country: "il"
      };
      if (transactionId) userData.external_id = transactionId;
      Object.keys(userData).forEach(function (k) { if (!userData[k]) delete userData[k]; });

      // מנקים את הפרטים מהכתובת כדי שלא יישארו בהיסטוריה של הדפדפן.
      if (window.history && window.history.replaceState) {
        try {
          window.history.replaceState({}, document.title,
            window.location.origin + window.location.pathname);
        } catch (e) {}
      }

      !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
      n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
      document,'script','https://connect.facebook.net/en_US/fbevents.js');

      fbq('init', PIXEL, userData);
      fbq('track', 'PageView');

      if (hasPurchaseParams) {
        var payload = {
          value: value, currency: currency,
          contents: [{ id: itemId, quantity: qty, item_price: value }],
          content_ids: [itemId], content_name: itemName,
          content_type: 'product', num_items: qty
        };
        if (eventId) fbq('track', 'Purchase', payload, { eventID: eventId });
        else fbq('track', 'Purchase', payload);
      }
    })();
    </script>` : '';

  const html = `<!doctype html><html lang="he" dir="rtl"><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>תודה! 🎉</title>
    ${pixel}
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;800&display=swap">
    <meta http-equiv="refresh" content="4;url=${escAttr(courseUrl)}">
    <style>
      *{box-sizing:border-box}
      body{margin:0;min-height:100vh;display:grid;place-items:center;
        background:radial-gradient(120% 120% at 30% 0%,#1b2b52,#0c111c);
        color:#eef1f7;font-family:"Heebo",Arial,sans-serif;padding:24px}
      .card{width:100%;max-width:440px;text-align:center;background:#141b28;
        border:1px solid #26304055;border-radius:20px;padding:38px 28px;
        box-shadow:0 24px 60px -24px rgba(0,0,0,.6)}
      .check{width:76px;height:76px;margin:0 auto 20px;border-radius:50%;
        background:#12341f;display:grid;place-items:center}
      .check svg{width:40px;height:40px;stroke:#33c77b;fill:none;stroke-width:3.5;
        stroke-linecap:round;stroke-linejoin:round}
      h1{font-size:24px;margin:0 0 10px;font-weight:800}
      p{color:#aab3c2;font-size:15.5px;line-height:1.65;margin:0 0 8px}
      .spin{width:26px;height:26px;margin:22px auto 6px;border-radius:50%;
        border:3px solid #2a3446;border-top-color:#2f6bff;animation:s .8s linear infinite}
      @keyframes s{to{transform:rotate(360deg)}}
      @media (prefers-reduced-motion:reduce){.spin{animation:none}}
      a.btn{display:inline-block;margin-top:18px;background:#2f6bff;color:#fff;
        text-decoration:none;font-weight:800;font-size:16px;padding:14px 26px;border-radius:12px}
      a.btn:hover{background:#255ae0}
      .small{font-size:12.5px;color:#7f8a9c;margin-top:18px}
    </style></head><body>
    <div class="card">
      <div class="check"><svg viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg></div>
      <h1>התשלום התקבל! 🎉</h1>
      <p>ברוך הבא לאתגר — הגישה שלך לקורס נפתחה.</p>
      <p>שלחנו לך גם <b>מייל עם קישור כניסה</b> (שווה לבדוק גם בספאם).</p>
      <div class="spin" aria-hidden="true"></div>
      <p>פותחים לך את הקורס…</p>
      <a class="btn" href="${escAttr(courseUrl)}">כניסה לקורס ←</a>
      <div class="small">אם הדף לא עובר לבד תוך כמה שניות, לחץ על הכפתור.</div>
    </div>
    <script>
      setTimeout(function(){ location.href = ${JSON.stringify(courseUrl)}; }, 4000);
    </script>
    </body></html>`;

  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function escAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
