'use client';

import { useState } from 'react';
import { fromCents, priceFor, toCents } from '@/lib/pricing';
import type { Product, Rules } from '@/lib/types';
import { Bar, DIAL, Slider } from './ui';

// High, middle and low income, on four continents.
const CODES = ['US', 'DE', 'KR', 'BR', 'VN', 'IN', 'NG', 'NP'];

/** One product in eight countries, recomputed in the browser as the dial moves. Nothing here is saved. */
export function Compare({ product, rules, seller }: { product: Product; rules: Rules; seller: string }) {
  const [dial, setDial] = useState(rules.dial);
  const rows = CODES.flatMap((code) => priceFor(product, { ...rules, dial }, code) ?? []);
  const max = Math.max(...rows.map((r) => r.hoursAtList));
  const floor = fromCents(Math.ceil((toCents(product.listPrice) * rules.floorPercent) / 100));

  return (
    <div className="compare">
      <div className="compare__dial">
        <Slider id="dial" {...DIAL} value={dial} saved={rules.dial} onChange={setDial} />
        <p className="small">
          {dial === rules.dial ? (
            <span className="muted">
              This is {seller}’s own setting, {rules.dial}. Move the dial to see other settings.
            </span>
          ) : (
            <button className="link" type="button" onClick={() => setDial(rules.dial)}>
              Back to {seller}’s setting, {rules.dial}
            </button>
          )}
        </p>
      </div>

      <div>
        <p className="key small" aria-hidden="true">
          <span>
            <i className="key__list" /> Hours of average income at the list price
          </span>
          <span>
            <i className="key__fair" /> At the fair price
          </span>
        </p>
        <table className="ctable">
          <thead>
            <tr>
              <th scope="col">Country</th>
              <th scope="col">
                <span className="sr">Hours, drawn as lengths</span>
              </th>
              <th scope="col" className="r">
                Hours at ${product.listPrice}
              </th>
              <th scope="col" className="r">
                Fair price
              </th>
              <th scope="col" className="r">
                Hours at the fair price
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.country}>
                <th scope="row">{r.countryName}</th>
                <td className="ctable__bar">
                  <Bar list={r.hoursAtList} fair={r.hoursAtFair} max={max} />
                </td>
                <td className="r num" data-label={`hours at $${r.list}`}>
                  {r.hoursAtList.toFixed(1)}
                </td>
                <td className="r num ctable__fair">
                  {r.limitedBy === 'floor' && <small>floor </small>}${r.fair}
                </td>
                <td className="r num" data-label="hours at the fair price">
                  {r.hoursAtFair.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="small muted compare__note">
          Floor: {seller} never charges less than {rules.floorPercent}% of the list price, which is ${floor}. No price goes above the list price.
        </p>
      </div>
    </div>
  );
}
