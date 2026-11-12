// npx tsx scripts/say.ts "<a sender's sentence>": runs one sentence through the errand agent with the configured
// model and prints what it answered and proposed. Nothing reaches PayPal.
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
process.env.PAYPAL_FAKE = '1';

async function main() {
  const { runErrand } = await import('../lib/errand');
  const { newTreat } = await import('../lib/treats');
  const { modelName, usage } = await import('../lib/agent');
  const t = newTreat({ name: 'A friend', language: 'en' });
  if (typeof t === 'string') throw new Error(t);
  await runErrand(t.id, process.argv[2] ?? 'My mom in Busan has a cold. Get her something warm tonight.');
  console.log(`model: ${modelName()}`);
  console.log(`reply: ${t.errand.at(-1)?.text}`);
  console.log(`treat: ${t.itemId} @ ${t.shopId} | price $${t.price} | hold $${t.ceiling} | for ${JSON.stringify(t.to)}`);
  console.log(`card:  ${JSON.stringify(t.card)}`);
  console.log(`why:   ${t.reason}`);
  console.log(`tokens: ${usage.input} in, ${usage.cacheRead} from cache, ${usage.cacheWrite} to cache, ${usage.output} out, ${usage.calls} calls`);
  process.exit(0);
}

main();
