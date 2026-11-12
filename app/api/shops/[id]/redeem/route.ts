import { defaultLlm } from '@/lib/agent';
import { readJson } from '@/lib/http';
import { isConfigured, shopById } from '@/lib/shops';
import { store } from '@/lib/store';
import { redeem } from '@/lib/till';

/** The counter: a recipient shows a code. Answers when the payment is settled, with what to serve or why not. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const shop = shopById((await params).id);
  if (!shop) return Response.json({ error: 'There is no such shop.' }, { status: 404 });
  if (!isConfigured()) return Response.json({ error: 'The PayPal sandbox is not configured on this server.' }, { status: 503 });
  const body = (await readJson(req, 2000)) as { code?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '';
  if (!code) return Response.json({ error: 'Please enter the code the customer shows.' }, { status: 400 });
  // Past the day's allowance of model runs the rules settle it, so nobody is left standing at a counter.
  const live = store.byCode(code)?.status === 'held';
  const r = await redeem(shop.id, code, live && store.takeRun('till') ? defaultLlm : null);
  return typeof r === 'string' ? Response.json({ error: r }, { status: 400 }) : Response.json(r);
}
