/** Reads a JSON body of at most `max` characters. Null when it is too large or not JSON. */
export async function readJson(req: Request, max: number): Promise<unknown | null> {
  if (Number(req.headers.get('content-length') ?? 0) > max) return null;
  const body = await req.text();
  if (body.length > max) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

export const gone = () => Response.json({ error: 'This purchase is no longer available.' }, { status: 404 });
