// npm run probe: one $1.00 order on the real sandbox, to see what PayPal reports about the payer. It authorises and voids; it never captures.
import { existsSync } from 'node:fs';
import { backend } from '../lib/paypal';
import { appUrl, isFake } from '../lib/shops';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

async function main() {
  if (isFake()) return console.log('PAYPAL_FAKE=1 is set, so there is nothing to probe: the fake is not PayPal. Unset it and run again.');
  const pp = backend(); // signs in on its first call; a sign-in failure is reported as such
  const orderId = process.argv[2];

  if (!orderId) {
    const made = await pp.createOrder({
      amount: '1.00',
      description: 'Have You Eaten? probe',
      reference: 'probe',
      returnUrl: `${appUrl()}/probe/approved`,
      cancelUrl: `${appUrl()}/probe/cancelled`,
    });
    console.log(`Signed in to the sandbox and created order ${made.orderId} for $1.00, intent AUTHORIZE.`);
    console.log(`Approval URL: ${made.approveUrl}`);
    console.log('Order as read back:', await pp.getOrder(made.orderId));
    console.log(`Next: open the approval URL, log in with a sandbox buyer and approve (the page it returns to need not exist), then run: npx tsx scripts/probe.ts ${made.orderId}`);
    return;
  }

  process.env.PAYPAL_TRACE = '1'; // print PayPal's whole answer, so the country can be found if it is not where the app looks
  const order = await pp.getOrder(orderId);
  process.env.PAYPAL_TRACE = '';
  console.log('Order as the app reads it:', order);
  console.log(`Payer country PayPal reports: ${order.payerCountry ?? 'NONE. The app cannot work without it; look for the country in the answer printed above.'}`);
  const held = await pp.authorizeOrder(orderId);
  console.log('Authorized:', held);
  await pp.voidAuthorization(held.authorizationId);
  console.log('Voided. Order as read back:', await pp.getOrder(orderId));
}

main().catch((e) => console.log(`Failed: ${(e as Error).message}`));
