import { readJson } from '@/lib/http';
import { refundSale } from '@/lib/shop';

export async function POST(req: Request) {
  const body = (await readJson(req, 2000)) as { purchaseId?: unknown } | null;
  const sale = await refundSale(body?.purchaseId);
  return typeof sale === 'string' ? Response.json({ error: sale }, { status: 400 }) : Response.json(sale);
}
