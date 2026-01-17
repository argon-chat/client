import { defineStore } from "pinia";

// Палитра приглушенных цветов, которые не бьют по глазам
const colorPalette = [
  "hsl(210, 35%, 50%)", // приглушенный синий
  "hsl(160, 35%, 45%)", // приглушенный бирюзовый
  "hsl(280, 30%, 50%)", // приглушенный фиолетовый
  "hsl(30, 40%, 50%)",  // приглушенный оранжевый
  "hsl(340, 35%, 50%)", // приглушенный розовый
  "hsl(180, 30%, 45%)", // приглушенный циан
  "hsl(120, 30%, 45%)", // приглушенный зеленый
  "hsl(250, 35%, 50%)", // приглушенный индиго
  "hsl(50, 35%, 50%)",  // приглушенный желтый
  "hsl(200, 35%, 50%)", // приглушенный голубой
  "hsl(300, 30%, 50%)", // приглушенный пурпурный
  "hsl(150, 30%, 45%)", // приглушенный мятный
];

export const useUserColors = defineStore("userColors", () => {
  const userColorCache = new Map<string, string>();
  function getColorByUserId(userId: string): string {
    if (userColorCache.has(userId)) {
      return userColorCache.get(userId) ?? "";
    }
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
      hash |= 0;
    }

    // Используем хеш как seed для выбора цвета из палитры
    const colorIndex = Math.abs(hash) % colorPalette.length;
    const color = colorPalette[colorIndex];
    userColorCache.set(userId, color);
    return color;
  }
  return { getColorByUserId };
});
