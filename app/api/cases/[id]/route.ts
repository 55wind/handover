import { applyDecisions, applyNotice, approve, type Change, type Notice } from '@/lib/cases';
import { publicCase, store } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };
const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(_: Request, { params }: Ctx) {
  const c = store.cases.get((await params).id);
  return c ? Response.json(publicCase(c)) : bad('This case is no longer available.', 404);
}

export async function PATCH(req: Request, { params }: Ctx) {
  const c = store.cases.get((await params).id);
  if (!c) return bad('This case is no longer available.', 404);
  if (c.running) return bad('Please wait for the current step to finish.', 409);
  const body = (await req.json().catch(() => ({}))) as { notice?: Notice; decisions?: Change[]; approve?: boolean };

  const error =
    (body.notice && applyNotice(c, body.notice)) || (body.decisions && applyDecisions(c, body.decisions)) || (body.approve && approve(c)) || null;
  return error ? bad(error) : Response.json(publicCase(c));
}
