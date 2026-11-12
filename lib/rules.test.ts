import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ceilingCents, expiryFrom, fromCents, isExpired, localLabel, proposalDecision, redeemDecision, swapDecision, toCents, usdCents } from './rules';
import { FX, HOLD_DAYS, MAX_TREAT_CENTS, SHOPS, cityOf, itemOf, shopById, shopsNear } from './shops';
import type { OrderView, Treat } from './types';

const juk = shopById('haeundae-juk')!;
const abalone = itemOf(juk, 'abalone-juk')!;
const vegetable = itemOf(juk, 'vegetable-juk')!;
const bakery = shopById('dalmaji-bakery')!;
const fonda = shopById('fonda-lupita')!;

function treat(over: Partial<Treat> = {}): Treat {
  return {
    id: 't1',
    code: 'ABCD2345',
    ref: 'r1',
    createdAt: '2026-11-12T00:00:00Z',
    expiresAt: expiryFrom(Date.now()),
    viaAgent: false,
    from: { name: 'Ji-woo', language: 'en' },
    to: { name: 'Mom', place: 'Haeundae, Busan', language: 'ko' },
    shopId: juk.id,
    itemId: abalone.id,
    card: { forRecipient: '밥은 먹었어?', forSender: 'Have you eaten?' },
    price: fromCents(usdCents(juk, abalone)),
    ceiling: '14.00',
    status: 'held',
    running: false,
    paypal: { orderId: 'O1', authorizationId: 'A1' },
    errand: [],
    host: [],
    events: [],
    ...over,
  };
}
const held = (amount = '14.00'): OrderView => ({ status: 'COMPLETED', amount, authorizationId: 'A1', authorizationStatus: 'CREATED' });

test('money converts to cents and back without drift', () => {
  for (const s of ['0.00', '0.01', '10.48', '14.00', '39.99']) assert.equal(fromCents(toCents(s)), s);
});

test('an item costs its menu price at the dated rate, rounded up to a cent', () => {
  assert.equal(FX.perUsd.KRW, 1336.6);
  assert.equal(usdCents(juk, abalone), 1048); // 14,000 / 1336.6 = 10.4743...
  assert.equal(usdCents(juk, vegetable), 674); // 9,000 / 1336.6 = 6.7335...
  for (const shop of SHOPS) for (const item of shop.menu) {
    const cents = usdCents(shop, item);
    assert(cents > 0 && cents <= MAX_TREAT_CENTS, `${shop.id}/${item.id} costs $${fromCents(cents)}`);
    assert(cents / 100 >= item.localPrice / FX.perUsd[shop.currency] - 1e-9, 'never rounded down');
  }
});

test('local prices are written so they cannot be read as dollars', () => {
  assert.equal(localLabel(juk, abalone), '₩14,000');
  assert.equal(localLabel(fonda, itemOf(fonda, 'caldo-pollo')!), 'MX$95');
});

test('the hold is the budget when given, otherwise the price plus a quarter rounded up to a dollar', () => {
  assert.equal(ceilingCents(1048), 1400);
  assert.equal(ceilingCents(1048, 2000), 2000);
  assert.equal(ceilingCents(1048, 500), 1048, 'never below the item');
  assert.equal(ceilingCents(1048, 99999), MAX_TREAT_CENTS, 'never above the limit');
  assert.equal(ceilingCents(3900), MAX_TREAT_CENTS);
  assert.equal(ceilingCents(100), 200);
});

test('a treat lasts as long as PayPal honours the hold', () => {
  const now = Date.now();
  const t = treat({ expiresAt: expiryFrom(now) });
  assert.equal(Date.parse(t.expiresAt!) - now, HOLD_DAYS * 24 * 3600_000);
  assert.equal(isExpired(t, now + HOLD_DAYS * 24 * 3600_000 - 1), false);
  assert.equal(isExpired(t, now + HOLD_DAYS * 24 * 3600_000), true);
});

test('places are matched to the cities where shops take part', () => {
  assert.equal(cityOf('Haeundae, Busan'), 'Busan');
  assert.equal(cityOf('부산 해운대'), 'Busan');
  assert.equal(cityOf('CDMX'), 'Mexico City');
  assert.equal(cityOf('Paris'), undefined);
  assert.equal(shopsNear('Gwangan, Busan')[0].id, 'gwangan-gukbap', 'the neighbourhood named comes first');
  assert.deepEqual(shopsNear('Paris'), []);
});

test('a proposal needs a dish that exists', () => {
  assert.deepEqual(proposalDecision(juk, abalone), { ok: true, priceCents: 1048 });
  assert.equal(proposalDecision(juk, undefined).ok, false);
  assert.equal(proposalDecision(undefined, abalone).ok, false);
});

test('the recipient may change the treat only within what is held, in the same city, while it is held', () => {
  const t = treat();
  assert.deepEqual(swapDecision(t, juk, juk, vegetable), { ok: true, priceCents: 674 });
  assert.equal(swapDecision(t, juk, bakery, itemOf(bakery, 'yuja-tea')).ok, true, 'another shop in the same city');
  const cake = swapDecision(t, juk, bakery, itemOf(bakery, 'whole-cake'));
  assert(!cake.ok && cake.code === 'over_ceiling');
  const abroad = swapDecision(t, juk, fonda, itemOf(fonda, 'caldo-pollo'));
  assert(!abroad.ok && abroad.code === 'other_city');
  const late = swapDecision(treat({ expiresAt: new Date(Date.now() - 1).toISOString() }), juk, juk, vegetable);
  assert(!late.ok && late.code === 'expired');
  const used = swapDecision(treat({ status: 'enjoyed' }), juk, juk, vegetable);
  assert(!used.ok && used.code === 'not_held');
});

test('the counter takes the price of the dish, at the right shop, in time, only from a live hold', () => {
  const t = treat();
  assert.deepEqual(redeemDecision(t, juk.id, held()), { ok: true, cents: 1048 });
  const other = redeemDecision(t, bakery.id, held());
  assert(!other.ok && other.code === 'other_shop');
  const late = redeemDecision(treat({ expiresAt: new Date(Date.now() - 1).toISOString() }), juk.id, held());
  assert(!late.ok && late.code === 'expired');
  for (const status of ['VOIDED', 'CAPTURED', undefined]) {
    const gone = redeemDecision(t, juk.id, { ...held(), authorizationStatus: status });
    assert(!gone.ok && gone.code === 'no_hold', `hold ${status}`);
  }
  const small = redeemDecision(t, juk.id, held('5.00'));
  assert(!small.ok && small.code === 'hold_too_small');
  const over = redeemDecision(treat({ price: '20.00' }), juk.id, held('25.00'));
  assert(!over.ok && over.code === 'over_ceiling');
});
