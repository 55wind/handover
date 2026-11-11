import { runClerk } from '@/lib/clerk';
import { gone, readJson } from '@/lib/http';
import { publicPurchase, store } from '@/lib/store';

/** One turn with the clerk: `{greet: true}` to open the conversation, or `{text, documentDataUrl?}`. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = store.purchases.get((await params).id);
  if (!p) return gone();
  const body = (await readJson(req, 6_000_000)) as { text?: unknown; greet?: unknown; documentDataUrl?: unknown } | null;
  if (!body) return Response.json({ error: 'The message was too large or could not be read.' }, { status: 413 });
  const greet = body.greet === true;
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 1500) : '';
  let documentDataUrl: string | undefined;
  if (body.documentDataUrl) {
    // ponytail: type and size are checked, the content is not scanned; acceptable for a sandbox demo.
    if (typeof body.documentDataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(body.documentDataUrl) || body.documentDataUrl.length > 5_600_000) {
      return Response.json({ error: 'The document must be a PNG, JPEG or WebP image under 4 MB.' }, { status: 400 });
    }
    documentDataUrl = body.documentDataUrl;
  }
  if (!greet && !text && !documentDataUrl) return Response.json({ error: 'Please write something for the clerk.' }, { status: 400 });
  if (greet && p.messages.length) return Response.json(publicPurchase(p)); // already greeted
  // Everything that would stop the clerk is checked before a run is counted, so refused requests cost nothing.
  if (p.status !== 'open') return Response.json({ error: 'The payment has already started.' }, { status: 400 });
  if (p.running) return Response.json({ error: 'The clerk is still answering.' }, { status: 409 });
  if (p.messages.length >= 24) {
    return Response.json({ error: 'This conversation has reached its limit. You can still pay at the price shown.' }, { status: 429 });
  }
  if (!store.takeRun('clerk')) {
    return Response.json({ error: "Today's allowance for the clerk is used up. You can still pay at the price shown." }, { status: 429 });
  }
  const error = await runClerk(p.id, { text, greet, documentDataUrl });
  return error ? Response.json({ error }, { status: 400 }) : Response.json(publicPurchase(p));
}
