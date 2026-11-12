// The fixed words of the recipient's page, in the recipient's language. The card and the host agent's messages come
// from the server already written in that language; these are only the labels around them. No amount appears here.

export interface Words {
  hello: (to: string) => string;
  sent: (from: string) => string;
  card: string;
  treat: string;
  shop: string;
  open: string;
  keeper: string;
  show: string;
  covered: string;
  until: (date: string) => string;
  visit: (when: string) => string;
  talkTitle: string;
  thankTitle: string;
  changeHelp: string;
  thankHelp: (from: string) => string;
  box: string;
  send: string;
  host: string;
  you: string;
  writing: string;
  log: string;
  settling: string;
  enjoy: string;
  thanks: string;
  gone: string;
  nothingTaken: (from: string) => string;
  loading: string;
  notFound: string;
  notFoundMore: string;
  failed: string;
  notSent: string;
}

const en: Words = {
  hello: (to) => `${to}, have you eaten?`,
  sent: (from) => `${from} sent you a meal.`,
  card: 'The card',
  treat: 'Your treat',
  shop: 'Where',
  open: 'Open',
  keeper: 'At the counter',
  show: 'Show this at the counter',
  covered: 'It is already taken care of. You pay nothing.',
  until: (date) => `Good until ${date}.`,
  visit: (when) => `You said you would go: ${when}`,
  talkTitle: 'Want to change it, or say thank you?',
  thankTitle: 'Want to say thank you?',
  changeHelp: 'If there is something you cannot eat, say so and it will be changed.',
  thankHelp: (from) => `A thank-you is passed on to ${from}.`,
  box: 'Your message',
  send: 'Send',
  host: 'Host',
  you: 'You',
  writing: 'The host is writing.',
  log: 'Conversation with the host',
  settling: 'The shop is finishing up at the counter.',
  enjoy: 'Enjoy your meal',
  thanks: 'Your thank-you',
  gone: 'This treat is no longer available',
  nothingTaken: (from) => `Nothing was taken from ${from}.`,
  loading: 'Loading.',
  notFound: 'This link does not open a treat.',
  notFoundMore: 'Ask the person who sent it for a new link.',
  failed: 'The page could not be loaded. Reload it to try again.',
  notSent: 'That did not go through. Try again in a moment.',
};

const ko: Words = {
  hello: (to) => `${to}, 식사하셨어요?`,
  sent: (from) => `${from} 님이 한 끼를 보냈어요.`,
  card: '카드',
  treat: '받으신 음식',
  shop: '가게',
  open: '영업시간',
  keeper: '가게 주인',
  show: '카운터에서 이 코드를 보여 주세요',
  covered: '계산은 이미 준비되어 있어요. 내실 돈은 없습니다.',
  until: (date) => `${date}까지 쓸 수 있어요.`,
  visit: (when) => `가겠다고 하신 때: ${when}`,
  talkTitle: '바꾸고 싶거나 인사를 전하고 싶으세요?',
  thankTitle: '고맙다는 말을 전하고 싶으세요?',
  changeHelp: '못 드시는 음식이 있으면 말씀해 주세요. 다른 것으로 바꿔 드려요.',
  thankHelp: (from) => `고맙다는 말은 ${from} 님에게 전해 드립니다.`,
  box: '하실 말씀',
  send: '보내기',
  host: '안내',
  you: '나',
  writing: '답을 쓰고 있어요.',
  log: '안내와 나눈 대화',
  settling: '가게에서 계산을 마무리하고 있어요.',
  enjoy: '맛있게 드세요',
  thanks: '전하신 인사',
  gone: '이 선물은 이제 쓸 수 없어요',
  nothingTaken: (from) => `${from} 님에게서 빠져나간 돈은 없습니다.`,
  loading: '불러오는 중입니다.',
  notFound: '이 주소에는 받을 음식이 없어요.',
  notFoundMore: '보내신 분께 새 주소를 부탁해 주세요.',
  failed: '페이지를 불러오지 못했어요. 새로 고쳐 주세요.',
  notSent: '전송되지 않았어요. 잠시 뒤에 다시 해 주세요.',
};

const es: Words = {
  hello: (to) => `${to}, ¿ya comiste?`,
  sent: (from) => `${from} te invita a comer.`,
  card: 'La tarjeta',
  treat: 'Tu comida',
  shop: 'Dónde',
  open: 'Horario',
  keeper: 'Te atiende',
  show: 'Muestra este código en el mostrador',
  covered: 'Ya está cubierto. No tienes que pagar nada.',
  until: (date) => `Válido hasta el ${date}.`,
  visit: (when) => `Dijiste que irías: ${when}`,
  talkTitle: '¿Quieres cambiar algo o dar las gracias?',
  thankTitle: '¿Quieres dar las gracias?',
  changeHelp: 'Si hay algo que no puedes comer, dilo y se cambia por otra cosa.',
  thankHelp: (from) => `Tu agradecimiento le llega a ${from}.`,
  box: 'Tu mensaje',
  send: 'Enviar',
  host: 'Anfitrión',
  you: 'Tú',
  writing: 'El anfitrión está escribiendo.',
  log: 'Conversación con el anfitrión',
  settling: 'La tienda está terminando en el mostrador.',
  enjoy: 'Buen provecho',
  thanks: 'Tu agradecimiento',
  gone: 'Esta invitación ya no está disponible',
  nothingTaken: (from) => `A ${from} no se le cobró nada.`,
  loading: 'Cargando.',
  notFound: 'Este enlace no abre ninguna invitación.',
  notFoundMore: 'Pide un enlace nuevo a quien te lo envió.',
  failed: 'No se pudo cargar la página. Vuelve a cargarla.',
  notSent: 'No se envió. Inténtalo de nuevo en un momento.',
};

// Polish declines names, so the sender's name is kept in the nominative or left out.
const pl: Words = {
  hello: (to) => `${to}, już po jedzeniu?`,
  sent: (from) => `${from} zaprasza Cię na posiłek.`,
  card: 'Kartka',
  treat: 'Twój poczęstunek',
  shop: 'Gdzie',
  open: 'Godziny otwarcia',
  keeper: 'Przy ladzie',
  show: 'Pokaż ten kod przy ladzie',
  covered: 'Rachunek jest już załatwiony. Nic nie płacisz.',
  until: (date) => `Ważne do: ${date}.`,
  visit: (when) => `Planowana wizyta: ${when}`,
  talkTitle: 'Chcesz coś zmienić albo podziękować?',
  thankTitle: 'Chcesz podziękować?',
  changeHelp: 'Jeśli czegoś nie jesz, napisz, a zamienimy to na coś innego.',
  thankHelp: () => 'Podziękowanie przekażemy nadawcy.',
  box: 'Twoja wiadomość',
  send: 'Wyślij',
  host: 'Gospodarz',
  you: 'Ty',
  writing: 'Gospodarz pisze.',
  log: 'Rozmowa z gospodarzem',
  settling: 'Lokal kończy rozliczenie przy ladzie.',
  enjoy: 'Smacznego',
  thanks: 'Twoje podziękowanie',
  gone: 'Ten poczęstunek nie jest już dostępny',
  nothingTaken: (from) => `Nadawca (${from}) nic nie zapłacił.`,
  loading: 'Wczytywanie.',
  notFound: 'Ten link nie prowadzi do żadnego poczęstunku.',
  notFoundMore: 'Poproś nadawcę o nowy link.',
  failed: 'Nie udało się wczytać strony. Odśwież ją.',
  notSent: 'Nie udało się wysłać. Spróbuj ponownie za chwilę.',
};

const tl: Words = {
  hello: (to) => `${to}, kumain ka na ba?`,
  sent: (from) => `Nilibre ka ni ${from} ng pagkain.`,
  card: 'Ang kard',
  treat: 'Ang pagkain mo',
  shop: 'Saan',
  open: 'Bukas',
  keeper: 'Sa counter',
  show: 'Ipakita ang code na ito sa counter',
  covered: 'Sagot na ito. Wala kang babayaran.',
  until: (date) => `Magagamit hanggang ${date}.`,
  visit: (when) => `Sabi mo pupunta ka: ${when}`,
  talkTitle: 'May gusto kang palitan, o gusto mong magpasalamat?',
  thankTitle: 'Gusto mong magpasalamat?',
  changeHelp: 'Kung may hindi ka makakain, sabihin mo at papalitan namin.',
  thankHelp: (from) => `Ipaaabot namin kay ${from} ang pasasalamat mo.`,
  box: 'Ang mensahe mo',
  send: 'Ipadala',
  host: 'Tagapag-asikaso',
  you: 'Ikaw',
  writing: 'Sumusulat ang tagapag-asikaso.',
  log: 'Usapan ninyo ng tagapag-asikaso',
  settling: 'Inaayos na ng tindahan ang bayad sa counter.',
  enjoy: 'Kain nang mabuti',
  thanks: 'Ang pasasalamat mo',
  gone: 'Hindi na magagamit ang libreng ito',
  nothingTaken: (from) => `Walang kinuha kay ${from}.`,
  loading: 'Naglo-load.',
  notFound: 'Walang libreng pagkain sa link na ito.',
  notFoundMore: 'Humingi ng bagong link sa nagpadala.',
  failed: 'Hindi na-load ang page. Paki-refresh.',
  notSent: 'Hindi naipadala. Subukan ulit mamaya.',
};

const WORDS: Record<string, Words> = { en, ko, es, pl, tl };

/** "ko-KR" and "ko" both give "ko"; Filipino ("fil") is read as Tagalog; anything unknown is English. */
export function languageOf(language: string | undefined): string {
  const code = (language ?? '').toLowerCase().split(/[-_]/)[0];
  const key = code === 'fil' ? 'tl' : code;
  return key in WORDS ? key : 'en';
}

export const wordsFor = (language: string | undefined): Words => WORDS[languageOf(language)];

/** The language of the browser before any treat is loaded, for the loading and not-found lines. */
export const browserLanguage = (): string => (typeof navigator === 'undefined' ? 'en' : navigator.language);
