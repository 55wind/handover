import { gone, readJson } from '@/lib/http';
import { setGift } from '@/lib/shop';
import { publicPurchase, store } from '@/lib/store';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = store.purchases.get((await params).id);
  if (!p) return gone();
  const body = (await readJson(req, 2000)) as { gift?: unknown } | null;
  const error = setGift(p, body?.gift);
  return error ? Response.json({ error }, { status: 400 }) : Response.json(publicPurchase(p));
}
