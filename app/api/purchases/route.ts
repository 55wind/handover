import { readJson } from '@/lib/http';
import { openPurchase } from '@/lib/shop';
import { publicPurchase } from '@/lib/store';

export async function POST(req: Request) {
  const body = (await readJson(req, 2000)) as { quoteId?: unknown; language?: unknown; gift?: unknown } | null;
  const p = openPurchase({ quoteId: body?.quoteId, language: body?.language, gift: body?.gift });
  return typeof p === 'string' ? Response.json({ error: p }, { status: 400 }) : Response.json(publicPurchase(p), { status: 201 });
}
