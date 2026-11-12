import { readJson } from '@/lib/http';
import { newTreat, senderView } from '@/lib/treats';

/** Opens a draft: the sender has not said anything yet. */
export async function POST(req: Request) {
  const body = (await readJson(req, 2000)) as { name?: unknown; language?: unknown } | null;
  const t = newTreat({ name: body?.name, language: body?.language });
  return typeof t === 'string' ? Response.json({ error: t }, { status: 503 }) : Response.json(senderView(t), { status: 201 });
}
