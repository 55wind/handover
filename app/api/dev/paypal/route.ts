import { WALLETS, approve, cancelUrlOf, fakeBackend } from '@/lib/paypal-fake';
import { countries } from '@/lib/pricing';
import { isFake } from '@/lib/seller';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Self-contained on purpose: this page stands outside the app, as PayPal's does. Colours are the app's paper, ink and alarm tokens.
const page = (body: string, status = 200) =>
  new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Development stand-in for PayPal</title>
<style>
body { margin: 0; background: oklch(96.5% 0.016 82); color: oklch(17% 0.012 60); font: 1.0625rem/1.55 ui-sans-serif, system-ui, sans-serif; }
.bar { margin: 0; padding: 8px 16px; background: oklch(50% 0.21 27); color: oklch(98% 0.012 82); font-weight: 500; text-align: center; }
main { max-width: 34rem; margin: 0 auto; padding: 40px 16px 64px; }
h1 { margin: 0 0 16px; font: 400 2rem/1.1 ui-serif, Georgia, serif; letter-spacing: -0.02em; text-wrap: balance; }
p { margin: 0 0 16px; }
ul { margin: 24px 0; padding: 0; list-style: none; border-top: 1px solid oklch(80% 0.018 75); }
li { border-bottom: 1px solid oklch(80% 0.018 75); }
a { color: inherit; text-decoration-thickness: 1px; text-decoration-color: oklch(45% 0.18 262); text-underline-offset: 0.18em; }
a:hover { text-decoration-thickness: 2px; }
li a { display: block; padding: 10px 8px; text-decoration: none; }
li a:hover { background: oklch(93.5% 0.02 80); }
:focus-visible { outline: 2px solid oklch(50% 0.18 262); outline-offset: 2px; }
.id { font-family: ui-monospace, monospace; font-size: 0.8125rem; overflow-wrap: anywhere; }
.muted { color: oklch(49% 0.014 65); font-size: 0.875rem; }
</style>
</head>
<body>
<p class="bar">FAKE PAYPAL, development only</p>
<main>
<h1>Development stand-in for PayPal</h1>
${body}
</main>
</body>
</html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );

/** Development only: plays PayPal's approval screen for the fake backend, then sends the browser back the way PayPal does. */
export async function GET(req: Request) {
  if (!isFake()) return new Response('Not found', { status: 404 });
  const query = new URL(req.url).searchParams;
  const orderId = query.get('order') ?? '';
  const walletId = query.get('wallet');
  try {
    // The only place this ever redirects to is the return URL the order itself stored.
    if (walletId) return new Response(null, { status: 302, headers: { location: approve(orderId, walletId) } });
    const order = await fakeBackend.getOrder(orderId);
    const names = new Map(countries().map((c) => [c.code, c.name]));
    const href = (wallet: string) => esc(`/api/dev/paypal?order=${encodeURIComponent(orderId)}&wallet=${wallet}`);
    return page(`<p>The shop asks to hold <strong>$${esc(order.amount ?? '')}</strong> for order <span class="id">${esc(orderId)}</span>. Choose the wallet that pays.</p>
<ul>
${WALLETS.map((w) => `<li><a href="${href(w.id)}">Pay as ${esc(w.name)}, wallet registered in ${esc(names.get(w.country) ?? w.country)}</a></li>`).join('\n')}
</ul>
<p><a href="${esc(cancelUrlOf(orderId) ?? '/')}">Cancel</a></p>
<p class="muted">No money moves here. The wallets and their owners are made up.</p>`);
  } catch (e) {
    return page(`<p>${esc((e as Error).message)}</p>`, 400);
  }
}
