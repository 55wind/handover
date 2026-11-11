import Link from 'next/link';
import { DemoButton } from '@/components/DemoButton';
import { MERCHANTS, SLUGS } from '@/lib/merchants';

const STEPS = [
  ['One notice', 'The name, the date, your wishes and one document. Filed once, for every participating merchant.'],
  ['A plan you approve', 'Each payment gets a proposed action and a reason. Change any row before you approve.'],
  ['Done and proven', 'Closed, refunded, handed over or waived. Every result is read back from PayPal before a row says done.'],
];

const SAFETY = [
  ['Reversible first', 'Until the document is matched, the agent can only pause a subscription, and undo the pause.'],
  [
    'Rules enforced in code',
    'Each merchant’s desk checks every action in code before it reaches PayPal. The customer must match, the plan must be approved, and a refund cannot exceed what the policy allows.',
  ],
  [
    'Refunds return to the payer',
    'A refund can only go back to the payment method that paid. A notice cannot redirect money to whoever filed it.',
  ],
  ['Read back from PayPal', 'After each action the result is read again from PayPal. Only then is it reported as done.'],
  [
    'What it does not cover',
    'A false notice could still cause refunds to the original payer, a waived invoice and cancelled subscriptions, at the merchant’s cost. So irreversible actions need a matched document, and a real deployment needs real proof-of-death checking, which this build does not have.',
  ],
];

export default function Home() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <h1>
            <span>One notice</span> settles every payment a person left behind.
          </h1>
          <div className="hero__side">
            <p className="lead">An executor agent finds each one and carries out the plan the family approves.</p>
            <DemoButton />
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="head-split">
            <h2>When someone dies, their payments keep running.</h2>
            <p>
              The family files one notice. An agent finds what the person was paying for at participating merchants and
              proposes what to do with each item. After the family approves, it carries the plan out on the PayPal
              sandbox, inside each merchant’s rules.
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

      <section className="section">
        <div className="container rows">
          <div className="rows__head">
            <h2>How it stays safe</h2>
            <p>Safety comes from reversibility and from code, not from trusting the model.</p>
          </div>
          <dl className="rows__body">
            {SAFETY.map(([title, line]) => (
              <div key={title}>
                <dt>{title}</dt>
                <dd>{line}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="band">
        <div className="container">
          <div className="head-split">
            <h2>See what the merchants see</h2>
            <p>Each merchant sets its own policy and keeps a ledger of every action taken on its account.</p>
          </div>
          <ul className="index">
            {SLUGS.map((slug) => (
              <li key={slug}>
                <Link href={`/merchant/${slug}`}>
                  <span className="index__name">{MERCHANTS[slug].name}</span>
                  <span>{MERCHANTS[slug].blurb}</span>
                  <span className="index__go">Open the console</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </>
  );
}
