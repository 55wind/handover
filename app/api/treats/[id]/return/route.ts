import { runHost } from '@/lib/host';
import { store } from '@/lib/store';
import { placeHold } from '@/lib/treats';

/**
 * PayPal sends the sender here after they approve. Opening this address proves nothing, so the hold is placed only
 * if PayPal itself reports the order as approved. Then the host agent writes its greeting for the recipient.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  void (async () => {
    if ((await placeHold(id)) && store.takeRun('host')) await runHost(id, { greet: true });
  })().catch(() => {});
  return new Response(null, { status: 302, headers: { location: `/treat/${encodeURIComponent(id)}` } });
}
