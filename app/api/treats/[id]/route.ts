import { gone } from '@/lib/http';
import { store } from '@/lib/store';
import { recheck } from '@/lib/till';
import { expireIfDue, senderView } from '@/lib/treats';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = store.treats.get((await params).id);
  if (!t) return gone();
  expireIfDue(t);
  void recheck(t).catch(() => {});
  return Response.json(senderView(t));
}
