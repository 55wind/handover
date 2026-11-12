// Development and tests only. A fixed policy that stands in for the language model so the three agents and the UI
// can be exercised without an LLM key. Enabled in the server by LLM_SCRIPTED=1, which also shows the development
// banner. Never enable it on a hosted demo. It matches keywords; it does not understand anything.
import type { Llm, LlmCall } from './agent';

type Result = { ok: boolean; error?: string; data?: Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

const CARD: Record<string, string> = {
  ko: '밥은 먹었어? 오늘은 내가 살게. 따뜻하게 먹고 푹 쉬어.',
  es: '¿Ya comiste? Hoy invito yo. Come algo rico y descansa.',
  tl: 'Kumain ka na ba? Sagot ko na ito. Kain ka nang mabuti at magpahinga.',
  pl: 'Jadłaś już? Dziś ja stawiam. Zjedz coś ciepłego i odpocznij.',
  en: 'Have you eaten? This one is on me. Eat well and rest.',
};
const HELLO: Record<string, (to: string, from: string, dish: string, shop: string, until: string) => string> = {
  ko: (to, from, dish, shop, until) => `${to}님, ${from}님이 ${shop}의 ${dish}을(를) 보냈어요. ${until}까지 가게 계산대에서 이 화면의 코드만 보여 주시면 됩니다.`,
  es: (to, from, dish, shop, until) => `Hola, ${to}. ${from} te invita ${dish} en ${shop}. Solo enseña el código de esta página en el mostrador antes del ${until}.`,
  tl: (to, from, dish, shop, until) => `Kumusta, ${to}. Pinadalhan ka ni ${from} ng ${dish} sa ${shop}. Ipakita lang ang code sa pahinang ito sa counter bago mag-${until}.`,
  pl: (to, from, dish, shop, until) => `Dzień dobry, ${to}. ${from} stawia Ci ${dish} w ${shop}. Wystarczy pokazać kod z tej strony przy kasie do ${until}.`,
  en: (to, from, dish, shop, until) => `Hello, ${to}. ${from} has sent you ${dish} at ${shop}. Just show the code on this page at the counter before ${until}.`,
};
const PLACE = /busan|pusan|부산|haeundae|해운대|gwangan|korea|lagos|yaba|nigeria|mexico city|cdmx|roma norte|mexico|manila|quezon city|maginhawa|philippines|krak[oó]w|kazimierz|poland/i;
const WHO = /\bmy (mom|mum|mother|dad|father|sister|brother|friend|grandma|grandmother|grandpa|son|daughter|wife|husband|aunt|uncle|cousin)\b/i;

export function scripted(): Llm {
  let n = 0;
  const call = (name: string, args: unknown = {}): LlmCall => ({ id: `call_${++n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } });

  return async (messages, tools) => {
    // Lets a person watching the UI see each step arrive.
    await new Promise((r) => setTimeout(r, Number(process.env.LLM_SCRIPTED_DELAY ?? 0)));
    const names = new Set(tools.map((t) => t.function.name));
    const turn = messages.filter((m) => m.role === 'assistant').length;
    const results = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content) as Result);
    const ctx = JSON.parse((messages[1] as { content: string }).content);
    const system = (messages[0] as { content: string }).content;

    // ---- errand: the sender ----
    if (names.has('propose_treat')) {
      const all = (ctx.conversation as { from: string; text: string }[]).filter((m) => m.from === 'person').map((m) => m.text).join(' ');
      const place = all.match(PLACE)?.[0];
      if (!place) return { content: 'Where are they? Tell me the city or the neighbourhood, and what is going on.' };
      if (turn === 0) return { content: null, tool_calls: [call('find_shops', { place })] };
      const found = results[0]?.data;
      if (!found?.city) return { content: `No shop takes part there yet. Shops take part in ${(found?.cities_taking_part ?? []).join(', ')}.` };
      if (turn === 1) {
        const want = /cold|sick|flu|unwell|ill\b|fever|아프|감기/i.test(all)
          ? ['warm', 'light']
          : /birthday|celebrat|anniversar|생일/i.test(all)
            ? ['celebration']
            : /lunch|dinner|meal|hungry|proper food|something to eat/i.test(all)
              ? ['filling', 'warm']
              : /exam|study|tired|night shift|work|deadline/i.test(all)
                ? ['coffee']
                : /breakfast|morning/i.test(all)
                  ? ['breakfast']
                  : ['warm'];
        const avoid = [/vegetarian|no meat/i.test(all) && 'meat', /no seafood|allergic to (fish|seafood|shellfish)/i.test(all) && 'seafood', /not spicy|no spice/i.test(all) && 'spicy'].filter(Boolean) as string[];
        const budget = all.match(/\$\s?(\d{1,2}(?:\.\d{1,2})?)/)?.[1];
        let best: { shop: any; item: any; score: number } | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
        for (const shop of found.shops) {
          for (const item of shop.menu) {
            if (avoid.some((tag) => item.tags.includes(tag)) || (avoid.includes('meat') && !item.tags.includes('vegetarian'))) continue;
            if (budget && Number(item.usd) > Number(budget)) continue;
            const score = want.filter((tag) => item.tags.includes(tag)).length * 2 + (shop.in_the_neighbourhood_named ? 1 : 0);
            if (!best || score > best.score) best = { shop, item, score };
          }
        }
        if (!best) return { content: 'Nothing on the menus there fits what you asked. Tell me what to relax: the budget or the kind of dish.' };
        const who = all.match(WHO)?.[1];
        const name = who ? who[0].toUpperCase() + who.slice(1) : 'your friend';
        return {
          content: null,
          tool_calls: [
            call('propose_treat', {
              shop_id: best.shop.shop_id,
              item_id: best.item.item_id,
              recipient_name: name,
              recipient_place: place,
              card_for_recipient: CARD[best.shop.language] ?? CARD.en,
              card_for_sender: CARD.en,
              reason: `${best.item.name} at ${best.shop.name}: ${best.item.about}`,
              ...(budget ? { budget_usd: budget } : {}),
            }),
          ],
        };
      }
      const r = results.at(-1);
      if (!r?.ok) return { content: `I could not set that up. ${r?.error ?? ''}` };
      return {
        content: `I chose ${r.data!.dish} at ${r.data!.shop}. It costs ${r.data!.local_price} there, which is $${r.data!.price_usd}. PayPal will hold $${r.data!.paypal_will_hold_usd} and take only the price when they eat; if it is not used in ${r.data!.good_for_days} days, nothing is taken. The card says: "${CARD.en}" Place the hold with the button, or tell me what to change.`,
      };
    }

    // ---- host: the recipient ----
    if (/You are the host/.test(system)) {
      const lang = ctx.recipient.language in HELLO ? ctx.recipient.language : 'en';
      if (ctx.start) return { content: HELLO[lang](ctx.recipient.name, ctx.sender.name, ctx.treat.dish_local_name, ctx.treat.shop_local_name, ctx.good_until) };
      const said = String(ctx.conversation.at(-1)?.text ?? '');
      const last = results.at(-1);
      if (/no,? thank|can.?t make it|cannot make it|not in town|decline|못 가|안 갈/i.test(said)) {
        if (turn === 0) return { content: null, tool_calls: [call('decline', { for_sender: `${ctx.recipient.name} cannot use the treat this time and thanks you for thinking of them.` })] };
        return { content: 'Understood. I have told them, and nothing is taken from them.' };
      }
      if (/can.?t eat|cannot eat|allergic|don.?t like|something else|vegetarian|no seafood|no meat|not spicy|못 먹|다른 걸/i.test(said)) {
        if (turn === 0) return { content: null, tool_calls: [call('other_options')] };
        if (turn === 1) {
          const avoid = [/seafood|fish|shellfish|해산물/i.test(said) && 'seafood', /meat|vegetarian|고기/i.test(said) && 'meat', /spicy|매운/i.test(said) && 'spicy'].filter(Boolean) as string[];
          const veg = /vegetarian|no meat/i.test(said);
          const options = (last?.data?.options ?? []) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
          const pick = options.find((o) => !avoid.some((tag) => o.tags.includes(tag)) && (!veg || o.tags.includes('vegetarian')) && o.tags.includes('warm')) ?? options.find((o) => !avoid.some((tag) => o.tags.includes(tag)));
          if (!pick) return { content: 'I am sorry, nothing else nearby fits. The treat stays as it is.' };
          return { content: null, tool_calls: [call('change_treat', { shop_id: pick.shop_id, item_id: pick.item_id })] };
        }
        return { content: last?.ok ? `Done. It is now ${last.data!.now.dish_local_name} at ${last.data!.now.shop_local_name}. Show the same code at the counter.` : `I could not change it. ${last?.error ?? ''}` };
      }
      if (/thank|고마|감사|gracias|salamat|dzi[eę]kuj/i.test(said)) {
        if (turn === 0) return { content: null, tool_calls: [call('send_thanks', { original: said, for_sender: said })] };
        return { content: 'I have passed that on.' };
      }
      if (/tomorrow|tonight|today|lunch|dinner|morning|evening|내일|오늘|저녁|점심/i.test(said)) {
        if (turn === 0) return { content: null, tool_calls: [call('note_visit', { when: said.slice(0, 80) })] };
        return { content: 'Noted. Show the code at the counter when you are there.' };
      }
      return { content: `It is a gift from ${ctx.sender.name}, already taken care of. Go to ${ctx.treat.shop_local_name} before ${ctx.good_until}, show the code on this page at the counter, and eat.` };
    }

    // ---- till: the counter ----
    if (turn === 0) return { content: 'Asking PayPal what it holds.', tool_calls: [call('read_order')] };
    if (turn === 1) return { content: 'Taking the price of the dish.', tool_calls: [call('take_payment')] };
    const took = results.some((r) => r.ok && (r.data?.taken_usd || r.data?.already_taken));
    if (turn === 2 && took) return { content: 'Paying the shop.', tool_calls: [call('pay_shop')] };
    return {
      content: null,
      tool_calls: [
        call('finish', {
          result: took ? 'served' : 'not_served',
          for_shop: took ? `PayPal has paid for ${ctx.dish.local_name}. Please serve ${ctx.recipient}.` : 'The payment was not taken. Please do not serve this treat yet.',
          for_sender: took ? `${ctx.recipient} is having the ${ctx.dish.name} at ${ctx.shop.name} now.` : 'The treat could not be served. Nothing was taken.',
        }),
      ],
    };
  };
}
