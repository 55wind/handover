'use client';

import { useState } from 'react';
import { MERCHANTS } from '@/lib/merchants';
import type { Period, Tier } from '@/lib/types';

const LEAD = new RegExp(`^(?:${Object.values(MERCHANTS).map((m) => m.name).join('|')}): (.)`);

/** A desk's sentence opens with its merchant's name. Where a column beside it already gives the name, drop it. */
export const withoutMerchant = (s: string) => s.replace(LEAD, (_, first: string) => first.toUpperCase());

export const TIER: Record<Tier, string> = {
  filed: 'Notice filed. The document has not been matched yet, so only reversible steps are available.',
  verified: 'Document matched (demo-grade check).',
};

/** Money arrives as a decimal string in USD. Sums are done in whole cents. */
export const cents = (s: string) => Math.round(Number(s) * 100);
export const dollars = (n: number) => `$${(n / 100).toFixed(2)}`;

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const utc = (ymd: string) => new Date(`${ymd}T00:00:00Z`);

/** "2026-11-02" to "2 Nov 2026". Anything that is not a date comes back unchanged. */
export function day(ymd: string) {
  const d = utc(ymd);
  return Number.isNaN(d.getTime()) ? ymd : DAY.format(d);
}

/** A period's `end` is exclusive, so the last day shown is the day before it. */
export function period(p: Period) {
  const last = new Date(utc(p.end).getTime() - 86_400_000);
  return `${day(p.start)} to ${Number.isNaN(last.getTime()) ? p.end : DAY.format(last)}`;
}

export const clock = (ts: string) => new Date(ts).toLocaleTimeString('en-GB');

/** "ACTIVE" or "APPROVAL_PENDING" from PayPal, in sentence case. */
export const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase().replaceAll('_', ' ');

// A PayPal id: ten or more capitals, digits and hyphens, with at least one of each of the first two.
const ID = /\b((?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{9,})\b/;

/** Sets any PayPal id inside a sentence in the monospace face. */
export const withIds = (text: string) =>
  text.split(ID).map((part, i) => (i % 2 ? <span key={i} className="mono">{part}</span> : part));

export function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  return (
    <>
      <button className="id" type="button" onClick={copy} aria-label={`Copy ${value}`} title="Copy">
        {value}
      </button>
      <span className="small muted" role="status">
        {copied && 'Copied'}
      </span>
    </>
  );
}
