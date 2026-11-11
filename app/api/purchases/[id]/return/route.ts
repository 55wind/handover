import { settleWhenApproved } from '@/lib/agent';

/**
 * PayPal sends the buyer here after they approve. Opening this address proves nothing, so settlement first asks PayPal
 * whether the order was approved. It runs in this process and reports through the event stream.
 */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  void settleWhenApproved(id).catch(() => {});
  return new Response(null, { status: 302, headers: { location: `/purchase/${encodeURIComponent(id)}` } });
}
