import type { Product, Rules } from './types';

/** The one seller in this demo. Fictional. */
export const SELLER = { name: 'Mina Park', shop: 'Mina Park Lettering', place: 'Seoul' };

export const PRODUCTS: Product[] = [
  { id: 'lettering', title: 'Hand lettering basics', blurb: 'A four-hour video course with printable practice sheets.', listPrice: '44.00' },
  { id: 'brushes', title: 'Brush pack for tablets', blurb: 'Forty lettering brushes and a short guide.', listPrice: '12.00' },
];

export const RULES: Rules = {
  referenceCountry: 'US',
  dial: 50,
  floorPercent: 15,
  help: { maxPercent: 20, maxPercentWithProof: 50, perMonth: 30 },
};

export const productById = (id: string) => PRODUCTS.find((p) => p.id === id);

export const isFake = () => process.env.PAYPAL_FAKE === '1';
/** Development only: a scripted stand-in replaces the language model. */
export const isScripted = () => process.env.LLM_SCRIPTED === '1';
export const isConfigured = () => isFake() || (!!process.env.PAYPAL_CLIENT_ID && !!process.env.PAYPAL_CLIENT_SECRET);
/** Where PayPal sends the buyer back. RENDER_EXTERNAL_URL is set by the host. */
export const appUrl = () => process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
