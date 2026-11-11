import { MERCHANTS, isFake, sharedSlot } from '@/lib/merchants';
import { store } from '@/lib/store';
import type { MerchantSlug } from '@/lib/types';

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const merchant = MERCHANTS[slug as MerchantSlug];
  if (!merchant) return Response.json({ error: 'Unknown merchant.' }, { status: 404 });
  return Response.json({
    merchant,
    // A case id opens that case, so the public ledger shows only its first characters.
    ledger: [...(store.ledger.get(merchant.slug) ?? [])].reverse().map((e) => ({ ...e, caseId: `${e.caseId.slice(0, 4)}…` })),
    fake: isFake(),
    sharedSlot: !isFake() && sharedSlot(),
  });
}
