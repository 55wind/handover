import { isFake, isScripted } from '@/lib/shops';
import { ledger } from '@/lib/treats';

export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json({ ...ledger(), fake: isFake(), scripted: isScripted() });
}
