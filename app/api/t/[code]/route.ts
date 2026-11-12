import { gone } from '@/lib/http';
import { store } from '@/lib/store';
import { expireIfDue, recipientView } from '@/lib/treats';

export async function GET(_: Request, { params }: { params: Promise<{ code: string }> }) {
  const t = store.byCode((await params).code);
  const view = t && recipientView(t);
  if (!t || !view) return gone();
  expireIfDue(t);
  return Response.json(view);
}
