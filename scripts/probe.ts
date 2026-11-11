// npm run probe: tries each seeding primitive once per sandbox app and prints what works.
import { existsSync } from 'node:fs';
import { MERCHANTS, SLUGS, credentialSlot, isFake } from '../lib/merchants';
import { probe } from '../lib/seed';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

async function main() {
  if (isFake()) console.log('PAYPAL_FAKE=1: this probes the in-memory fake, not PayPal.');
  const probed = new Map<number, string>(); // slot -> merchant that probed it
  for (const slug of SLUGS) {
    const who = `${MERCHANTS[slug].name} (slot ${credentialSlot(slug)})`;
    const sharedWith = probed.get(credentialSlot(slug));
    if (sharedWith && !isFake()) {
      console.log(`${who}: shares its sandbox app with ${sharedWith}, not probed again`);
      continue;
    }
    probed.set(credentialSlot(slug), MERCHANTS[slug].name);
    try {
      for (const [primitive, verdict] of Object.entries(await probe(slug))) console.log(`${who} ${primitive}: ${verdict}`);
    } catch (e) {
      console.log(`${who}: ${(e as Error).message}`);
    }
  }
}

main();
