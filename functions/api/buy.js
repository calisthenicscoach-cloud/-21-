/**
 * /api/buy
 * The "buy" button on the sales page points here. On click we open a Cardcom
 * Low Profile payment page (server-side, v11 API) and redirect the customer to
 * it. The customer enters their email + card on Cardcom's secure page and pays;
 * from there the terminal-level "Notify" webhook (already configured) fires
 * /api/grant-access, which opens course access, emails a login link, and the
 * receipt goes out automatically.
 *
 * The price is fixed on the server (env), never taken from the request, so the
 * amount can't be tampered with from the browser.
 *
 * Env (Cloudflare Pages → Variables and Secrets):
 *   CARDCOM_TERMINAL     e.g. 212739486
 *   CARDCOM_API_NAME     the API name/key from Cardcom (secret)
 *   CARDCOM_AMOUNT       course price in ILS, e.g. 299
 *   CARDCOM_PRODUCT      product name shown on the page (optional)
 *   COURSE_URL           where to send the buyer after a successful payment
 *   CARDCOM_FAIL_URL     where to send the buyer if payment fails (optional)
 */

const CREATE_URL = 'https://secure.cardcom.solutions/api/v11/LowProfile/Create';

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
  const failUrl = env.CARDCOM_FAIL_URL || (env.COURSE_URL + (env.COURSE_URL.includes('?') ? '&' : '?') + 'pay=failed');

  const body = {
    TerminalNumber: Number(env.CARDCOM_TERMINAL),
    ApiName: env.CARDCOM_API_NAME,
    Operation: 'ChargeOnly',
    Amount: amount,
    ISOCoinId: 1, // 1 = ILS
    Language: 'he',
    ProductName: product,
    ReturnValue: 'course-' + Date.now().toString(36),
    SuccessRedirectUrl: env.COURSE_URL,
    FailedRedirectUrl: failUrl,
  };

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
      <p>${message}<br>אפשר לנסות שוב, ואם זה חוזר — כתבו לנו ונפתח לכם גישה ידנית.</p>
      <a href="javascript:history.back()">חזרה ←</a>
    </div></body></html>`;
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}
