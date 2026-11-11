import { applyDecisions, applyNotice, approve, readJson, type Change, type Notice } from '@/lib/cases';
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
  const body = (await readJson(req, 6_000_000)) as { notice?: Notice; decisions?: Change[]; approve?: boolean } | null;
  if (!body || typeof body !== 'object') return bad('The request was too large or not valid JSON.', 413);
  // Checked after the body is read, so nothing can start in between.
  if (c.running) return bad('Please wait for the current step to finish.', 409);

  const error =
    (body.notice && applyNotice(c, body.notice)) || (body.decisions && applyDecisions(c, body.decisions)) || (body.approve && approve(c)) || null;
  return error ? bad(error) : Response.json(publicCase(c));
}
