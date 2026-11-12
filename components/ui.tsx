'use client';

import { useState } from 'react';

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

/** The sentence the server gave for a failed call, or a plain one when it gave none. */
export const errorOf = (r: { data: any }, fallback = FAILED): string => (typeof r.data?.error === 'string' && r.data.error ? r.data.error : fallback);

// A PayPal id: ten or more capitals, digits and hyphens, with at least one of each of the first two.
const ID = /\b((?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9][A-Z0-9-]{9,})\b/;

/** Sets any PayPal id inside a sentence in the monospace face. */
export const withIds = (text: string) =>
  text.split(ID).map((part, i) => (i % 2 ? <span key={i} className="mono">{part}</span> : part));

/** A PayPal id that copies itself when pressed, and says so. */
export function CopyId({ value }: { value: string }) {
  const [copied, copy] = useCopy(value);
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

/** True for a moment after `copy` put the value on the clipboard. */
export function useCopy(value: string): [boolean, () => void] {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  return [copied, copy];
}
