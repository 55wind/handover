import { PRODUCTS, RULES, SELLER, isFake, isScripted } from '@/lib/seller';
import { sales } from '@/lib/shop';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ seller: SELLER, products: PRODUCTS, rules: RULES, pool: store.pool, sales: sales(), fake: isFake(), scripted: isScripted() });
}
