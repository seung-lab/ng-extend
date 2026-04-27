// Connectome Coin economy for avatar items.
// Costs are tiered: per-category base × rarity multiplier.
// Jumpsuits are intentionally the most expensive items in the catalog —
// a legendary jumpsuit tops out at 1500 coins.

export const ITEM_COST_BY_CATEGORY: Record<string, number> = {
  // Head — body/identity choices, all free
  hair: 0,
  beard: 0,
  eyes: 0,
  eyebrows: 0,
  nose: 0,
  mouth: 0,
  features: 0,
  skin: 0,

  // Clothes — tiered
  base: 0,
  belt: 30,
  glasses: 40,
  shirt: 50,
  pants: 50,
  shoes: 60,
  arm: 75,
  mask: 75,
  hat: 100,
  jacket: 150,
  jumpsuit: 500,

  // Environment — premium tier
  aura: 200,
  handheld: 150,
  sidekick: 250,
};

export type Rarity = 'standard' | 'premium' | 'legendary';

export const RARITY_MULTIPLIER: Record<Rarity, number> = {
  standard: 1,
  premium: 2,
  legendary: 3,
};

export const RARITY_LABEL: Record<Rarity, string> = {
  standard: 'Standard',
  premium: 'Premium',
  legendary: 'Legendary',
};

// Hand-picked legendary items per category. Add sparingly — these are the
// hero pieces that should feel rare and aspirational.
const LEGENDARY_ITEMS_BY_CATEGORY: Record<string, string[]> = {
  shirt: ['play with nurro'],
  hat: ['nurro helmet', 'astronaut helmet', 'ultracortex', 'pharaoh headdress'],
  jacket: ['Cyborg', 'Hologalaxy Coat', 'Holo Armor', 'Holographic Jacket'],
  jumpsuit: ['Daimyo Garb', 'Kimono'],
};

// EyeWire/neuroscience-themed naming patterns get premium tier minimum.
const PREMIUM_NAME_PATTERN =
  /eyewire|brainstar|cellfie|neuron|myelin|microscope|nurro|pyr|chunkflow|hologalaxy|cortex|holographic|holojacket|holo /i;

function eqCI(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function itemRarity(category: string, itemName: string): Rarity {
  const legend = LEGENDARY_ITEMS_BY_CATEGORY[category];
  if (legend && legend.some(n => eqCI(n, itemName))) return 'legendary';
  if (PREMIUM_NAME_PATTERN.test(itemName)) return 'premium';
  // Designer-named items (Title Case) — premium tier by convention.
  if (/^[A-Z]/.test(itemName)) return 'premium';
  return 'standard';
}

export function itemCost(category: string): number {
  return ITEM_COST_BY_CATEGORY[category] ?? 50;
}

export function itemPrice(category: string, itemName: string): number {
  const base = itemCost(category);
  if (base === 0) return 0;
  return Math.round(base * RARITY_MULTIPLIER[itemRarity(category, itemName)]);
}

export function itemKey(category: string, item: string): string {
  return `${category}/${item}`;
}

export const COIN_RATES = {
  edit: 1,
  cellCompletion: 25,
  streakDay: 5,
  badge: 100,
  joiningBonus: 200,
};

export interface UserStatsForCoins {
  totalEdits: number;
  cellsCompleted: number;
  currentStreak: number;
  specialBadgeCount: number;
}

export function computeEarnedCoins(s: UserStatsForCoins): number {
  return COIN_RATES.joiningBonus
       + s.totalEdits * COIN_RATES.edit
       + s.cellsCompleted * COIN_RATES.cellCompletion
       + s.currentStreak * COIN_RATES.streakDay
       + s.specialBadgeCount * COIN_RATES.badge;
}

export function formatCoins(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}
