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
 *   BREVO_API_KEY        Brevo key — to capture leads at checkout (optional)
 *   BREVO_LEADS_LIST_ID  Brevo list id for leads/abandoned-cart (optional; enables capture)
 *   CART_COUPON_CODE     coupon code for the abandonment emails (optional, default "COMEBACK")
 *   CART_COUPON_PERCENT  discount % that code applies (optional, default 10)
 *
 * Coupon: the cart-abandonment emails link to /api/buy?coupon=<code>. A matching
 * code reduces the price by CART_COUPON_PERCENT automatically — the buyer types
 * nothing. Defaults mean it works with no extra Cloudflare config.
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

  // Self-test: /api/buy?leadtest=1 — adds a fixed, clearly-marked test contact to
  // the leads list and reports Brevo's result, so lead capture can be verified in
  // the browser without a real checkout. It always uses the same test address, so
  // there's nothing to abuse. Delete that one contact from Brevo afterwards.
  if (url.searchParams.get('leadtest') === '1') {
    if (!env.BREVO_API_KEY || !env.BREVO_LEADS_LIST_ID) {
      return json({
        ok: false,
        capture: 'לא מוגדר',
        hasBrevoKey: !!env.BREVO_API_KEY,
        leadsListId: env.BREVO_LEADS_LIST_ID || null,
        note: 'חסר BREVO_API_KEY או BREVO_LEADS_LIST_ID — לכידת הלידים לא פעילה',
      });
    }
    const testEmail = 'brevo-selftest@matankopel.co.il';
    let status = 0, bodyText = '';
    try {
      const r = await fetch('https://api.brevo.com/v3/contacts', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ email: testEmail, listIds: [Number(env.BREVO_LEADS_LIST_ID)], updateEnabled: true }),
      });
      status = r.status;
      bodyText = await r.text().catch(() => '');
    } catch (e) {
      return json({ ok: false, note: 'הבקשה ל-Brevo נכשלה', error: String(e) });
    }
    // 201 = contact created, 204 = existing contact updated/added to list — both OK.
    const ok = status === 201 || status === 204;
    return json({
      ok,
      leadsListId: Number(env.BREVO_LEADS_LIST_ID),
      testEmail,
      brevoStatus: status,
      note: ok
        ? '✅ לכידת לידים עובדת — הליד נכנס לרשימה מס׳ ' + Number(env.BREVO_LEADS_LIST_ID)
        : '❌ Brevo החזיר שגיאה — לכידת הלידים לא עבדה',
      brevo: bodyText.slice(0, 300),
    });
  }

  const missing = ['CARDCOM_TERMINAL', 'CARDCOM_API_NAME', 'CARDCOM_AMOUNT', 'COURSE_URL']
    .filter((k) => !env[k]);
  if (missing.length) return errorPage('חסרות הגדרות בשרת: ' + missing.join(', '));

  const baseAmount = Number(env.CARDCOM_AMOUNT);
  if (!Number.isFinite(baseAmount) || baseAmount <= 0) return errorPage('סכום התשלום לא מוגדר כראוי.');

  const product = env.CARDCOM_PRODUCT || 'אתגר 21 יום';

  // Optional marketing coupon carried in the link (?coupon=CODE) — used by the
  // cart-abandonment emails. The code and percentage live in env with sensible
  // defaults, so a matching link applies the discount automatically; the buyer
  // never types anything. An unknown/absent coupon simply charges full price.
  const couponInput = String(url.searchParams.get('coupon') || '').trim();
  const couponCode = String(env.CART_COUPON_CODE || 'COMEBACK').trim();
  const couponPct = Math.min(90, Math.max(0, Number(env.CART_COUPON_PERCENT ?? 10)));
  const couponOk = !!couponInput && !!couponCode &&
    couponInput.toLowerCase() === couponCode.toLowerCase() && couponPct > 0;
  const amount = couponOk ? Math.max(1, Math.round(baseAmount * (100 - couponPct) / 100)) : baseAmount;
  // What to carry through the email-capture form so the coupon survives that step.
  const couponForForm = couponOk ? couponInput : '';

  // Step 1 — collect the buyer's email before sending them to pay.
  const email = String(url.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return emailForm(url.pathname, product, amount, '', couponForForm, couponOk ? baseAmount : 0);
  if (!EMAIL_RE.test(email)) return emailForm(url.pathname, product, amount, email, couponForForm, couponOk ? baseAmount : 0);

  // Capture the email as a lead (for cart-abandonment follow-up) the moment they
  // reach checkout. Buyers who pay also land in the buyers list via grant-access,
  // so leads-minus-buyers = the people who entered an email but didn't purchase.
  // Fire-and-forget so it never delays the redirect to payment.
  if (env.BREVO_API_KEY && env.BREVO_LEADS_LIST_ID) {
    const p = addLead(env, email);
    if (context.waitUntil) context.waitUntil(p); else p.catch(() => {});
  }

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

// Add an email to the leads list (everyone who reached checkout). Best-effort;
// updateEnabled means an existing contact is simply added to the list.
async function addLead(env, email) {
  try {
    await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ email, listIds: [Number(env.BREVO_LEADS_LIST_ID)], updateEnabled: true }),
    });
  } catch (e) {}
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Step-1 page: ask for the email the course login + receipt will be sent to.
// `coupon` (when non-empty) is carried through as a hidden field so a valid
// coupon survives this step; `original` (when > 0) is the pre-discount price,
// shown struck through so the buyer sees the deal.
function emailForm(action, product, amount, prevValue, coupon, original) {
  const invalid = prevValue ? `<p class="err">כתובת המייל לא תקינה — נסה שוב 🙏</p>` : '';
  const couponField = coupon ? `<input type="hidden" name="coupon" value="${esc(coupon)}">` : '';
  const priceHtml = (original && original > amount)
    ? `<span><s style="opacity:.55;font-weight:600">${esc(original)} ₪</s> ${esc(amount)} ₪</span>`
    : `<span>${esc(amount)} ₪</span>`;
  const couponNote = (original && original > amount)
    ? `<p class="note" style="color:#5fd39a;margin-top:-6px">✓ הקופון הופעל — ההנחה כבר כלולה במחיר</p>` : '';
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
      <div class="prod"><b>${esc(product)}</b>${priceHtml}</div>
      <h1>כמעט שם! 💪</h1>
      <p class="sub">הכנס את כתובת המייל שאיתה תיכנס לקורס. לכתובת הזו נשלח את <b>קישור הכניסה</b> ואת <b>הקבלה</b> מיד אחרי התשלום.</p>
      ${couponNote}
      <label for="email">כתובת מייל</label>
      <input id="email" name="email" type="email" inputmode="email" required autofocus
        placeholder="you@email.com" value="${esc(prevValue)}">
      ${couponField}
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
