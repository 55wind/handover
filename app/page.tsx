import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Compare } from '@/components/Compare';
import { hrs, place } from '@/components/format';
import data from '@/lib/income-data.json';
import { countries, priceFor } from '@/lib/pricing';
import { PRODUCTS, RULES, SELLER } from '@/lib/seller';

const TRY = ['VN', 'DE', 'BR', 'NP'];

const STEPS = [
  ['The payment is only held', 'Approving at PayPal authorises the amount. Nothing is taken yet.'],
  ['PayPal reports the wallet’s country', 'An agent reads which country the wallet is registered in. It asks PayPal, not the buyer.'],
  [
    'Taken if it matches, released if not',
    'A match captures the payment. A mismatch releases it: nothing is taken, and the buyer is shown the price for the wallet’s country.',
  ],
];

export default function Home() {
  const product = PRODUCTS[0];
  const seller = SELLER.name.split(' ')[0];
  const us = priceFor(product, RULES, RULES.referenceCountry)!;
  const vn = priceFor(product, RULES, 'VN')!;
  const longest = Math.max(us.hoursAtList, vn.hoursAtList);
  const length = (h: number) => ({ '--h': h, '--max': longest }) as CSSProperties;

  return (
    <>
      <section className="hero">
        <div className="container">
          <p className="hero__tag">
            <span className="tag num">${product.listPrice}</span>
            <span>
              The price tag on a video course, “{product.title}”. It reads the same in every country. What it costs does not.
            </span>
          </p>

          <h1>
            <span>
              {hrs(us.hoursAtList)} in {place(us.countryName)}.
            </span>
            <i className="hours" style={length(us.hoursAtList)} aria-hidden="true" />
            <span>
              {hrs(vn.hoursAtList)} in {place(vn.countryName)}.
            </span>
            <i className="hours" style={length(vn.hoursAtList)} aria-hidden="true" />
          </h1>
          <p className="small muted">
            One block is one hour of average income per person, from World Bank figures for {vn.year}.
          </p>

          <div className="hero__foot">
            <div className="stack">
              <p className="hero__pitch">
                <span>Priced in hours, not dollars.</span> <span>Proven by the wallet, not the IP address.</span>
              </p>
              <div className="actions">
                <Link className="btn" href={`/buy/${product.id}?country=VN`}>
                  Buy as someone in {vn.countryName}
                </Link>
                <Link className="btn btn--quiet" href="/seller">
                  What the seller sees
                </Link>
              </div>
            </div>
            <p>
              Fair Hour lets a small seller of digital goods quote each buyer a price that costs a comparable share of local
              income, inside limits the seller sets. PayPal confirms where the buyer’s wallet is registered before any money is
              taken.
            </p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="compare-h">
        <div className="container">
          <div className="head-split">
            <h2 id="compare-h">One course, eight countries</h2>
            <p>
              {SELLER.shop} in {SELLER.place} sells the course for ${product.listPrice}, a price set for {place(us.countryName)}.
              The seller chooses how far each country’s price moves toward costing the same hours.
            </p>
          </div>
          <Compare product={product} rules={RULES} seller={seller} />
        </div>
      </section>

      <section className="band" aria-labelledby="try-h">
        <div className="container">
          <div className="head-split">
            <h2 id="try-h">Try it from somewhere else</h2>
            <p>
              Pick a country and pay with a PayPal sandbox wallet. If the wallet is registered there, the payment is taken. If it
              is not, the payment is released and you are shown the price for the wallet’s own country.
            </p>
          </div>
          <ul className="index">
            {TRY.flatMap((code) => priceFor(product, RULES, code) ?? []).map((p) => (
              <li key={p.country}>
                <Link href={`/buy/${product.id}?country=${p.country}`}>
                  <span className="index__name">{p.countryName}</span>
                  <span className="num">
                    ${p.fair}: {hrs(p.hoursAtFair)} of average income, against {p.hoursAtList} at ${p.list}.
                  </span>
                  <span className="index__go">Buy as someone in {p.countryName}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="index__more">
            <Link href={`/buy/${product.id}`}>Choose any of {countries().length} countries</Link>
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="wallet-h">
        <div className="container">
          <div className="head-split">
            <h2 id="wallet-h">Proven by the wallet</h2>
            <p>
              A price that depends on where the buyer lives needs a way to check it. An IP address moves with a VPN. The country
              a PayPal wallet is registered in does not.
            </p>
          </div>
          <ol className="steps">
            {STEPS.map(([title, line]) => (
              <li key={title}>
                <h3>{title}</h3>
                <p>{line}</p>
              </li>
            ))}
          </ol>
          <dl className="limits">
            <div>
              <dt>What this does not stop</dt>
              <dd>
                A buyer paying with a wallet lent by someone in another country. Each wallet can buy a product once, which limits
                how far that goes.
              </dd>
            </div>
            <div>
              <dt>Who decides</dt>
              <dd>Code works out every amount and checks every match. The agent carries out the steps and cannot change either.</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="section" aria-labelledby="agent-h">
        <div className="container duo">
          <div className="stack">
            <h2 id="agent-h">When an AI agent does the shopping</h2>
            <p>
              An AI shopping agent has no location of its own: its requests come from a data centre, so a regional price based on
              the IP address tells the seller nothing. The wallet it pays with still belongs to a person, so agents use the same
              price desk over MCP at <span className="mono">/api/mcp</span>, with the same check before any money is taken.
            </p>
          </div>
          <div className="stack">
            <h2>What the seller sees</h2>
            <p>
              The rules {seller} set, what the shop’s prices cost in {countries().length} countries, every sale and every payment
              that was released.
            </p>
            <p>
              <Link href="/seller">Open the seller console</Link>
            </p>
          </div>
        </div>
      </section>

      <section className="source">
        <div className="container">
          <p className="small muted">
            Income figures: <a href={data.url}>World Bank, GNI per capita, Atlas method (current US$)</a>, retrieved {data.retrieved}.
            An hour here means an hour of average income per person, which is GNI per capita divided by 2,000. It is not a wage.
          </p>
        </div>
      </section>
    </>
  );
}
