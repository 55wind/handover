/** Reads a JSON body of at most `max` bytes. Null when it is too large or not JSON. */
export async function readJson(req: Request, max: number): Promise<unknown | null> {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  if (!req.body) return null;
  // The declared length can be missing or wrong, so the bytes are counted as they arrive and reading stops at the limit.
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      void reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

export const gone = () => Response.json({ error: 'This purchase is no longer available.' }, { status: 404 });
