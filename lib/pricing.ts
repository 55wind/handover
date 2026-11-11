import data from './income-data.json';
import type { CountryCode, OrderView, Price, Product, Purchase, Rules } from './types';

type Row = { name: string; gniPerCapita: number; year: number };
const table: Record<string, Row> = data.countries;

// Upper-casing also keeps inherited keys such as "constructor" out of reach.
const row = (country: CountryCode): Row | undefined => table[String(country).toUpperCase()];
const nameOf = (country: CountryCode) => row(country)?.name ?? String(country).toUpperCase();
const perHourCents = (r: Row) => Math.round((r.gniPerCapita * 100) / 2000);
const hours = (cents: number, r: Row) => Math.round((cents / perHourCents(r)) * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n || 0));
/** Cents of an optional amount. Missing, malformed and negative all count as zero. */
const given = (s?: string) => {
  const n = toCents(s ?? '');
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function toCents(s: string): number {
  return Math.round(Number(s) * 100);
}

export function fromCents(n: number): string {
  return (n / 100).toFixed(2);
}

export function countries(): { code: CountryCode; name: string }[] {
  return Object.entries(table)
    .map(([code, r]) => ({ code, name: r.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export function incomePerHourCents(country: CountryCode): number | null {
  const r = row(country);
  return r ? perHourCents(r) : null;
}

export function hoursFor(cents: number, country: CountryCode): number | null {
  const r = row(country);
  return r ? hours(cents, r) : null;
}

export function priceFor(product: Product, rules: Rules, country: CountryCode): Price | null {
  const here = row(country);
  const ref = row(rules.referenceCountry);
  if (!here || !ref) return null;
  const listCents = toCents(product.listPrice);
  const floorCents = Math.ceil((listCents * clamp(rules.floorPercent, 1, 100)) / 100);
  let fairCents = Math.round(listCents * (here.gniPerCapita / ref.gniPerCapita) ** (clamp(rules.dial, 0, 100) / 100));
  let limitedBy: Price['limitedBy'] = null;
  if (fairCents > listCents) {
    fairCents = listCents;
    limitedBy = 'list';
  } else if (fairCents < floorCents) {
    fairCents = floorCents;
    limitedBy = 'floor';
  }
  return {
    country: country.toUpperCase(),
    countryName: here.name,
    year: here.year,
    incomePerHour: fromCents(perHourCents(here)),
    list: fromCents(listCents),
    fair: fromCents(fairCents),
    hoursAtList: hours(listCents, here),
    hoursAtFair: hours(fairCents, here),
    limitedBy,
  };
}

export function worldTable(product: Product, rules: Rules): Price[] {
  // Lowest income first: that is where the list price costs the most hours.
  return Object.keys(table)
    .sort((a, b) => table[a].gniPerCapita - table[b].gniPerCapita)
    .flatMap((code) => priceFor(product, rules, code) ?? []);
}

export function amountDue(fair: string, help: string | undefined, gift: string): string {
  const fairCents = toCents(fair);
  const helpCents = Math.min(given(help), Math.max(0, fairCents - 100)); // the buyer still pays at least one dollar
  return fromCents(fairCents - helpCents + given(gift));
}

export function helpLimitCents(
  product: Product,
  rules: Rules,
  fair: string,
  poolAvailableCents: number,
  grantsThisMonth: number,
  withProof = false,
): { maxCents: number; why: string } {
  const { perMonth } = rules.help;
  // A document that supports what the buyer said raises the seller's cap. The pool and the one-dollar minimum still apply.
  const maxPercent = withProof ? rules.help.maxPercentWithProof : rules.help.maxPercent;
  if (grantsThisMonth >= perMonth)
    return { maxCents: 0, why: `The seller allows help ${perMonth} times a month, and this month's limit has been reached.` };
  const cap = Math.round((toCents(product.listPrice) * maxPercent) / 100);
  const maxCents = Math.max(0, Math.min(cap, poolAvailableCents, toCents(fair) - 100));
  const why =
    poolAvailableCents <= 0
      ? 'The pool is empty, so no help can be given right now.'
      : maxCents === cap
        ? `The seller allows at most ${maxPercent}% of the list price ${withProof ? 'with a supporting document' : 'on what a buyer says alone'}, which is $${fromCents(cap)}.`
        : maxCents === poolAvailableCents
          ? `The pool holds $${fromCents(poolAvailableCents)}, so that is the most that can be given.`
          : `The buyer still pays at least $1.00, so the most that can be given is $${fromCents(maxCents)}.`;
  return { maxCents, why };
}

export interface CaptureInput {
  purchase: Purchase;
  order: OrderView;
  alreadyBought: boolean;
}
export type CaptureDecision =
  | { capture: true }
  | { capture: false; code: 'not_approved' | 'no_country' | 'country_mismatch' | 'already_bought' | 'amount_mismatch'; reason: string };

export function captureDecision({ purchase, order, alreadyBought }: CaptureInput): CaptureDecision {
  const no = (code: Extract<CaptureDecision, { capture: false }>['code'], reason: string): CaptureDecision => ({ capture: false, code, reason });
  const quoted = purchase.quote.price.country;
  if (!order.authorizationId || !['CREATED', 'PENDING'].includes(order.authorizationStatus ?? ''))
    return no('not_approved', 'PayPal is not holding an approved payment for this purchase, so there is nothing to collect.');
  if (!order.payerCountry) return no('no_country', 'PayPal did not report which country this wallet is in, so the price cannot be confirmed.');
  // ponytail: codes are compared as PayPal sends them. PayPal can report China as "C2", which will not match a "CN" quote; add an alias map if such wallets matter.
  if (order.payerCountry.toUpperCase() !== quoted.toUpperCase())
    return no('country_mismatch', `PayPal reports this wallet is in ${nameOf(order.payerCountry)}. The price was quoted for ${nameOf(quoted)}.`);
  if (alreadyBought) return no('already_bought', 'This wallet has already bought this product. Each wallet can buy it once.');
  if (order.amount !== undefined && toCents(order.amount) !== toCents(purchase.amount))
    return no('amount_mismatch', `PayPal is holding $${order.amount}, but the amount agreed for this purchase is $${purchase.amount}.`);
  return { capture: true };
}
