import { finalizeTakeOvers } from '@/lib/agent';
import { publicCase, store } from '@/lib/store';

/** Checks whether the family member has approved any pending take-over at PayPal, and completes those that are. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = store.cases.get(id);
  if (!c) return Response.json({ error: 'This case is no longer available.' }, { status: 404 });
  await finalizeTakeOvers(id);
  return Response.json(publicCase(c));
}
