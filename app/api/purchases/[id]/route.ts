import { gone } from '@/lib/http';
import { publicPurchase, store } from '@/lib/store';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = store.purchases.get((await params).id);
  return p ? Response.json(publicPurchase(p)) : gone();
}
