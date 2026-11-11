import { readJson } from '@/lib/http';
import { makeQuote } from '@/lib/shop';

export async function POST(req: Request) {
  const body = (await readJson(req, 2000)) as { productId?: unknown; country?: unknown } | null;
  const quote = makeQuote(body?.productId, body?.country);
  return typeof quote === 'string' ? Response.json({ error: quote }, { status: 400 }) : Response.json(quote);
}
