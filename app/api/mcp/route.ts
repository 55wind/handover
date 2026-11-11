import { readJson } from '@/lib/http';
import { handleRpc } from '@/lib/mcp';

type Message = Parameters<typeof handleRpc>[0];

// MCP over Streamable HTTP, stateless: each POST carries JSON-RPC and gets JSON back. No server-initiated stream.
export async function POST(req: Request) {
  const body = (await readJson(req, 100_000)) as Message | Message[] | null;
  if (body === null) {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  }
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map(handleRpc))).filter(Boolean);
    return replies.length ? Response.json(replies) : new Response(null, { status: 202 });
  }
  const reply = await handleRpc(body);
  return reply ? Response.json(reply) : new Response(null, { status: 202 });
}

const notAllowed = () => new Response(null, { status: 405, headers: { allow: 'POST' } });
export const GET = notAllowed;
export const DELETE = notAllowed;
