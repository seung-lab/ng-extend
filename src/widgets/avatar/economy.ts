// Connectome Coin economy for avatar items.
//
// Pricing philosophy: most items are expensive enough that even power players
// (10k+ edits/year) take years to fill the catalog. A small hand-picked set of
// starter items priced flat at ◎ 50 lets new players try things on without
// grinding. Body parts (hair, eyes, etc.) are always free — they're identity,
// not loot.

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

  // Clothes — substantial baseline so items hold value
  base: 0,        // default outfit, free
  belt: 200,
  glasses: 250,
  shirt: 350,
  pants: 350,
  shoes: 400,
  arm: 500,
  mask: 500,
  hat: 700,
  jacket: 1200,
  jumpsuit: 3000, // jumpsuits stay the most expensive item type

  // Environment — premium / aspirational tier
  handheld: 800,
  aura: 1500,
  sidekick: 2000,
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

// Hand-picked legendary items per category — the rarest hero pieces.
const LEGENDARY_ITEMS_BY_CATEGORY: Record<string, string[]> = {
  shirt: ['play with nurro'],
  hat: ['nurro helmet', 'astronaut helmet', 'ultracortex', 'pharaoh headdress'],
  jacket: ['Cyborg', 'Hologalaxy Coat', 'Holo Armor', 'Holographic Jacket'],
  jumpsuit: ['Daimyo Garb', 'Kimono'],
};

// EyeWire/neuroscience-themed naming patterns get premium tier minimum.
const PREMIUM_NAME_PATTERN =
  /eyewire|brainstar|cellfie|neuron|myelin|microscope|nurro|pyr|chunkflow|hologalaxy|cortex|holographic|holojacket|holo /i;

// Hand-picked starter items — flat ◎ 50 each, regardless of rarity. Limit
// the list to keep the rest of the catalog aspirational.
const STARTER_PRICE = 50;
const STARTER_ITEMS_BY_CATEGORY: Record<string, string[]> = {
  shirt:    ['blank shirt', 'tshirt base', 'striped shirt'],
  pants:    ['pants', 'sweatpants'],
  shoes:    ['spike boots', 'mecha boots'],
  glasses:  ['glasses'],
  hat:      ['cap', 'beanie', 'eyewire cap'],
  belt:     ['Utility Belt', 'Agent Belt'],
};

function eqCI(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function isStarterItem(category: string, itemName: string): boolean {
  const list = STARTER_ITEMS_BY_CATEGORY[category];
  return !!list && list.some(n => eqCI(n, itemName));
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
  return ITEM_COST_BY_CATEGORY[category] ?? 350;
}

export function itemPrice(category: string, itemName: string): number {
  if (isStarterItem(category, itemName)) return STARTER_PRICE;
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
