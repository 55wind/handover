import { publicCase, store } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = store.cases.get(id);
  if (!c) return Response.json({ error: 'This case is no longer available.' }, { status: 404 });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(data)}\n\n`));
      send({ case: publicCase(c) });
      const off = store.subscribe(id, (event, current) => send({ event, case: publicCase(current) }));
      const beat = setInterval(() => controller.enqueue(enc.encode(': keep-alive\n\n')), 20_000);
      req.signal.addEventListener('abort', () => {
        off();
        clearInterval(beat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
  });
}
