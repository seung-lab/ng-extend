// Connectome Coin economy for avatar items.
// Costs are per-item flat by category; jumpsuits are intentionally the
// most expensive items in the game.

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

export function itemCost(category: string): number {
  return ITEM_COST_BY_CATEGORY[category] ?? 50;
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
