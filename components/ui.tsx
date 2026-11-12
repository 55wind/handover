'use client';

import { useState, type CSSProperties } from 'react';

export const FAILED = 'That did not go through. Try again in a moment.';

/** GET without a body, POST with one. A network failure comes back as status 0, never as a throw. */
export async function api(path: string, body?: unknown): Promise<{ status: number; data: any }> {
  try {
    const r = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  } catch {
    return { status: 0, data: null };
  }
}

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

/**
 * Hours drawn as lengths on one scale. The outline is what the list price costs, the solid bar what the fair
 * price costs. `max` is the number of hours that fills the track.
 */
export function Bar({ list, fair, max }: { list: number; fair: number; max: number }) {
  return (
    <span className="bar" aria-hidden="true" style={{ '--list': list / max, '--fair': fair / max } as CSSProperties}>
      <i className="bar__list" />
      <i className="bar__fair" />
    </span>
  );
}

export const DIAL = { label: 'Fairness dial', lo: '0: the same dollars everywhere', hi: '100: the same hours everywhere' };

/** A setting from 0 to 100. The tick at `saved` marks where the seller left it, so a preview can be compared with it. */
export function Slider(p: { id: string; label: string; lo: string; hi: string; value: number; saved: number; unit?: string; onChange: (n: number) => void }) {
  return (
    <div className="dial">
      <div className="split">
        <label htmlFor={p.id}>{p.label}</label>
        <output htmlFor={p.id} className="dial__value num">
          {p.value}
          {p.unit}
        </output>
      </div>
      <div className="dial__track" style={{ '--at': p.saved } as CSSProperties}>
        <input id={p.id} type="range" min={0} max={100} value={p.value} onChange={(e) => p.onChange(Number(e.target.value))} aria-describedby={`${p.id}-ends`} />
      </div>
      <div className="dial__ends small" id={`${p.id}-ends`}>
        <span>{p.lo}</span>
        <span>{p.hi}</span>
      </div>
    </div>
  );
}
