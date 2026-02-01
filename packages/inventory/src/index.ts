

export type ItemQuality = "common" | "rare" | "legendary" | "relic";
export interface ItemDef {
  id: string;
  desc: string;
  name: string;
  class: ItemQuality;
  size: number;
}

const iconModules = import.meta.glob('../icons/*.png', { 
  eager: true, 
  import: 'default' 
}) as Record<string, string>;

export const itemIcons = Object.entries(iconModules).reduce((acc, [path, url]) => {
  const fileName = path.split('/').pop()?.replace('.png', '') || '';
  acc[fileName] = url;
  return acc;
}, {} as Record<string, string>);

const itemModules = import.meta.glob('../items/*.json', { 
  eager: true, 
  import: 'default' 
}) as Record<string, ItemDef[]>;

export const allItems: ItemDef[] = Object.values(itemModules).flat();

export const itemsById = allItems.reduce((acc, item) => {
  acc[item.id] = item;
  return acc;
}, {} as Record<string, ItemDef>);

export function getItemIcon(itemId: string): string | undefined {
  return itemIcons[itemId];
}

export function getItemById(itemId: string): ItemDef | undefined {
  return itemsById[itemId];
}

export function getItemsByQuality(quality: ItemQuality): ItemDef[] {
  return allItems.filter(item => item.class === quality);
}

export const rarityClasses: Record<ItemQuality, string> = {
  common: "bg-gradient-to-r from-gray-400 via-gray-300 via-50% via-gray-500 to-gray-400 font-bold bg-clip-text text-transparent",
  rare: "bg-gradient-to-r from-blue-400 via-cyan-300 via-50% via-blue-500 to-blue-400 font-bold bg-clip-text text-transparent",
  legendary: "bg-gradient-to-r from-amber-400 via-yellow-300 via-50% via-amber-500 to-amber-400 font-bold bg-clip-text text-transparent",
  relic: "bg-gradient-to-r from-purple-400 via-pink-300 via-50% via-red-400 to-purple-400 font-bold bg-clip-text text-transparent",
};

export const rarityClassesCards: Record<ItemQuality, string> = {
  common: "border-gray-400 hover:border-gray-300 hover:shadow-gray-400/50",
  rare: "border-blue-500 hover:border-blue-400 hover:shadow-blue-500/50",
  legendary: "border-amber-500 hover:border-amber-400 hover:shadow-amber-500/50",
  relic: "border-purple-500 hover:border-purple-400 hover:shadow-purple-500/50",
};

export const rarities: readonly ItemQuality[] = ['common', 'rare', 'legendary', 'relic'] as const;