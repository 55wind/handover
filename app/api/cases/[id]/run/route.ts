import { runPhase } from '@/lib/agent';
import { store } from '@/lib/store';
import type { Phase } from '@/lib/types';

const PHASES: Phase[] = ['intake', 'plan', 'pause', 'resume', 'execute'];

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = store.cases.get(id);
  if (!c) return Response.json({ error: 'This case is no longer available.' }, { status: 404 });
  const { phase } = (await req.json().catch(() => ({}))) as { phase?: Phase };
  if (!phase || !PHASES.includes(phase)) return Response.json({ error: 'Unknown phase.' }, { status: 400 });
  if (c.running) return Response.json({ error: 'A run is already active for this case.' }, { status: 409 });
  if (phase === 'execute' && (c.tier !== 'verified' || !c.approvedAt)) {
    return Response.json({ error: 'The plan has to be approved first.' }, { status: 400 });
  }
  if (phase !== 'execute' && c.approvedAt) {
    return Response.json({ error: 'This case is already approved.' }, { status: 400 });
  }
  // Not awaited: the run continues in this process and reports through the event stream.
  void runPhase(id, phase);
  return Response.json({ ok: true }, { status: 202 });
}
