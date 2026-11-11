import { validatePlan, type PlanRow } from '@/lib/guard';
import { MERCHANTS } from '@/lib/merchants';
import { publicCase, store } from '@/lib/store';
import type { Action, Case } from '@/lib/types';

type Ctx = { params: Promise<{ id: string }> };
const bad = (error: string, status = 400) => Response.json({ error }, { status });

export async function GET(_: Request, { params }: Ctx) {
  const c = store.cases.get((await params).id);
  return c ? Response.json(publicCase(c)) : bad('This case is no longer available.', 404);
}

interface Notice {
  fullName?: unknown;
  emails?: unknown;
  dateOfDeath?: unknown;
  representative?: { name?: unknown; relation?: unknown; email?: unknown };
  wishes?: unknown;
  documentDataUrl?: unknown;
  documentText?: unknown;
}
interface Body {
  notice?: Notice;
  decisions?: { itemId: string; action: Action; refundCaptureIds?: string[] }[];
  approve?: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim().length <= max ? v.trim() : null);

/** Returns an error sentence, or null after applying the notice to the case. */
function applyNotice(c: Case, n: Notice): string | null {
  const fullName = text(n.fullName, 120);
  if (!fullName) return 'Please give the full name of the person who died.';
  const emails = Array.isArray(n.emails) ? n.emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean) : [];
  if (!emails.length || emails.length > 5 || !emails.every((e) => EMAIL.test(e))) return 'Please give between one and five valid email addresses.';
  const dod = text(n.dateOfDeath, 10);
  if (!dod || !/^\d{4}-\d{2}-\d{2}$/.test(dod) || Number.isNaN(Date.parse(dod)) || dod > new Date().toISOString().slice(0, 10)) {
    return 'Please give the date of death. It cannot be in the future.';
  }
  const rep = { name: text(n.representative?.name, 120), relation: text(n.representative?.relation, 60), email: text(n.representative?.email, 200) };
  if (!rep.name || !rep.relation || !rep.email || !EMAIL.test(rep.email)) return 'Please give your name, your relation to the person, and a valid email.';
  const wishes = text(n.wishes ?? '', 2000);
  if (wishes === null) return 'Please keep the wishes under 2,000 characters.';
  const docText = text(n.documentText ?? '', 8000);
  if (docText === null) return 'The document text is too long.';
  let dataUrl: string | undefined;
  if (n.documentDataUrl) {
    // ponytail: size and type are checked, content is not scanned; acceptable for a sandbox demo.
    if (typeof n.documentDataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(n.documentDataUrl) || n.documentDataUrl.length > 5_600_000) {
      return 'The document image must be a PNG, JPEG or WebP under 4 MB.';
    }
    dataUrl = n.documentDataUrl;
  }
  c.deceased = { fullName, emails, dateOfDeath: dod };
  c.representative = { name: rep.name, relation: rep.relation, email: rep.email };
  c.wishes = wishes;
  c.document = { text: docText || undefined, dataUrl: dataUrl ?? c.document.dataUrl, mismatches: [] };
  c.tier = 'filed';
  c.status = 'notice';
  c.items = [];
  c.notes = [];
  return null;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const c = store.cases.get((await params).id);
  if (!c) return bad('This case is no longer available.', 404);
  if (c.running) return bad('Please wait for the current step to finish.', 409);
  const body = (await req.json().catch(() => ({}))) as Body;

  if (body.notice) {
    if (c.approvedAt) return bad('This case is already approved.');
    const error = applyNotice(c, body.notice);
    if (error) return bad(error);
    store.emit(c.id, { actor: 'family', type: 'status', summary: `Notice filed by ${c.representative.name}.` });
  }

  if (body.decisions) {
    if (c.status !== 'review' || c.approvedAt) return bad('The plan can only be changed while it is under review.');
    const changes = body.decisions;
    const rows: PlanRow[] = c.items.map((item) => {
      const d = changes.find((x) => x.itemId === item.id);
      return d
        ? { item_id: item.id, action: d.action, refund_capture_ids: d.refundCaptureIds ?? [], reason: 'Chosen by the family.' }
        : { item_id: item.id, action: item.decided!.action, refund_capture_ids: item.decided!.refunds.map((r) => r.captureId), reason: 'Unchanged.' };
    });
    const { decisions, errors } = validatePlan(rows, c.items, MERCHANTS);
    if (errors.length) return bad(errors.join(' '));
    for (const item of c.items) {
      const d = decisions.get(item.id);
      if (d) item.decided = d;
    }
    store.emit(c.id, { actor: 'family', type: 'status', summary: `${c.representative.name} changed the plan.` });
  }

  if (body.approve) {
    if (c.tier !== 'verified') return bad('The document has to be matched before anything irreversible can be approved.');
    if (c.status !== 'review' || !c.items.length) return bad('There is no plan to approve yet.');
    c.approvedAt ??= new Date().toISOString();
    store.emit(c.id, { actor: 'family', type: 'status', summary: `Plan approved by ${c.representative.name}.` });
  }

  return Response.json(publicCase(c));
}
