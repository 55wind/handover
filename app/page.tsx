import Link from 'next/link';
import { cap, hours } from '@/components/format';
import { fromCents, localLabel, usdCents } from '@/lib/rules';
import { CITIES, FX, HOLD_DAYS, SHOPS } from '@/lib/shops';

// The same question, as it is asked in each city where a shop takes part.
const GREETINGS = [
  { lang: 'ko', say: '밥 먹었어?', where: 'Korean, in Busan' },
  { lang: 'pcm', say: 'You don chop?', where: 'Nigerian Pidgin, in Lagos' },
  { lang: 'es', say: '¿Ya comiste?', where: 'Spanish, in Mexico City' },
  { lang: 'tl', say: 'Kumain ka na ba?', where: 'Tagalog, in Manila' },
  { lang: 'pl', say: 'Jadłeś już?', where: 'Polish, in Kraków' },
];

const STEPS = [
  [
    'Say it in one sentence',
    'Tell the agent who it is for, where they are and what is going on. It picks a dish at a shop near them and writes your card in their language.',
  ],
  [
    'They eat',
    'They get a link with your card and a code. They can swap the dish or say no, and they never see a price. At the shop they show the code.',
  ],
  [
    'You pay only then',
    `PayPal holds the money until the counter takes the price of what they ate. The rest is released. If they do not go within ${HOLD_DAYS} days, nothing is taken.`,
  ],
];

const DIFFERENCE = [
  ['When the money leaves you', 'At once, in full.', 'When they eat, and only the price of what they ate. Until then PayPal holds it.'],
  ['Where it works', 'At one chain.', 'At any neighbourhood shop with a PayPal account.'],
  ['Across borders', 'Usually one country and one currency.', 'You pay in dollars. The shop is paid for a dish priced in its own currency.'],
  ['If it is never used', 'The money is gone.', 'The hold is released. Nothing is taken.'],
];

const TOOLS = ['find_treats', 'send_treat', 'treat_status'];

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container hero__grid">
          <div className="hero__text">
            <h1>Tell an agent who you miss.</h1>
            <p className="lead">It buys them a meal at the shop next door, and you pay only when they eat.</p>
            <div className="actions">
              <Link className="btn" href="/send">
                Send a treat
              </Link>
              <Link className="btn btn--quiet" href="/ledger">
                See every treat
              </Link>
            </div>
          </div>
          <figure className="greetings">
            <figcaption>In many languages, “have you eaten?” is how people say they care.</figcaption>
            <ul>
              {GREETINGS.map((g) => (
                <li key={g.lang}>
                  <span className="greetings__say" lang={g.lang}>
                    {g.say}
                  </span>
                  <span className="small muted">{g.where}</span>
                </li>
              ))}
            </ul>
          </figure>
        </div>
      </section>

      <section className="section" aria-labelledby="how-h">
        <div className="container">
          <div className="head-split">
            <h2 id="how-h">How it works</h2>
            <p>
              “My mom in Busan has a cold, get her something warm tonight.” That is the whole order. You do not need to know the
              shops, the menu or the language.
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
        </div>
      </section>

      <section className="section" aria-labelledby="difference-h">
        <div className="container">
          <div className="head-split">
            <h2 id="difference-h">Not a gift card</h2>
            <p>The money is held, not taken. PayPal keeps it on your account until the meal is eaten.</p>
          </div>
          <table className="versus">
            <thead>
              <tr>
                <td />
                <th scope="col">A gift card</th>
                <th scope="col">Have You Eaten?</th>
              </tr>
            </thead>
            <tbody>
              {DIFFERENCE.map(([what, card, here]) => (
                <tr key={what}>
                  <th scope="row">{what}</th>
                  <td data-label="A gift card">{card}</td>
                  <td data-label="Have You Eaten?">{here}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="band" aria-labelledby="shops-h">
        <div className="container">
          <div className="head-split">
            <h2 id="shops-h">
              {CITIES.length} cities, {SHOPS.length} shops
            </h2>
            <p>
              Every shop and shopkeeper here is made up. The cities and the dishes are real. The dollar price comes from the
              shop’s own price and a fixed table of exchange rates dated {FX.date}.
            </p>
          </div>
          {CITIES.map((city, i) => (
            <section className="city" key={city} aria-labelledby={`city-${i}`}>
              <h3 id={`city-${i}`}>{city}</h3>
              <ul className="shops">
                {SHOPS.filter((s) => s.city === city).map((shop) => (
                  <li key={shop.id}>
                    <div className="shops__name">
                      <p className="shops__local" lang={shop.language}>
                        {shop.localName}
                      </p>
                      <p className="small muted">
                        {shop.localName !== shop.name ? `${shop.name}, ${shop.kind}` : cap(shop.kind)} in {shop.area}. Open{' '}
                        {hours(shop.hours)}.
                      </p>
                      <p className="small">
                        <Link href={`/shop/${shop.id}`}>{shop.keeper}’s counter</Link>
                      </p>
                    </div>
                    <table className="menu num">
                      <caption className="sr">Some dishes at {shop.name}</caption>
                      <tbody>
                        {shop.menu.slice(0, 3).map((item) => (
                          <tr key={item.id}>
                            <th scope="row">
                              <span lang={shop.language}>{item.localName}</span>
                              {item.localName !== item.name && <span className="small muted">{item.name}</span>}
                            </th>
                            <td>{localLabel(shop, item)}</td>
                            <td>${fromCents(usdCents(shop, item))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="roles-h">
        <div className="container duo">
          <div className="stack">
            <h2 id="roles-h">Try all three roles</h2>
            <p>
              Send a treat and approve it with a PayPal sandbox account. Open the recipient’s link, change the dish or say thank
              you. Then stand at the shop’s counter and enter the code. The ledger shows every treat with PayPal’s own ids.
            </p>
            <div className="actions">
              <Link className="btn" href="/send">
                Send a treat
              </Link>
              <Link className="btn btn--quiet" href="/ledger">
                Open the ledger
              </Link>
            </div>
          </div>
          <div className="stack">
            <h2>For AI assistants</h2>
            <p>
              A personal AI assistant can send a treat for its user. The same desk is available over MCP at{' '}
              <span className="mono">/api/mcp</span>, with three tools.
            </p>
            <ul className="tools">
              {TOOLS.map((tool) => (
                <li key={tool} className="mono">
                  {tool}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="source">
        <div className="container">
          <p className="small muted">
            Everything here runs on the PayPal sandbox. No real money moves. The shops and the people are fictional. Exchange
            rates are a fixed table dated {FX.date} (from {FX.source}), not live rates.
          </p>
        </div>
      </section>
    </>
  );
}
