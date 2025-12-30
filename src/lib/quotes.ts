export interface Quote {
  text: string;
  author: string;
}

export const quotes: Quote[] = [
  { text: "у меня на локалке все работает", author: "Юки" },
  { text: "Если намочить руку — то она будет мокрая.", author: "Арам" },
  { text: "А клыки нам даны, чтобы ... кору деревьев отгрызать?", author: "Miniature" },
  { text: "СЫН БЛЯДИ КОНЧЕННЫЙ УЕБОК Я ПО НОРМАЛЬНОМУ СПРОСИЛ БЛЯТЬ", author: "Беляш" },
  { text: "Блядь, ёбанный Юки", author: "Мурзилка" },
  { text: "Ненавижу блять солнце", author: "Юки" },
];

export function getRandomQuote(): Quote {
  return quotes[Math.floor(Math.random() * quotes.length)];
}
