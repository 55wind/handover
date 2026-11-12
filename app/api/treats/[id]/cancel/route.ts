import { gone } from '@/lib/http';
import { store } from '@/lib/store';
import { releaseTreat, senderView } from '@/lib/treats';

/** The sender takes the treat back before it is used. The hold is released. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = store.treats.get((await params).id);
  if (!t) return gone();
  const error = await releaseTreat(t, 'You cancelled the treat. PayPal released the hold. Nothing was taken.', 'sender');
  return error ? Response.json({ error }, { status: 400 }) : Response.json(senderView(t));
}
