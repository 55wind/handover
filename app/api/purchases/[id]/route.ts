import { recheck } from '@/lib/agent';
import { gone } from '@/lib/http';
import { publicPurchase, store } from '@/lib/store';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = store.purchases.get((await params).id);
  if (!p) return gone();
  // A result PayPal had not confirmed yet is asked about again when someone looks; the answer arrives over the event stream.
  void recheck(p.id).catch(() => {});
  return Response.json(publicPurchase(p));
}
