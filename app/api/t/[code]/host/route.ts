import { runHost } from '@/lib/host';
import { gone, readJson } from '@/lib/http';
import { store } from '@/lib/store';
import { recipientView } from '@/lib/treats';

/** One turn between the recipient and the host agent: `{ text }`. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const t = store.byCode((await params).code);
  if (!t || !recipientView(t)) return gone();
  const body = (await readJson(req, 4000)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 1000) : '';
  if (!text) return Response.json({ error: 'Please write something for the host.' }, { status: 400 });
  if (t.status !== 'held') return Response.json({ error: 'This treat can no longer be changed.' }, { status: 400 });
  if (t.running) return Response.json({ error: 'The host is still answering.' }, { status: 409 });
  if (t.host.length >= 30) return Response.json({ error: 'This conversation has reached its limit. The treat is still yours: show the code at the counter.' }, { status: 429 });
  if (!store.takeRun('host')) return Response.json({ error: "Today's allowance for the host is used up. The treat is still yours: show the code at the counter." }, { status: 429 });
  const error = await runHost(t.id, { text });
  return error ? Response.json({ error }, { status: 400 }) : Response.json(recipientView(t));
}
