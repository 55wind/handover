import { isConfigured } from '@/lib/merchants';
import { seedDemoCase } from '@/lib/seed';
import { store } from '@/lib/store';

export async function POST() {
  if (!isConfigured()) {
    return Response.json({ error: 'The PayPal sandbox is not configured on this server.' }, { status: 503 });
  }
  if (!store.takeDemoSlot()) {
    return Response.json({ error: "Today's demo allowance is used up. Please try again tomorrow." }, { status: 429 });
  }
  try {
    const c = await seedDemoCase();
    return Response.json({ caseId: c.id }, { status: 201 });
  } catch (e) {
    return Response.json({ error: `The sandbox estate could not be created: ${(e as Error).message}` }, { status: 502 });
  }
}
