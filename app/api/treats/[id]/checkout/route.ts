import { gone } from '@/lib/http';
import { isConfigured } from '@/lib/shops';
import { store } from '@/lib/store';
import { startCheckout } from '@/lib/treats';

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = store.treats.get((await params).id);
  if (!t) return gone();
  if (!isConfigured()) return Response.json({ error: 'The PayPal sandbox is not configured on this server.' }, { status: 503 });
  const r = await startCheckout(t);
  return typeof r === 'string' ? Response.json({ error: r }, { status: 400 }) : Response.json(r);
}
