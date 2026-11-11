import type { Merchant, MerchantSlug } from './types';

export const MERCHANTS: Record<MerchantSlug, Merchant> = {
  lumen: {
    slug: 'lumen',
    name: 'Lumen Stream',
    blurb: 'Film and series streaming',
    policy: {
      prorataCurrentPeriod: false,
      waiveUndeliveredInvoices: false,
      allowTakeOver: true,
      summary:
        'We refund in full any period that starts after the date of death. A period already under way is not refunded. A family member may take over the plan.',
    },
  },
  ironwood: {
    slug: 'ironwood',
    name: 'Ironwood Gym',
    blurb: 'Neighbourhood gym',
    policy: {
      prorataCurrentPeriod: true,
      waiveUndeliveredInvoices: true,
      allowTakeOver: false,
      summary:
        'We refund any period that starts after the date of death, and the unused days of a prepaid period. Invoices for sessions not taken are waived. Memberships are personal and cannot be taken over.',
    },
  },
  harborlight: {
    slug: 'harborlight',
    name: 'Harbor Light Food Bank',
    blurb: 'Community food bank',
    policy: {
      prorataCurrentPeriod: false,
      waiveUndeliveredInvoices: false,
      allowTakeOver: true,
      summary:
        'Gifts made before the date of death are not refunded. A gift taken after it is returned if the family asks. A family member may continue the gift in their own name.',
    },
  },
};

export const SLUGS = Object.keys(MERCHANTS) as MerchantSlug[];

const SLOT: Record<MerchantSlug, 1 | 2 | 3> = { lumen: 1, ironwood: 2, harborlight: 3 };

export const isFake = () => process.env.PAYPAL_FAKE === '1';
export const isConfigured = () => isFake() || !!process.env.PAYPAL_1_CLIENT_ID;

const slotSet = (n: number) => !!process.env[`PAYPAL_${n}_CLIENT_ID`] && !!process.env[`PAYPAL_${n}_CLIENT_SECRET`];

/** The sandbox app a merchant uses. Merchants without their own app share slot 1. */
export function credentialSlot(slug: MerchantSlug): 1 | 2 | 3 {
  return slotSet(SLOT[slug]) ? SLOT[slug] : 1;
}

export function credentials(slug: MerchantSlug): { slot: 1 | 2 | 3; clientId: string; clientSecret: string } | null {
  const slot = credentialSlot(slug);
  const clientId = process.env[`PAYPAL_${slot}_CLIENT_ID`];
  const clientSecret = process.env[`PAYPAL_${slot}_CLIENT_SECRET`];
  return clientId && clientSecret ? { slot, clientId, clientSecret } : null;
}

/** True when at least two demo merchants run on the same sandbox account. The UI must say so. */
export const sharedSlot = () => new Set(SLUGS.map(credentialSlot)).size < SLUGS.length;
