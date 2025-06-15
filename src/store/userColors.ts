import { defineStore } from "pinia";

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

    const hue = Math.abs(hash) % 360;
    const color = `hsl(${hue}, 60%, 50%)`;
    userColorCache.set(userId, color);
    return color;
  }
  return { getColorByUserId };
});
