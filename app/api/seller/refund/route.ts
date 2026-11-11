import { readJson } from '@/lib/http';
import { refundSale } from '@/lib/shop';

/** Refunds a sale by its ledger reference (`ref`; `purchaseId` is accepted as an older name for the same value). */
export async function POST(req: Request) {
  const body = (await readJson(req, 2000)) as { ref?: unknown; purchaseId?: unknown } | null;
  const sale = await refundSale(body?.ref ?? body?.purchaseId);
  return typeof sale === 'string' ? Response.json({ error: sale }, { status: 400 }) : Response.json(sale);
}
