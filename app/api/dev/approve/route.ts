import { isFake } from '@/lib/merchants';
import { approveSubscription } from '@/lib/paypal-fake';

/** Development only: plays PayPal's approval page for the fake backend, then returns the browser the way PayPal does. */
export async function GET(req: Request) {
  if (!isFake()) return new Response('Not found', { status: 404 });
  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  const back = url.searchParams.get('back') ?? '/';
  approveSubscription(id);
  // Only ever back to a case page on this site.
  const path = /^\/case\/[\w-]+$/.test(back) ? back : '/';
  return new Response(null, { status: 302, headers: { location: `${path}?subscription_id=${encodeURIComponent(id)}` } });
}
