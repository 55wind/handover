// npm run probe: checks on the real sandbox the three things the product rests on.
//   1. npx tsx scripts/probe.ts            creates a $5.00 order with intent AUTHORIZE and prints the approval link
//   2. open the link, log in as a sandbox buyer and approve (the page it returns to need not exist)
//   3. npx tsx scripts/probe.ts <orderId>  places the hold, takes $2.10 of it, shows that the rest is released,
//                                          and pays $2.10 to SHOP_PAYOUT_EMAIL
import { existsSync } from 'node:fs';
import { backend } from '../lib/paypal';
import { appUrl, isFake, shopPayoutEmail } from '../lib/shops';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

async function main() {
  if (isFake()) return console.log('PAYPAL_FAKE=1 is set, so there is nothing to probe: the fake is not PayPal. Unset it and run again.');
  const pp = backend(); // signs in on its first call; a sign-in failure is reported as such
  const orderId = process.argv[2];

  if (!orderId) {
    const made = await pp.createOrder({
      amount: '5.00',
      description: 'Have You Eaten? probe',
      reference: `probe-${Date.now()}`,
      returnUrl: `${appUrl()}/probe/approved`,
      cancelUrl: `${appUrl()}/probe/cancelled`,
    });
    console.log(`Signed in to the sandbox and created order ${made.orderId} for $5.00, intent AUTHORIZE.`);
    console.log(`Approval URL: ${made.approveUrl}`);
    console.log('Order as read back:', await pp.getOrder(made.orderId));
    console.log(`Next: open the approval URL, log in with a sandbox buyer and approve, then run: npx tsx scripts/probe.ts ${made.orderId}`);
    return;
  }

  process.env.PAYPAL_TRACE = process.env.PROBE_TRACE === '1' ? '1' : '';
  console.log('Order after approval:', await pp.getOrder(orderId));
  const held = await pp.authorizeOrder(orderId);
  console.log('Hold placed:', held);
  console.log('Order with the hold:', await pp.getOrder(orderId));
  const taken = await pp.captureAuthorization(held.authorizationId, `probe-capture-${orderId}`, '2.10');
  console.log('Took $2.10 of the $5.00:', taken);
  const after = await pp.getOrder(orderId);
  console.log('Order after the partial capture:', after);
  console.log(`Rest of the hold released: ${after.authorizationStatus === 'CAPTURED' ? 'yes, the authorization is closed' : `authorization status is ${after.authorizationStatus}`}`);
  const email = shopPayoutEmail();
  if (!email) return console.log('SHOP_PAYOUT_EMAIL is not set, so the payout was not tried.');
  try {
    console.log('Payout to the shop account:', await pp.payout({ email, amount: '2.10', note: 'Have You Eaten? probe', reference: `probe-${orderId}` }));
  } catch (e) {
    console.log(`Payout failed: ${(e as Error).message}`);
  }
}

main().catch((e) => console.log(`Failed: ${(e as Error).message}`));
