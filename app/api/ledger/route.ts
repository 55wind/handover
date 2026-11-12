import { isFake, isScripted } from '@/lib/shops';
import { store } from '@/lib/store';
import { recheck } from '@/lib/till';
import { expireIfDue, ledger } from '@/lib/treats';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Looking at the ledger is when treats that ran out are released and results PayPal had not confirmed are asked about again.
  for (const t of store.treats.values()) {
    expireIfDue(t);
    void recheck(t).catch(() => {});
  }
  return Response.json({ ...ledger(), fake: isFake(), scripted: isScripted() });
}
