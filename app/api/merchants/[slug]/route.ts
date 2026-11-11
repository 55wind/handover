import { MERCHANTS, isFake, sharedSlot } from '@/lib/merchants';
import { store } from '@/lib/store';
import type { MerchantSlug } from '@/lib/types';

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const merchant = MERCHANTS[slug as MerchantSlug];
  if (!merchant) return Response.json({ error: 'Unknown merchant.' }, { status: 404 });
  return Response.json({
    merchant,
    ledger: [...(store.ledger.get(merchant.slug) ?? [])].reverse(),
    fake: isFake(),
    sharedSlot: !isFake() && sharedSlot(),
  });
}
