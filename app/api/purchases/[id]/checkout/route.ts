import { gone } from '@/lib/http';
import { isConfigured } from '@/lib/seller';
import { startCheckout } from '@/lib/shop';
import { store } from '@/lib/store';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = store.purchases.get((await params).id);
  if (!p) return gone();
  if (!isConfigured()) return Response.json({ error: 'The PayPal sandbox is not configured on this server.' }, { status: 503 });
  const r = await startCheckout(p);
  return typeof r === 'string' ? Response.json({ error: r }, { status: 400 }) : Response.json(r);
}
