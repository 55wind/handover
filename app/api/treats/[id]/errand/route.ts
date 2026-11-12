import { runErrand } from '@/lib/errand';
import { gone, readJson } from '@/lib/http';
import { store } from '@/lib/store';
import { senderView } from '@/lib/treats';

/** One turn between the sender and the errand agent: `{ text }`. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = store.treats.get((await params).id);
  if (!t) return gone();
  const body = (await readJson(req, 4000)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 1500) : '';
  // Everything that would stop the agent is checked before a run is counted, so refused requests cost nothing.
  if (!text) return Response.json({ error: 'Please write something for the agent.' }, { status: 400 });
  if (t.status !== 'draft') return Response.json({ error: 'The payment has already started.' }, { status: 400 });
  if (t.running) return Response.json({ error: 'The agent is still answering.' }, { status: 409 });
  if (t.errand.length >= 30) return Response.json({ error: 'This conversation has reached its limit. Please start a new treat.' }, { status: 429 });
  if (!store.takeRun('errand')) return Response.json({ error: "Today's allowance for the agent is used up. Please come back tomorrow." }, { status: 429 });
  const error = await runErrand(t.id, text);
  return error ? Response.json({ error }, { status: 400 }) : Response.json(senderView(t));
}
