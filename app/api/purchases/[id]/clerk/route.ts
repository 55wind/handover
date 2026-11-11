import { runClerk } from '@/lib/agent';
import { gone, readJson } from '@/lib/http';
import { publicPurchase, store } from '@/lib/store';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = store.purchases.get((await params).id);
  if (!p) return gone();
  const body = (await readJson(req, 6000)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 1500) : '';
  if (!text) return Response.json({ error: 'Please write something for the clerk.' }, { status: 400 });
  if (p.running) return Response.json({ error: 'The clerk is still answering.' }, { status: 409 });
  if (p.messages.length >= 24) {
    return Response.json({ error: 'This conversation has reached its limit. You can still pay at the price shown.' }, { status: 429 });
  }
  if (!store.takeRun()) {
    return Response.json({ error: "Today's allowance for the clerk is used up. You can still pay at the price shown." }, { status: 429 });
  }
  const error = await runClerk(p.id, text);
  return error ? Response.json({ error }, { status: 400 }) : Response.json(publicPurchase(p));
}
