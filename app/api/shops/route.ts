import { FX, SHOPS, isFake, isScripted } from '@/lib/shops';
import { shopCard } from '@/lib/treats';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ shops: SHOPS.map(shopCard), fx: { date: FX.date, source: FX.source }, fake: isFake(), scripted: isScripted() });
}
