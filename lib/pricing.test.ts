import assert from 'node:assert/strict';
import { test } from 'node:test';
import data from './income-data.json';
import {
  amountDue,
  captureDecision,
  countries,
  fromCents,
  helpLimitCents,
  hoursFor,
  incomePerHourCents,
  priceFor,
  toCents,
  worldTable,
} from './pricing';
import type { OrderView, Product, Purchase, Rules } from './types';

const course: Product = { id: 'lettering', title: 'Hand lettering basics', blurb: '', listPrice: '44.00' };
const rules: Rules = { referenceCountry: 'US', dial: 50, floorPercent: 15, help: { maxPercent: 20, perMonth: 30 } };
const table: Record<string, { name: string; gniPerCapita: number; year: number }> = data.countries;
const codes = Object.keys(table);

function purchase(country = 'VN', amount = '10.41'): Purchase {
  const price = priceFor(course, rules, country);
  assert.ok(price);
  return {
    id: 'p1',
    createdAt: '2026-11-12T00:00:00Z',
    productId: course.id,
    quote: { id: 'q1', productId: course.id, price, createdAt: '2026-11-12T00:00:00Z', expiresAt: '2026-11-12T00:30:00Z' },
    buyer: { language: 'en', viaAgent: false },
    gift: '0.00',
    amount,
    status: 'settling',
    running: true,
    paypal: {},
    messages: [],
    events: [],
  };
}
const approved: OrderView = {
  status: 'COMPLETED',
  amount: '10.41',
  payerId: 'PAYER1',
  payerCountry: 'VN',
  authorizationId: 'AUTH1',
  authorizationStatus: 'CREATED',
};
const decide = (order: Partial<OrderView> = {}, alreadyBought = false, p = purchase()) =>
  captureDecision({ purchase: p, order: { ...approved, ...order }, alreadyBought });
const refusal = (d: ReturnType<typeof captureDecision>) => {
  assert.equal(d.capture, false);
  return d as Extract<typeof d, { capture: false }>;
};

test('cents round-trip', () => {
  assert.equal(toCents('44.00'), 4400);
  assert.equal(fromCents(4400), '44.00');
  for (const s of ['0.00', '0.05', '1.10', '10.41', '19.99', '1234.56']) assert.equal(fromCents(toCents(s)), s);
  for (const n of [0, 1, 99, 100, 1041, 123456]) assert.equal(toCents(fromCents(n)), n);
});

test('a country without an income figure gives null everywhere', () => {
  assert.equal(incomePerHourCents('ZZ'), null);
  assert.equal(hoursFor(4400, 'ZZ'), null);
  assert.equal(priceFor(course, rules, 'ZZ'), null);
  assert.equal(priceFor(course, { ...rules, referenceCountry: 'ZZ' }, 'VN'), null);
  assert.ok(!worldTable(course, rules).some((p) => p.country === 'ZZ'));
});

test('income per hour and hours, with country codes in any case', () => {
  assert.equal(incomePerHourCents('VN'), 249); // 4970 * 100 / 2000 = 248.5
  assert.equal(incomePerHourCents('vn'), 249);
  assert.equal(incomePerHourCents('US'), 4441);
  assert.equal(hoursFor(4400, 'VN'), 17.7);
  assert.equal(hoursFor(4400, 'vn'), 17.7);
  assert.equal(hoursFor(4400, 'US'), 1);
});

test('countries lists every country with a figure, by name', () => {
  const list = countries();
  assert.equal(list.length, codes.length);
  assert.deepEqual(list.map((c) => c.code).sort(), [...codes].sort());
  assert.deepEqual(list.find((c) => c.code === 'VN'), { code: 'VN', name: 'Viet Nam' });
  for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].name.localeCompare(list[i].name, 'en') <= 0);
});

test('the reference country pays the list price', () => {
  for (const dial of [0, 50, 100]) {
    const p = priceFor(course, { ...rules, dial }, 'US');
    assert.ok(p);
    assert.equal(p.fair, '44.00');
    assert.equal(p.list, '44.00');
    assert.equal(p.limitedBy, null);
    assert.equal(p.hoursAtFair, p.hoursAtList);
  }
});

test('dial 50, floor 15, reference US: a $44.00 product in VN, DE and IN', () => {
  assert.deepEqual(priceFor(course, rules, 'vn'), {
    country: 'VN',
    countryName: 'Viet Nam',
    year: 2025,
    incomePerHour: '2.49',
    list: '44.00',
    fair: '10.41', // 4400 * sqrt(4970 / 88810) = 1040.88
    hoursAtList: 17.7,
    hoursAtFair: 4.2,
    limitedBy: null,
  });
  // DE: 4400 * sqrt(60200 / 88810) = 3622.60. IN: 4400 * sqrt(2760 / 88810) = 775.67.
  for (const [code, fair, hoursAtFair] of [['VN', '10.41', 4.2], ['DE', '36.23', 1.2], ['IN', '7.76', 5.6]] as const) {
    const p = priceFor(course, rules, code);
    assert.ok(p);
    assert.equal(p.fair, fair);
    assert.equal(p.fair, fromCents(Math.round(4400 * Math.sqrt(table[code].gniPerCapita / table.US.gniPerCapita))));
    assert.equal(p.hoursAtFair, hoursAtFair);
    assert.equal(p.limitedBy, null);
    assert.equal(p.countryName, table[code].name);
    assert.equal(p.year, table[code].year);
  }
});

test('dial 0 gives the list price everywhere', () => {
  const rows = worldTable(course, { ...rules, dial: 0 });
  assert.equal(rows.length, codes.length);
  for (const p of rows) {
    assert.equal(p.fair, '44.00');
    assert.equal(p.limitedBy, null);
  }
});

test('dial 100 gives the same hours everywhere the limits allow', () => {
  const full = { ...rules, dial: 100 };
  const [de, kr, us] = ['DE', 'KR', 'US'].map((c) => priceFor(course, full, c));
  assert.ok(de && kr && us);
  assert.equal(de.limitedBy, null);
  assert.equal(kr.limitedBy, null);
  assert.equal(de.fair, '29.83'); // 4400 * 60200 / 88810 = 2982.55
  assert.ok(Math.abs(de.hoursAtFair - kr.hoursAtFair) <= 0.1);
  assert.ok(Math.abs(de.hoursAtFair - us.hoursAtFair) <= 0.1);
});

test('a richer country than the reference is limited by the list price', () => {
  const p = priceFor(course, rules, 'CH');
  assert.ok(p);
  assert.equal(p.fair, '44.00');
  assert.equal(p.limitedBy, 'list');
});

test('a very poor country is limited by the floor and pays exactly the floor', () => {
  const p = priceFor(course, rules, 'BI'); // 4400 * sqrt(240 / 88810) = 228.73, floor 660
  assert.ok(p);
  assert.equal(p.fair, '6.60');
  assert.equal(p.limitedBy, 'floor');
  assert.equal(p.hoursAtFair, 55);
  // the floor rounds up: 15% of 1299 is 194.85
  assert.equal(priceFor({ ...course, listPrice: '12.99' }, rules, 'BI')?.fair, '1.95');
});

test('dial and floor outside their ranges are clamped', () => {
  assert.equal(priceFor(course, { ...rules, dial: 150 }, 'DE')?.fair, '29.83');
  assert.equal(priceFor(course, { ...rules, dial: -20 }, 'VN')?.fair, '44.00');
  assert.equal(priceFor(course, { ...rules, floorPercent: 0 }, 'BI')?.fair, '2.29');
  assert.equal(priceFor(course, { ...rules, floorPercent: -5, dial: 100 }, 'BI')?.fair, '0.44');
  const p = priceFor(course, { ...rules, floorPercent: 500 }, 'VN');
  assert.equal(p?.fair, '44.00');
  assert.equal(p?.limitedBy, 'floor');
});

test('worldTable has one row per country, most hours first', () => {
  const rows = worldTable(course, rules);
  assert.deepEqual(rows.map((p) => p.country).sort(), [...codes].sort());
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].hoursAtList >= rows[i].hoursAtList);
  assert.equal(rows[0].country, 'BI');
  assert.deepEqual(rows.find((p) => p.country === 'VN'), priceFor(course, rules, 'VN'));
});

test('amountDue: fair, minus help, plus gift', () => {
  assert.equal(amountDue('10.41', undefined, '0.00'), '10.41');
  assert.equal(amountDue('10.41', '2.00', '5.00'), '13.41');
  assert.equal(amountDue('10.41', '50.00', '0.00'), '1.00'); // help bigger than the price
  assert.equal(amountDue('10.41', '9.80', '0.00'), '1.00'); // help that would leave 61 cents
  assert.equal(amountDue('10.41', '50.00', '3.00'), '4.00');
  assert.equal(amountDue('10.41', undefined, '-5.00'), '10.41');
  assert.equal(amountDue('10.41', '-3.00', '0.00'), '10.41');
  assert.equal(amountDue('10.41', 'a lot', 'plenty'), '10.41');
  assert.equal(amountDue('10.41', '', ''), '10.41');
  assert.equal(amountDue('0.50', '0.40', '0.00'), '0.50'); // a price under a dollar gets no help
});

test('helpLimitCents: the monthly number of grants is used up', () => {
  for (const n of [30, 31]) {
    const r = helpLimitCents(course, rules, '10.41', 10000, n);
    assert.equal(r.maxCents, 0);
    assert.match(r.why, /30 times a month/);
  }
  assert.ok(helpLimitCents(course, rules, '10.41', 10000, 29).maxCents > 0);
});

test('helpLimitCents: the seller, the pool or the last dollar decides', () => {
  assert.deepEqual(helpLimitCents(course, rules, '44.00', 10000, 0), {
    maxCents: 880,
    why: 'The seller allows at most 20% of the list price, which is $8.80.',
  });
  assert.deepEqual(helpLimitCents(course, rules, '10.41', 320, 0), {
    maxCents: 320,
    why: 'The pool holds $3.20, so that is the most that can be given.',
  });
  const dollar = helpLimitCents(course, rules, '6.60', 10000, 0);
  assert.equal(dollar.maxCents, 560);
  assert.match(dollar.why, /at least \$1\.00.*\$5\.60/);
});

test('helpLimitCents: an empty pool, and never negative', () => {
  const empty = helpLimitCents(course, rules, '10.41', 0, 0);
  assert.equal(empty.maxCents, 0);
  assert.match(empty.why, /pool is empty/);
  assert.equal(helpLimitCents(course, rules, '10.41', -500, 0).maxCents, 0);
  assert.equal(helpLimitCents(course, rules, '0.50', 10000, 0).maxCents, 0);
  assert.equal(helpLimitCents(course, { ...rules, help: { maxPercent: -10, perMonth: 30 } }, '10.41', 10000, 0).maxCents, 0);
});

test('captureDecision: captures when PayPal confirms the country, the wallet is new and the amount matches', () => {
  assert.deepEqual(decide(), { capture: true });
  assert.deepEqual(decide({ authorizationStatus: 'PENDING' }), { capture: true });
  assert.deepEqual(decide({ payerCountry: 'vn' }), { capture: true });
  assert.deepEqual(decide({ amount: undefined }), { capture: true });
  assert.deepEqual(decide({ amount: '10.410' }), { capture: true });
});

test('captureDecision: not approved', () => {
  assert.equal(refusal(decide({ authorizationId: undefined })).code, 'not_approved');
  assert.equal(refusal(decide({ authorizationStatus: undefined })).code, 'not_approved');
  assert.equal(refusal(decide({ authorizationStatus: 'VOIDED' })).code, 'not_approved');
  assert.equal(refusal(decide({ authorizationStatus: 'CAPTURED' })).code, 'not_approved');
});

test('captureDecision: PayPal gave no country', () => {
  assert.equal(refusal(decide({ payerCountry: undefined })).code, 'no_country');
  assert.equal(refusal(decide({ payerCountry: '' })).code, 'no_country');
});

test('captureDecision: the wallet is in another country', () => {
  const d = refusal(decide({ payerCountry: 'de' }));
  assert.equal(d.code, 'country_mismatch');
  assert.equal(d.reason, 'PayPal reports this wallet is in Germany. The price was quoted for Viet Nam.');
  // a country the table does not know is named by its code
  assert.match(refusal(decide({ payerCountry: 'zz' })).reason, /wallet is in ZZ\./);
});

test('captureDecision: already bought, and a different amount', () => {
  assert.equal(refusal(decide({}, true)).code, 'already_bought');
  const d = refusal(decide({ amount: '10.40' }));
  assert.equal(d.code, 'amount_mismatch');
  assert.match(d.reason, /\$10\.40.*\$10\.41/);
  assert.equal(refusal(decide({ amount: 'x' })).code, 'amount_mismatch');
});

test('captureDecision: the checks run in order', () => {
  const all = { authorizationId: undefined, payerCountry: 'DE', amount: '1.00' };
  assert.equal(refusal(decide(all, true)).code, 'not_approved');
  assert.equal(refusal(decide({ ...all, authorizationId: 'AUTH1', payerCountry: undefined }, true)).code, 'no_country');
  assert.equal(refusal(decide({ ...all, authorizationId: 'AUTH1' }, true)).code, 'country_mismatch');
  assert.equal(refusal(decide({ amount: '1.00' }, true)).code, 'already_bought');
  for (const d of [decide(all, true), decide({ payerCountry: undefined }), decide({}, true), decide({ amount: '1.00' })])
    assert.match(refusal(d).reason, /^[A-Z].*\.$/);
});
