import { runSettlement } from '@/lib/agent';
import { store } from '@/lib/store';

/** PayPal sends the buyer here after they approve. Settlement runs in this process and reports through the event stream. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = store.purchases.get(id);
  if (p && p.status === 'approving' && !p.running && store.takeRun()) void runSettlement(id).catch(() => {});
  return new Response(null, { status: 302, headers: { location: `/purchase/${encodeURIComponent(id)}` } });
}
