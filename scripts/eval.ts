// npm run eval: does the configured model do the three agents' jobs correctly, and what does it cost?
// Runs fixed cases against the real model (PayPal is the development stand-in, so no approval is needed), checks each
// result in code, and prints the pass rate, the tokens used and, for models whose price is on file, the cost per treat.
// Use it to pick the cheapest model that passes: LLM_MODEL=<id> npm run eval
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
process.env.PAYPAL_FAKE = '1';
delete process.env.LLM_SCRIPTED;

/** USD per million tokens: input, cached input, output (the providers' price pages, 2026-11-12). */
const PRICES: Record<string, [number, number, number]> = {
  'claude-haiku-5-5': [0.1, 0.01, 0.5],
  'claude-sonnet-5-5': [2, 0.2, 10],
  'claude-opus-5-5': [4, 0.4, 20],
  'gpt-5-nano': [0.05, 0.005, 0.4],
  'gpt-6-luna': [0.1, 0.01, 0.5],
  'gpt-6.1-terra': [1, 0.05, 5],
  'gpt-6.1-sol': [2, 0.1, 10],
};

interface ErrandCase {
  say: string;
  city: string;
  language: string; // language of the card for the recipient
  script?: RegExp; // characters the card must contain
  any?: string[]; // the dish should carry at least one of these tags
  avoid?: string[]; // and none of these
  maxUsd?: number; // the hold may not exceed this
}
const ERRANDS: ErrandCase[] = [
  { say: 'My mom in Haeundae, Busan has a cold. Get her something warm tonight.', city: 'Busan', language: 'ko', script: /[가-힣]/, any: ['warm'] },
  { say: 'My dad lives in Busan and it is his birthday today. He loves sweets.', city: 'Busan', language: 'ko', script: /[가-힣]/, any: ['celebration', 'sweet'] },
  { say: '부산 광안리에 사는 동생이 야근이 많대요. 든든한 걸로 한 끼 보내 주세요.', city: 'Busan', language: 'ko', script: /[가-힣]/, any: ['filling', 'warm'] },
  { say: 'My sister Ada in Yaba, Lagos has exams all week. Buy her a proper lunch, but she does not eat fish.', city: 'Lagos', language: 'en', any: ['filling', 'warm'], avoid: ['seafood'] },
  { say: 'A coffee for my friend Chidi in Lagos, he has a long day. At most 3 dollars.', city: 'Lagos', language: 'en', any: ['coffee'], maxUsd: 3 },
  { say: 'Mi abuela Elena en la Roma Norte, Ciudad de México, cumple años hoy. Mándale una rebanada de pastel.', city: 'Mexico City', language: 'es', any: ['celebration', 'sweet'] },
  { say: 'My friend in Mexico City is vegetarian and had a rough week. Something warm for lunch.', city: 'Mexico City', language: 'es', any: ['warm'], avoid: ['meat', 'seafood'] },
  { say: 'My lola in Maginhawa, Quezon City is sick with the flu. Something gentle, please.', city: 'Manila', language: 'tl', any: ['light', 'warm'] },
  { say: 'Breakfast for my brother Jun in Manila before his early shift.', city: 'Manila', language: 'tl', any: ['breakfast', 'coffee'] },
  { say: 'Moja babcia w Krakowie na Kazimierzu jest przeziębiona. Coś ciepłego dla niej.', city: 'Kraków', language: 'pl', any: ['warm'] },
  { say: 'My friend Ola in Kraków passed her exam. A slice of cake to celebrate, no more than 5 dollars.', city: 'Kraków', language: 'pl', any: ['celebration', 'sweet'], maxUsd: 5 },
  { say: 'Send my cousin in Paris a croissant.', city: '', language: '' }, // no shops there: nothing may be proposed
];

async function main() {
  const { defaultLlm, usage, modelName } = await import('../lib/agent');
  const { runErrand } = await import('../lib/errand');
  const { runHost } = await import('../lib/host');
  const { redeem } = await import('../lib/till');
  const { newTreat, startCheckout, placeHold } = await import('../lib/treats');
  const { itemOf, shopById } = await import('../lib/shops');
  const { backend } = await import('../lib/paypal');
  const fake = await import('../lib/paypal-fake');
  const model = modelName();
  const claude = !!process.env.ANTHROPIC_API_KEY;
  if (!claude && !process.env.OPENAI_API_KEY) {
    console.log('No language model is configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.local.');
    process.exit(1);
  }
  console.log(`model: ${model}   paypal: development stand-in\n`);
  try {
    await defaultLlm([{ role: 'system', content: 'Answer with the single word ok.' }, { role: 'user', content: 'ok?' }], []);
  } catch (e) {
    console.log(`The model cannot be reached, so nothing was evaluated: ${(e as Error).message}`);
    process.exit(1);
  }
  let pass = 0;
  let total = 0;
  const check = (label: string, problems: string[]) => {
    total++;
    if (!problems.length) pass++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${label}${problems.length ? `\n        ${problems.join('\n        ')}` : ''}`);
  };
  const tagsOf = (shopId?: string, itemId?: string) => itemOf(shopById(shopId), itemId)?.tags ?? [];

  // ---- the errand agent ----
  console.log('Errand agent: one sentence in, a fitting treat out');
  const before = { ...usage };
  for (const c of ERRANDS) {
    const t = newTreat({ name: 'Eval', language: 'en' });
    if (typeof t === 'string') throw new Error(t);
    await runErrand(t.id, c.say, defaultLlm);
    const problems: string[] = [];
    const shop = shopById(t.shopId);
    if (!c.city) {
      if (shop) problems.push(`proposed ${shop.name} although no shop takes part there`);
    } else if (!shop || !t.itemId || !t.card || !t.price || !t.ceiling) {
      problems.push(`no treat was proposed. The agent said: ${t.errand.at(-1)?.text.slice(0, 160)}`);
    } else {
      const tags = tagsOf(t.shopId, t.itemId);
      if (shop.city !== c.city) problems.push(`shop is in ${shop.city}, expected ${c.city}`);
      if (c.any && !c.any.some((tag) => tags.includes(tag))) problems.push(`dish ${t.itemId} [${tags}] has none of [${c.any}]`);
      if (c.avoid?.some((tag) => tags.includes(tag))) problems.push(`dish ${t.itemId} [${tags}] has one of the tags to avoid [${c.avoid}]`);
      if (c.avoid?.includes('meat') && !tags.includes('vegetarian')) problems.push(`dish ${t.itemId} is not marked vegetarian`);
      if (c.maxUsd && Number(t.ceiling) > c.maxUsd) problems.push(`hold $${t.ceiling} is above the budget of $${c.maxUsd}`);
      if (t.to?.language.slice(0, 2) !== c.language) problems.push(`card language ${t.to?.language}, expected ${c.language}`);
      if (c.script && !c.script.test(t.card.forRecipient)) problems.push(`card is not written in the expected script: ${t.card.forRecipient}`);
      // Some languages write 3,53 for 3.53: the amount is the same.
      const reply = (t.errand.at(-1)?.text ?? '').replace(/([0-9]),([0-9][0-9])(?![0-9])/g, '$1.$2');
      // "5" is as good as "5.00".
      const states = (amount: string) => reply.includes(amount) || (amount.endsWith('.00') && new RegExp(`(^|[^0-9.,])${amount.slice(0, -3)}(?![0-9]|[.,][0-9])`).test(reply));
      if (!states(t.price) || !states(t.ceiling)) problems.push(`the reply does not state the price $${t.price} and the hold $${t.ceiling} that code worked out: ${reply.slice(0, 300)}`);
    }
    check(`${c.say.slice(0, 74)}  ->  ${shop ? `${t.itemId} @ ${shop.id}, $${t.price} / hold $${t.ceiling}` : 'nothing'}`, problems);
  }
  const errandCalls = usage.calls - before.calls;

  // ---- the host agent ----
  console.log('\nHost agent: the recipient talks, in her language, and never hears a price');
  const MONEY = /[$₩₦₱€]\s?\d|\d\s?(usd|dollars?|won|원|krw|naira|pesos?|zł|pln)\b/i;
  async function held(say: string) {
    const t = newTreat({ name: 'Ji-woo', language: 'en' });
    if (typeof t === 'string') throw new Error(t);
    await runErrand(t.id, say, defaultLlm);
    const started = await startCheckout(t);
    if (typeof started === 'string') throw new Error(started);
    fake.approve(t.paypal.orderId!, fake.WALLETS[0].id);
    await placeHold(t.id);
    await runHost(t.id, { greet: true }, defaultLlm);
    return t;
  }
  const mom = await held('My mom in Haeundae, Busan has a cold. Get her some abalone porridge tonight.');
  check('greeting is in Korean and names no amount', [...(/[가-힣]/.test(mom.host[0]?.text ?? '') ? [] : [`not Korean: ${mom.host[0]?.text}`]), ...(MONEY.test(mom.host[0]?.text ?? '') ? ['mentions an amount'] : [])]);
  await runHost(mom.id, { text: '해산물은 못 먹어요. 다른 걸로 바꿀 수 있을까요?' }, defaultLlm);
  check(`"I can't eat seafood" -> ${mom.itemId}`, [
    ...(tagsOf(mom.shopId, mom.itemId).includes('seafood') ? ['the dish still has seafood'] : []),
    ...(Number(mom.price) > Number(mom.ceiling) ? ['the new dish costs more than is held'] : []),
    ...(MONEY.test(mom.host.at(-1)?.text ?? '') ? [`the reply mentions an amount: ${mom.host.at(-1)?.text}`] : []),
  ]);
  await runHost(mom.id, { text: '이거 얼마짜리예요?' }, defaultLlm);
  check('"How much is this?" is not answered with an amount', MONEY.test(mom.host.at(-1)?.text ?? '') ? [`the reply mentions an amount: ${mom.host.at(-1)?.text}`] : []);
  await runHost(mom.id, { text: '고마워, 내일 점심에 갈게.' }, defaultLlm);
  check('a thank-you is passed on in the sender\'s language, and the visit is noted', [...(mom.thanks ? [] : ['no thank-you was passed on']), ...(mom.thanks && /[가-힣]/.test(mom.thanks.forSender) ? [`not translated: ${mom.thanks.forSender}`] : []), ...(mom.visit ? [] : ['the visit was not noted'])]);
  const no = await held('My sister Ada in Yaba, Lagos has exams all week. Buy her lunch.');
  await runHost(no.id, { text: "That is kind, but I'm out of town all week. Please tell him no, thank you." }, defaultLlm);
  check('a clear no releases the hold', [...(no.status === 'released' ? [] : [`status is ${no.status}`]), ...((await backend().getOrder(no.paypal.orderId!)).captureId ? ['money was taken'] : [])]);

  // ---- the till agent ----
  console.log('\nTill agent: the counter');
  const served = await redeem(mom.shopId!, mom.code, defaultLlm);
  const order = await backend().getOrder(mom.paypal.orderId!);
  check(`served: took $${order.capturedAmount} of $${order.amount}`, [
    ...(typeof served === 'string' ? [served] : []),
    ...(order.capturedAmount === mom.price ? [] : [`captured ${order.capturedAmount}, the dish costs ${mom.price}`]),
    ...(mom.outcome?.forShop && /[가-힣]/.test(mom.outcome.forShop) ? [] : [`the words for the shop are not Korean: ${mom.outcome?.forShop}`]),
    ...(mom.events.some((e) => e.actor === 'till') ? [] : ['the till agent took no part: the rules settled it']),
  ]);

  // ---- the bill ----
  console.log(`\n${pass} of ${total} checks passed.`);
  console.log(`tokens: ${usage.input} in (${usage.cacheRead} of them read from cache, ${usage.cacheWrite} written to cache), ${usage.output} out, in ${usage.calls} calls; ${(errandCalls / ERRANDS.length).toFixed(1)} calls per sender message.`);
  const price = PRICES[model];
  if (price) {
    const [inUsd, cachedUsd, outUsd] = price;
    // The Claude API counts cached tokens apart from input_tokens (and charges 1.25 times input to write them);
    // the OpenAI-style count of input tokens includes the cached ones.
    const fresh = claude ? usage.input : usage.input - usage.cacheRead;
    const cost = (fresh * inUsd + usage.cacheRead * cachedUsd + usage.cacheWrite * inUsd * 1.25 + usage.output * outUsd) / 1_000_000;
    console.log(`cost of this run at $${inUsd} in / $${outUsd} out per million tokens: $${cost.toFixed(4)}. It covers about ${ERRANDS.length + 2} treats' worth of work, so roughly $${(cost / (ERRANDS.length + 2)).toFixed(4)} a treat.`);
  } else console.log('No price is on file for this model, so no cost is worked out. Multiply the tokens by the provider\'s rates.');
  process.exit(pass === total ? 0 : 1);
}

main().catch((e) => {
  console.error('EVAL STOPPED');
  console.error(e);
  process.exit(1);
});
