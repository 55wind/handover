import { shopById } from '@/lib/shops';
import { servedAt, shopCard } from '@/lib/treats';

export const dynamic = 'force-dynamic';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const shop = shopById((await params).id);
  if (!shop) return Response.json({ error: 'There is no such shop.' }, { status: 404 });
  return Response.json({ shop: shopCard(shop), served: servedAt(shop.id) });
}
