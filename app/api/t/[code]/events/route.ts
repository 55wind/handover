import { gone } from '@/lib/http';
import { store } from '@/lib/store';
import { recipientView } from '@/lib/treats';

export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const t = store.byCode((await params).code);
  if (!t || !recipientView(t)) return gone();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let off = () => {};
      let beat: ReturnType<typeof setInterval> | undefined;
      const stop = () => {
        off();
        clearInterval(beat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      // A write to a stream the browser has left throws; that ends this stream and nothing else.
      const write = (text: string) => {
        try {
          controller.enqueue(enc.encode(text));
        } catch {
          stop();
        }
      };
      const send = (data: unknown) => write(`data: ${JSON.stringify(data)}\n\n`);
      send({ view: recipientView(t) });
      off = store.subscribe(t.id, (event, current) => send({ view: recipientView(current) }));
      beat = setInterval(() => write(': keep-alive\n\n'), 20_000);
      req.signal.addEventListener('abort', stop);
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
  });
}
