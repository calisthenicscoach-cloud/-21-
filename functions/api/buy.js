/**
 * /api/buy
 * The "buy" button on the sales page points here. We first collect the buyer's
 * email (a small branded step), then open a Cardcom Low Profile payment page
 * (server-side, v11 API) with that email baked into the transaction, and redirect
 * the buyer to it. Baking the email in means it reaches us for BOTH credit-card
 * and Bit payments (Bit's flow doesn't ask for an email), so access always opens
 * to the right address and the receipt is emailed there.
 *
 * After payment, the terminal-level "Notify" webhook fires /api/grant-access,
 * which opens course access and emails the login link.
 *
 * The price is fixed on the server (env), never taken from the request.
 *
 * Env (Cloudflare Pages → Variables and Secrets):
 *   CARDCOM_TERMINAL     e.g. 195652
 *   CARDCOM_API_NAME     the API name from Cardcom (secret)
 *   CARDCOM_AMOUNT       course price in ILS, e.g. 147
 *   CARDCOM_MAX_PAYMENTS max installments the buyer may choose, e.g. 2 (optional, default 1)
 *   CARDCOM_PRODUCT      product name shown on the page (optional)
 *   COURSE_URL           the course URL (used elsewhere; also default fallback)
 *   CARDCOM_SUCCESS_URL  thank-you page after payment (optional; default /thanks)
 *   CARDCOM_FAIL_URL     where to send the buyer if payment fails (optional)
 */

const CREATE_URL = 'https://secure.cardcom.solutions/api/v11/LowProfile/Create';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Health check: /api/buy?health=1 — confirms config without creating a page.
  if (url.searchParams.get('health') === '1') {
    return json({
      ok: true,
      endpoint: 'buy',
      configured: {
        terminal: !!env.CARDCOM_TERMINAL,
        apiName: !!env.CARDCOM_API_NAME,
        amount: env.CARDCOM_AMOUNT || null,
        product: env.CARDCOM_PRODUCT || null,
        successUrl: !!env.COURSE_URL,
      },
      ts: new Date().toISOString(),
    });
  }

  const missing = ['CARDCOM_TERMINAL', 'CARDCOM_API_NAME', 'CARDCOM_AMOUNT', 'COURSE_URL']
    .filter((k) => !env[k]);
  if (missing.length) return errorPage('חסרות הגדרות בשרת: ' + missing.join(', '));

  const amount = Number(env.CARDCOM_AMOUNT);
  if (!Number.isFinite(amount) || amount <= 0) return errorPage('סכום התשלום לא מוגדר כראוי.');

  const product = env.CARDCOM_PRODUCT || 'אתגר 21 יום';

  // Step 1 — collect the buyer's email before sending them to pay.
  const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return emailForm(url.pathname, product, amount, '');
  if (!EMAIL_RE.test(email)) return emailForm(url.pathname, product, amount, email);

  const failUrl = env.CARDCOM_FAIL_URL || (env.COURSE_URL + (env.COURSE_URL.includes('?') ? '&' : '?') + 'pay=failed');

  const body = {
    TerminalNumber: Number(env.CARDCOM_TERMINAL),
    ApiName: env.CARDCOM_API_NAME,
    Operation: 'ChargeOnly',
    Amount: amount,
    ISOCoinId: 1, // 1 = ILS
    Language: 'he',
    ProductName: product,
    // The buyer's email travels in ReturnValue so it's echoed back to our webhook
    // even for Bit payments, where Cardcom doesn't collect an email itself.
    ReturnValue: email,
    // Where Cardcom sends the buyer after a successful payment. Defaults to our
    // own /thanks page (fires the Purchase pixel); override with CARDCOM_SUCCESS_URL
    // to use an external thank-you page (which must then fire the Purchase pixel).
    SuccessRedirectUrl: env.CARDCOM_SUCCESS_URL || (url.origin + '/thanks'),
    FailedRedirectUrl: failUrl,
    // Pre-fill + require the email on the card form (buyer can still confirm it).
    UIDefinition: {
      IsHideCardOwnerEmail: false,
      IsCardOwnerEmailRequired: true,
      CardOwnerEmailValue: email,
    },
    // Terminal is set to auto-create a receipt, so Cardcom needs the document
    // lines here; IsSendByEmail mails the receipt to the buyer's address.
    Document: {
      DocumentTypeToCreate: 'Auto',
      Email: email,
      IsSendByEmail: true,
      Products: [
        { Description: product, Quantity: 1, UnitCost: amount },
      ],
    },
  };

  // Optionally let the buyer split the price into up to N payments.
  const maxPayments = Math.max(1, Math.floor(Number(env.CARDCOM_MAX_PAYMENTS) || 1));
  if (maxPayments > 1) {
    body.AdvancedDefinition = { MinNumOfPayments: 1, MaxNumOfPayments: maxPayments };
  }

  let data;
  try {
    const res = await fetch(CREATE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) return errorPage('שגיאת תקשורת מול חברת הסליקה (' + res.status + ').');
  } catch (e) {
    return errorPage('לא הצלחנו להתחבר לחברת הסליקה. נסה שוב בעוד רגע.');
  }

  const code = Number(data.ResponseCode);
  const payUrl = data.Url || data.url;
  if (code !== 0 || !payUrl) {
    const desc = data.Description || data.description || ('קוד ' + (data.ResponseCode ?? '?'));
    return errorPage('פתיחת דף התשלום נכשלה: ' + desc);
  }

  // Send the buyer to Cardcom's secure payment page.
  return Response.redirect(payUrl, 302);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Step-1 page: ask for the email the course login + receipt will be sent to.
function emailForm(action, product, amount, prevValue) {
  const invalid = prevValue ? `<p class="err">כתובת המייל לא תקינה — נסה שוב 🙏</p>` : '';
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${esc(product)} — כניסה לתשלום</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Heebo:wght@400;600;800&display=swap">
    <style>
      *{box-sizing:border-box}
      body{margin:0;min-height:100vh;display:grid;place-items:center;
        background:radial-gradient(120% 120% at 30% 0%,#1b2b52,#0c111c);
        color:#eef1f7;font-family:"Heebo",Arial,sans-serif;padding:24px}
      .card{width:100%;max-width:430px;background:#141b28;border:1px solid #26304055;
        border-radius:18px;padding:30px 26px;box-shadow:0 24px 60px -24px rgba(0,0,0,.6)}
      .prod{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
        border-bottom:1px solid #26304055;padding-bottom:14px;margin-bottom:20px}
      .prod b{font-size:17px;font-weight:800}
      .prod span{font-size:16px;color:#9fb0ff;font-weight:800;white-space:nowrap}
      h1{font-size:21px;margin:0 0 8px;font-weight:800}
      p.sub{margin:0 0 20px;color:#aab3c2;font-size:14.5px;line-height:1.6}
      label{display:block;font-size:13px;color:#c7d0dd;margin:0 0 7px;font-weight:600}
      input{width:100%;font-family:inherit;font-size:16px;padding:14px 15px;border-radius:12px;
        border:1px solid #33405a;background:#0e1420;color:#fff;direction:ltr;text-align:right}
      input:focus{outline:2px solid #2f6bff;outline-offset:1px;border-color:#2f6bff}
      .err{color:#ff9a8a;font-size:13.5px;margin:10px 0 0}
      button{width:100%;margin-top:18px;font-family:inherit;font-size:16px;font-weight:800;
        color:#fff;background:#2f6bff;border:0;border-radius:12px;padding:15px;cursor:pointer}
      button:hover{background:#255ae0}
      .note{margin:16px 0 0;font-size:12.5px;color:#7f8a9c;line-height:1.6;text-align:center}
    </style></head><body>
    <form class="card" method="get" action="${esc(action)}">
      <div class="prod"><b>${esc(product)}</b><span>${esc(amount)} ₪</span></div>
      <h1>כמעט שם! 💪</h1>
      <p class="sub">הכנס את כתובת המייל שאיתה תיכנס לקורס. לכתובת הזו נשלח את <b>קישור הכניסה</b> ואת <b>הקבלה</b> מיד אחרי התשלום.</p>
      <label for="email">כתובת מייל</label>
      <input id="email" name="email" type="email" inputmode="email" required autofocus
        placeholder="you@email.com" value="${esc(prevValue)}">
      ${invalid}
      <button type="submit">המשך לתשלום ←</button>
      <p class="note">תשלום מאובטח דרך Cardcom · אשראי או ביט</p>
    </form></body></html>`;
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

// A friendly Hebrew fallback so a buyer is never stranded on a blank error.
function errorPage(message) {
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>רגע…</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0e1420;color:#eef1f7;
        font-family:Arial,"Heebo",sans-serif;padding:24px}
      .card{max-width:420px;text-align:center;background:#161c29;border:1px solid #26304050;
        border-radius:16px;padding:32px 26px}
      h1{font-size:20px;margin:0 0 10px} p{color:#aab3c2;line-height:1.6;font-size:15px;margin:0 0 20px}
      a{display:inline-block;background:#2f6bff;color:#fff;text-decoration:none;font-weight:800;
        padding:12px 22px;border-radius:12px}
    </style></head><body><div class="card">
      <h1>רגע, משהו השתבש 🙏</h1>
      <p>${esc(message)}<br>אפשר לנסות שוב, ואם זה חוזר — כתבו לנו ונפתח לכם גישה ידנית.</p>
      <a href="javascript:history.back()">חזרה ←</a>
    </div></body></html>`;
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
