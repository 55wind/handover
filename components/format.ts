// Text helpers with no browser or React in them, so server pages and client components can both use them.

export const clock = (ts: string) => new Date(ts).toLocaleTimeString('en-GB');

const STAMP = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
/** "12 Nov, 03:41" in the reader's own time zone. */
export const stamp = (ts: string) => STAMP.format(new Date(ts));

/** Money as it is written everywhere on the sender's and the shop's pages: "$12.34". Empty when there is no amount. */
export const usd = (money: string | number | undefined | null) =>
  money === undefined || money === null || money === '' ? '' : `$${typeof money === 'number' ? money.toFixed(2) : money}`;

/** The first letter as a capital, for a name or a phrase that opens a sentence. */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "07:30-20:30" as it reads in a sentence: "07:30 to 20:30". */
export const hours = (h: string) => h.replace('-', ' to ');

/** A day and a time in the reader's language and time zone: "Sunday 15 November, 14:30". English if the language is unknown. */
export function dayAndTime(ts: string, language = 'en'): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  const how = { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' } as const;
  try {
    return new Intl.DateTimeFormat(language, how).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', how).format(date);
  }
}
