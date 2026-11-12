// Text helpers with no browser or React in them, so server pages and client components can both use them.

/** 1 becomes "1 hour", 17.7 becomes "17.7 hours". The sentence around it says these are hours of average income. */
export const hrs = (h: number) => `${h} ${h === 1 ? 'hour' : 'hours'}`;

/** A World Bank country name as it reads inside a sentence: "the United States", "Viet Nam". */
export const place = (name: string) =>
  /^(United|Netherlands|Philippines|Maldives|Seychelles|Comoros|Isle|West Bank)|(Republic|Islands|Federation)$/.test(name) ? `the ${name}` : name;

export const clock = (ts: string) => new Date(ts).toLocaleTimeString('en-GB');

const STAMP = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** "12 Nov, 03:41" in the reader's own time zone. */
export const stamp = (ts: string) => STAMP.format(new Date(ts));
