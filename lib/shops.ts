import type { MenuItem, Shop } from './types';

export const PLATFORM = { name: 'Have You Eaten?' };

/** How long PayPal honours a hold in full. A treat can be used for this long, then the hold is released. */
export const HOLD_DAYS = 3;
/** The most a single treat may hold, in cents. */
export const MAX_TREAT_CENTS = 4000;

/** Local currency units per one US dollar. A fixed table for the demo, not a live rate. */
export const FX = {
  date: '2026-11-12',
  source: 'open.er-api.com',
  perUsd: { KRW: 1336.6, NGN: 1349.82, MXN: 18.627, PHP: 63.305, PLN: 3.9678 } as Record<string, number>,
};

const item = (id: string, name: string, localName: string, localPrice: number, about: string, ...tags: string[]): MenuItem => ({ id, name, localName, localPrice, about, tags });

/** Every shop and shopkeeper here is made up. The cities and the dishes are real. */
export const SHOPS: Shop[] = [
  {
    id: 'haeundae-juk',
    name: 'Haeundae Jukjip',
    localName: '해운대 죽집',
    kind: 'porridge shop',
    keeper: 'Sun-ja',
    city: 'Busan',
    area: 'Haeundae',
    country: 'KR',
    language: 'ko',
    currency: 'KRW',
    hours: '07:30-20:30',
    menu: [
      item('abalone-juk', 'Abalone porridge', '전복죽', 14000, 'Slow-cooked rice porridge with abalone; what people bring to someone who is unwell.', 'warm', 'light', 'seafood', 'soup'),
      item('vegetable-juk', 'Vegetable porridge', '야채죽', 9000, 'Plain rice porridge with finely chopped vegetables.', 'warm', 'light', 'vegetarian', 'soup'),
      item('beef-juk', 'Beef porridge', '소고기죽', 10000, 'Rice porridge with minced beef and sesame oil.', 'warm', 'light', 'meat', 'soup'),
      item('pumpkin-juk', 'Sweet pumpkin porridge', '단호박죽', 9500, 'Smooth, lightly sweet pumpkin porridge with rice dumplings.', 'warm', 'light', 'sweet', 'vegetarian'),
    ],
  },
  {
    id: 'gwangan-gukbap',
    name: 'Gwangan Gukbap',
    localName: '광안 국밥',
    kind: 'soup-and-rice house',
    keeper: 'Yong-ho',
    city: 'Busan',
    area: 'Gwangan',
    country: 'KR',
    language: 'ko',
    currency: 'KRW',
    hours: '06:00-22:00',
    menu: [
      item('pork-gukbap', 'Pork soup with rice', '돼지국밥', 9500, "Busan's own dish: milky pork broth with rice, chives and salted shrimp on the side.", 'warm', 'soup', 'meat', 'filling'),
      item('beansprout-gukbap', 'Bean sprout soup with rice', '콩나물국밥', 8000, 'Clear, hot bean sprout soup with rice and an egg; easy on the stomach.', 'warm', 'soup', 'light'),
      item('boiled-pork-set', 'Boiled pork set', '수육백반', 13000, 'Sliced boiled pork with soup, rice and side dishes.', 'warm', 'meat', 'filling'),
    ],
  },
  {
    id: 'dalmaji-bakery',
    name: 'Dalmaji Bakery Café',
    localName: '달맞이 빵집',
    kind: 'bakery café',
    keeper: 'Min-seo',
    city: 'Busan',
    area: 'Haeundae',
    country: 'KR',
    language: 'ko',
    currency: 'KRW',
    hours: '08:00-21:00',
    menu: [
      item('americano', 'Americano', '아메리카노', 4500, 'Hot or iced.', 'coffee'),
      item('yuja-tea', 'Yuja tea', '유자차', 5500, 'Hot citron tea with honey; the usual thing for a sore throat.', 'warm', 'sweet', 'vegetarian'),
      item('redbean-bun-milk', 'Red bean bun and milk', '단팥빵과 우유', 5000, 'A soft bun filled with sweet red bean, with a carton of milk.', 'sweet', 'vegetarian', 'breakfast'),
      item('cake-slice', 'Slice of fresh cream cake', '생크림 케이크 한 조각', 7500, 'Sponge, fresh cream and strawberries.', 'sweet', 'vegetarian', 'celebration'),
      item('whole-cake', 'Whole fresh cream cake', '생크림 케이크 (1호)', 32000, 'A small whole cake with candles, enough for four.', 'sweet', 'vegetarian', 'celebration'),
    ],
  },
  {
    id: 'mama-tunde',
    name: "Mama Tunde's Kitchen",
    localName: "Mama Tunde's Kitchen",
    kind: 'buka (home-style canteen)',
    keeper: 'Mama Tunde',
    city: 'Lagos',
    area: 'Yaba',
    country: 'NG',
    language: 'en',
    currency: 'NGN',
    hours: '08:00-20:00',
    menu: [
      item('jollof-chicken', 'Jollof rice with chicken', 'Jollof rice & chicken', 4500, 'Smoky party-style jollof with a piece of fried chicken and plantain.', 'warm', 'meat', 'spicy', 'filling'),
      item('pepper-soup', 'Catfish pepper soup', 'Catfish pepper soup', 5500, 'Hot, peppery broth with catfish; what you are given when you have a cold.', 'warm', 'soup', 'spicy', 'seafood', 'light'),
      item('efo-riro', 'Efo riro with pounded yam', 'Efo riro & pounded yam', 5000, 'Spinach stew with assorted meat, served with pounded yam.', 'warm', 'meat', 'filling'),
      item('moi-moi-pap', 'Moi moi and pap', 'Moi moi & pap', 2500, 'Steamed bean pudding with warm corn pap; a gentle breakfast.', 'warm', 'light', 'vegetarian', 'breakfast'),
    ],
  },
  {
    id: 'third-mainland-coffee',
    name: 'Third Mainland Coffee',
    localName: 'Third Mainland Coffee',
    kind: 'café',
    keeper: 'Chidi',
    city: 'Lagos',
    area: 'Yaba',
    country: 'NG',
    language: 'en',
    currency: 'NGN',
    hours: '07:00-19:00',
    menu: [
      item('flat-white', 'Flat white', 'Flat white', 3000, 'Made with beans roasted in Lagos.', 'coffee'),
      item('zobo', 'Iced zobo', 'Zobo', 1800, 'Cold hibiscus drink with ginger and pineapple.', 'sweet', 'vegetarian', 'cold'),
      item('meat-pie', 'Meat pie', 'Meat pie', 2000, 'A warm pastry filled with minced beef and potato.', 'warm', 'meat', 'breakfast'),
      item('banana-bread', 'Slice of banana bread', 'Banana bread', 2200, 'Baked each morning.', 'sweet', 'vegetarian'),
    ],
  },
  {
    id: 'fonda-lupita',
    name: 'Fonda Lupita',
    localName: 'Fonda Lupita',
    kind: 'fonda (family lunch kitchen)',
    keeper: 'Doña Lupita',
    city: 'Mexico City',
    area: 'Roma Norte',
    country: 'MX',
    language: 'es',
    currency: 'MXN',
    hours: '09:00-18:00',
    menu: [
      item('caldo-pollo', 'Chicken soup', 'Caldo de pollo', 95, 'Clear chicken broth with vegetables, rice and lime; the cure for most things.', 'warm', 'soup', 'meat', 'light'),
      item('comida-corrida', 'Set lunch', 'Comida corrida', 130, 'Soup, a main dish of the day, tortillas and agua fresca.', 'warm', 'meat', 'filling'),
      item('enfrijoladas', 'Enfrijoladas', 'Enfrijoladas', 90, 'Tortillas in black bean sauce with cheese and cream.', 'warm', 'vegetarian', 'filling'),
      item('sopa-tortilla', 'Tortilla soup', 'Sopa de tortilla', 85, 'Tomato and chile broth with crisp tortilla, avocado and cheese.', 'warm', 'soup', 'vegetarian'),
    ],
  },
  {
    id: 'panaderia-esquina',
    name: 'Panadería La Esquina',
    localName: 'Panadería La Esquina',
    kind: 'bakery',
    keeper: 'Mateo',
    city: 'Mexico City',
    area: 'Roma Norte',
    country: 'MX',
    language: 'es',
    currency: 'MXN',
    hours: '07:00-21:00',
    menu: [
      item('cafe-olla', 'Café de olla', 'Café de olla', 45, 'Coffee simmered with cinnamon and raw sugar.', 'coffee', 'warm', 'sweet'),
      item('concha-chocolate', 'Concha and hot chocolate', 'Concha con chocolate caliente', 70, 'A sweet shell-topped bun with a cup of hot chocolate.', 'warm', 'sweet', 'vegetarian', 'breakfast'),
      item('pan-muerto', 'Pan de muerto', 'Pan de muerto', 55, 'Orange-blossom bread baked for early November.', 'sweet', 'vegetarian'),
      item('tres-leches', 'Slice of tres leches cake', 'Rebanada de pastel de tres leches', 80, 'Sponge cake soaked in three milks.', 'sweet', 'vegetarian', 'celebration'),
    ],
  },
  {
    id: 'aling-nena',
    name: "Aling Nena's Lugawan",
    localName: 'Lugawan ni Aling Nena',
    kind: 'rice porridge stall',
    keeper: 'Aling Nena',
    city: 'Manila',
    area: 'Maginhawa',
    country: 'PH',
    language: 'tl',
    currency: 'PHP',
    hours: '06:00-22:00',
    menu: [
      item('arroz-caldo', 'Chicken rice porridge', 'Arroz caldo', 120, 'Ginger rice porridge with chicken, egg and toasted garlic; made for rainy days and colds.', 'warm', 'soup', 'light', 'meat'),
      item('lugaw-egg', 'Plain rice porridge with egg', 'Lugaw na may itlog', 70, 'Plain porridge with a boiled egg and spring onion.', 'warm', 'light', 'vegetarian'),
      item('goto', 'Beef tripe porridge', 'Goto', 130, 'Rice porridge with beef tripe and calamansi.', 'warm', 'meat', 'filling'),
      item('tokwa-baboy', "Tofu and pork", "Tokwa't baboy", 110, 'Fried tofu and pork in vinegar and soy.', 'meat'),
    ],
  },
  {
    id: 'kape-pandesal',
    name: 'Kape at Pandesal',
    localName: 'Kape at Pandesal',
    kind: 'café and bakery',
    keeper: 'Jun',
    city: 'Manila',
    area: 'Maginhawa',
    country: 'PH',
    language: 'tl',
    currency: 'PHP',
    hours: '05:30-20:00',
    menu: [
      item('barako', 'Barako coffee', 'Kapeng barako', 90, 'Strong Batangas coffee.', 'coffee', 'warm'),
      item('pandesal-kesong-puti', 'Pandesal with white cheese', 'Pandesal na may kesong puti', 85, 'Warm bread rolls with fresh carabao-milk cheese.', 'breakfast', 'vegetarian', 'warm'),
      item('ensaymada', 'Ensaymada', 'Ensaymada', 95, 'Soft brioche with butter, sugar and cheese.', 'sweet', 'vegetarian'),
      item('halo-halo', 'Halo-halo', 'Halo-halo', 150, 'Shaved ice with milk, beans, fruit, leche flan and ube.', 'sweet', 'cold', 'vegetarian', 'celebration'),
    ],
  },
  {
    id: 'pod-lipa',
    name: 'Bar Mleczny Pod Lipą',
    localName: 'Bar Mleczny Pod Lipą',
    kind: 'milk bar (canteen)',
    keeper: 'Pani Halina',
    city: 'Kraków',
    area: 'Kazimierz',
    country: 'PL',
    language: 'pl',
    currency: 'PLN',
    hours: '08:00-19:00',
    menu: [
      item('rosol', 'Chicken broth with noodles', 'Rosół z makaronem', 14, 'Clear chicken broth with thin noodles; Sunday soup, and the cure for a cold.', 'warm', 'soup', 'light', 'meat'),
      item('zurek', 'Sour rye soup', 'Żurek', 16, 'Sour rye soup with sausage and egg.', 'warm', 'soup', 'meat', 'filling'),
      item('pierogi-ruskie', 'Potato and cheese dumplings', 'Pierogi ruskie', 22, 'Dumplings filled with potato and curd cheese, with fried onion.', 'warm', 'vegetarian', 'filling'),
      item('nalesniki', 'Sweet cheese pancakes', 'Naleśniki z serem', 19, 'Thin pancakes with sweet curd cheese.', 'warm', 'sweet', 'vegetarian'),
    ],
  },
  {
    id: 'piekarnia-rogal',
    name: 'Piekarnia Rogal',
    localName: 'Piekarnia Rogal',
    kind: 'bakery',
    keeper: 'Tomek',
    city: 'Kraków',
    area: 'Kazimierz',
    country: 'PL',
    language: 'pl',
    currency: 'PLN',
    hours: '06:00-18:00',
    menu: [
      item('kawa-biala', 'White coffee', 'Kawa biała', 12, 'Coffee with milk.', 'coffee', 'warm'),
      item('herbata-maliny', 'Tea with raspberry syrup', 'Herbata z malinami', 11, 'Hot tea with raspberry syrup; what a Polish grandmother gives you for a cold.', 'warm', 'sweet', 'vegetarian'),
      item('drozdzowka', 'Sweet cheese bun', 'Drożdżówka z serem', 8, 'A yeast bun with sweet curd cheese.', 'sweet', 'vegetarian', 'breakfast'),
      item('sernik', 'Slice of cheesecake', 'Sernik (kawałek)', 15, 'Baked Kraków-style cheesecake.', 'sweet', 'vegetarian', 'celebration'),
    ],
  },
];

/** Other words people use for a city or its neighbourhoods. */
const PLACES: Record<string, string[]> = {
  Busan: ['busan', 'pusan', '부산', 'haeundae', '해운대', 'gwangan', 'gwangalli', '광안', 'south korea', 'korea', '한국'],
  Lagos: ['lagos', 'yaba', 'nigeria'],
  'Mexico City': ['mexico city', 'ciudad de méxico', 'ciudad de mexico', 'cdmx', 'roma norte', 'la roma', 'mexico', 'méxico'],
  Manila: ['manila', 'quezon city', 'maginhawa', 'philippines', 'pilipinas'],
  Kraków: ['kraków', 'krakow', 'cracow', 'kazimierz', 'poland', 'polska'],
};

export const CITIES = Object.keys(PLACES);
export const shopById = (id: unknown) => SHOPS.find((s) => s.id === id);
export const itemOf = (shop: Shop | undefined, id: unknown) => shop?.menu.find((m) => m.id === id);

/** The city a free-text place points at, if it is one where shops take part. */
export function cityOf(place: string): string | undefined {
  const p = place.toLowerCase();
  return CITIES.find((city) => PLACES[city].some((word) => p.includes(word)));
}

/** Every city with shops that a text mentions. */
export function citiesIn(text: string): string[] {
  const t = text.toLowerCase();
  return CITIES.filter((city) => PLACES[city].some((word) => t.includes(word)));
}

/** Shops in the city the place points at, those in a neighbourhood the place names first. */
export function shopsNear(place: string): Shop[] {
  const city = cityOf(place);
  if (!city) return [];
  const p = place.toLowerCase();
  const named = (s: Shop) => (p.includes(s.area.toLowerCase()) ? 0 : 1);
  return SHOPS.filter((s) => s.city === city).sort((a, b) => named(a) - named(b));
}

export const isFake = () => process.env.PAYPAL_FAKE === '1';
/** Development only: a scripted stand-in replaces the language model. */
export const isScripted = () => process.env.LLM_SCRIPTED === '1';
export const isConfigured = () => isFake() || (!!process.env.PAYPAL_CLIENT_ID && !!process.env.PAYPAL_CLIENT_SECRET);
/** Where PayPal sends the sender back. RENDER_EXTERNAL_URL is set by the host. */
export const appUrl = () => process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
/** One sandbox account stands in for every demo shop's PayPal account. Without it the shop's money is recorded as owed. */
export const shopPayoutEmail = () => process.env.SHOP_PAYOUT_EMAIL || (isFake() ? 'shops@example.test' : '');
