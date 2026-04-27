<script setup lang="ts">
import {computed, ref} from 'vue';
import {storeToRefs} from 'pinia';
import {useAvatarStore, AvatarGender} from '../store';
import {itemPrice, itemRarity, formatCoins, RARITY_LABEL, COIN_RATES, Rarity, EFFECTS, EFFECT_DESCRIPTION, effectPrice, effectRarity} from '../widgets/avatar/economy';
import connectomeCoin from '../../static/coin/connectome-coin.png';

const store = useAvatarStore();
const {gender, ready, version, coinsBalance, coinsEarned, coinsSpent, collectionProgress, activeEffect} = storeToRefs(store);

type FilterMode = 'all' | 'owned' | 'affordable' | 'locked';
const filterMode = ref<FilterMode>('all');
const FILTER_MODES: FilterMode[] = ['all', 'owned', 'affordable', 'locked'];
const FILTER_LABEL: Record<FilterMode, string> = {
  all: 'All', owned: 'Owned', affordable: 'Affordable', locked: 'Locked',
};
const showHowToEarn = ref(false);

interface ViewItem {
  name: string;
  rarity: Rarity;
  price: number;
  unlocked: boolean;
  active: boolean;
  affordable: boolean;
}

interface SectionGroup {
  section: string;
  categories: {
    section: string;
    category: string;
    items: ViewItem[];
    activeItem: string | null;
    optional: boolean;
    colors: string[] | undefined;
    activeColorIndex: number;
    minPrice: number;
    maxPrice: number;
  }[];
}

const RARITY_RANK: Record<Rarity, number> = {legendary: 3, premium: 2, standard: 1};

const effectPrices = EFFECTS.map(effectPrice);
const effectPriceMin = Math.min(...effectPrices);
const effectPriceMax = Math.max(...effectPrices);

const sectionGroups = computed<SectionGroup[]>(() => {
  void version.value;
  const all = store.categoryViews();
  const grouped = new Map<string, SectionGroup>();
  for (const v of all) {
    if (!grouped.has(v.section)) {
      grouped.set(v.section, {section: v.section, categories: []});
    }
    const items: ViewItem[] = v.items.map(name => {
      const price = itemPrice(v.category, name);
      const rar = itemRarity(v.category, name);
      const unlocked = price === 0 || store.unlocks.has(`${v.category}/${name}`);
      const active = v.activeItem === name;
      const affordable = price <= coinsBalance.value;
      return {name, rarity: rar, price, unlocked, active, affordable};
    });

    // Apply filter
    const filtered = items.filter(it => {
      if (filterMode.value === 'all') return true;
      if (filterMode.value === 'owned') return it.unlocked;
      if (filterMode.value === 'locked') return !it.unlocked;
      if (filterMode.value === 'affordable') return !it.unlocked && it.affordable;
      return true;
    });

    // Sort: active first, then unlocked, then by rarity desc, then by name asc.
    filtered.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      if (a.rarity !== b.rarity) return RARITY_RANK[b.rarity] - RARITY_RANK[a.rarity];
      return a.name.localeCompare(b.name);
    });

    const prices = items.filter(it => it.price > 0).map(it => it.price);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 0;

    grouped.get(v.section)!.categories.push({
      section: v.section,
      category: v.category,
      items: filtered,
      activeItem: v.activeItem,
      optional: v.optional,
      colors: v.colors,
      activeColorIndex: v.activeColorIndex,
      minPrice, maxPrice,
    });
  }
  return [...grouped.values()];
});

function prettify(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

interface PurchasePrompt {
  kind: 'item' | 'effect';
  category: string;
  item: string;
  price: number;
  rarity: Rarity;
}
const purchasePrompt = ref<PurchasePrompt | null>(null);

async function handleEffectClick(name: string | null) {
  if (name === null) {
    await store.applyEffect('');
    return;
  }
  if (store.isEffectUnlocked(name)) {
    await store.applyEffect(name);
    return;
  }
  await store.previewEffect(name);
  purchasePrompt.value = {
    kind: 'effect',
    category: 'Effect',
    item: name,
    price: effectPrice(name),
    rarity: effectRarity(name),
  };
}

async function handleItemClick(category: string, itemName: string | null) {
  if (itemName === null) {
    await store.selectItem(category, null);
    return;
  }
  const price = itemPrice(category, itemName);
  if (price === 0 || store.isUnlocked(category, itemName)) {
    await store.selectItem(category, itemName);
    return;
  }
  // Locked — try it on, then open the purchase modal.
  await store.previewItem(category, itemName);
  purchasePrompt.value = {
    kind: 'item',
    category,
    item: itemName,
    price,
    rarity: itemRarity(category, itemName),
  };
}

async function confirmPurchase() {
  if (!purchasePrompt.value) return;
  const p = purchasePrompt.value;
  if (p.kind === 'effect') {
    await store.purchaseEffect(p.item);
  } else {
    await store.purchase(p.category, p.item);
  }
  purchasePrompt.value = null;
}
async function cancelPurchase() {
  await store.cancelPreview();
  purchasePrompt.value = null;
}
</script>

<template>
  <aside class="nge-avatar-editor">
    <div class="nge-avatar-editor-header">
      <div class="nge-avatar-editor-title">CUSTOMIZE</div>
      <button
        class="nge-avatar-balance"
        :title="`${coinsBalance.toLocaleString()} Connectome Coins — click for earning details`"
        @click="showHowToEarn = !showHowToEarn"
      >
        <img :src="connectomeCoin" class="nge-coin nge-coin--lg" alt="" />
        <span class="nge-avatar-balance-num">{{ formatCoins(coinsBalance) }}</span>
      </button>
    </div>

    <Transition name="nge-avatar-earn-fade">
      <div v-if="showHowToEarn" class="nge-avatar-earn-card">
        <div class="nge-avatar-earn-title">HOW TO EARN</div>
        <div class="nge-avatar-earn-row"><span>1 edit</span><span><img :src="connectomeCoin" class="nge-coin" alt="" />{{ COIN_RATES.edit }}</span></div>
        <div class="nge-avatar-earn-row"><span>Cell completion</span><span><img :src="connectomeCoin" class="nge-coin" alt="" />{{ COIN_RATES.cellCompletion }}</span></div>
        <div class="nge-avatar-earn-row"><span>Streak day</span><span><img :src="connectomeCoin" class="nge-coin" alt="" />{{ COIN_RATES.streakDay }}</span></div>
        <div class="nge-avatar-earn-row"><span>Badge earned</span><span><img :src="connectomeCoin" class="nge-coin" alt="" />{{ COIN_RATES.badge }}</span></div>
        <div class="nge-avatar-earn-row"><span>Joining bonus</span><span><img :src="connectomeCoin" class="nge-coin" alt="" />{{ COIN_RATES.joiningBonus }}</span></div>
        <div class="nge-avatar-earn-divider"></div>
        <div class="nge-avatar-earn-row nge-avatar-earn-row--total">
          <span>Total earned</span><span><img :src="connectomeCoin" class="nge-coin" alt="" />{{ coinsEarned.toLocaleString() }}</span>
        </div>
        <div class="nge-avatar-earn-row nge-avatar-earn-row--spent">
          <span>Spent</span><span>−<img :src="connectomeCoin" class="nge-coin" alt="" />{{ coinsSpent.toLocaleString() }}</span>
        </div>
      </div>
    </Transition>

    <div class="nge-avatar-progress">
      <div class="nge-avatar-progress-bar">
        <div
          class="nge-avatar-progress-fill"
          :style="{ width: collectionProgress.total > 0 ? (collectionProgress.owned / collectionProgress.total * 100) + '%' : '0%' }"
        ></div>
      </div>
      <div class="nge-avatar-progress-label">
        Collection: <strong>{{ collectionProgress.owned }}</strong> / {{ collectionProgress.total }} unlocked
      </div>
    </div>

    <div class="nge-avatar-gender-row">
      <button
        class="nge-avatar-gender-btn"
        :class="{ 'nge-avatar-gender-btn--active': gender === AvatarGender.Female }"
        :disabled="!ready"
        @click="store.changeGender(AvatarGender.Female)"
        title="Female body"
      >♀</button>
      <button
        class="nge-avatar-gender-btn"
        :class="{ 'nge-avatar-gender-btn--active': gender === AvatarGender.Male }"
        :disabled="!ready"
        @click="store.changeGender(AvatarGender.Male)"
        title="Male body"
      >♂</button>
    </div>

    <div class="nge-avatar-filters">
      <button
        v-for="mode in FILTER_MODES"
        :key="mode"
        class="nge-avatar-filter"
        :class="{ 'nge-avatar-filter--active': filterMode === mode }"
        @click="filterMode = mode"
      >{{ FILTER_LABEL[mode] }}</button>
    </div>

    <div class="nge-avatar-editor-scroll">
      <!-- Effects section — purchasable post-process filters applied to the avatar -->
      <div class="nge-avatar-section">
        <div class="nge-avatar-section-label">Effects</div>
        <div class="nge-avatar-category">
          <div class="nge-avatar-category-row">
            <div class="nge-avatar-category-head">
              <span class="nge-avatar-category-label">Active effect</span>
              <span class="nge-avatar-cat-cost"><img :src="connectomeCoin" class="nge-coin nge-coin--xs" alt="" /> {{ effectPriceMin }}{{ effectPriceMin === effectPriceMax ? '' : `–${effectPriceMax.toLocaleString()}` }}</span>
            </div>
            <div class="nge-avatar-items">
              <button
                class="nge-avatar-item"
                :class="{ 'nge-avatar-item--active': activeEffect === '' }"
                @click="handleEffectClick(null)"
              >None</button>
              <button
                v-for="fx in EFFECTS"
                :key="fx"
                class="nge-avatar-item"
                :class="[
                  `nge-avatar-item--rarity-${effectRarity(fx)}`,
                  {
                    'nge-avatar-item--active': activeEffect === fx,
                    'nge-avatar-item--locked': !store.isEffectUnlocked(fx),
                    'nge-avatar-item--owned': store.isEffectUnlocked(fx) && activeEffect !== fx,
                  }
                ]"
                :title="!store.isEffectUnlocked(fx) ? `${EFFECT_DESCRIPTION[fx]} — ${effectPrice(fx)} coins` : EFFECT_DESCRIPTION[fx]"
                @click="handleEffectClick(fx)"
              >
                <span class="nge-avatar-item-name">{{ fx }}</span>
                <span v-if="!store.isEffectUnlocked(fx)" class="nge-avatar-item-price"><img :src="connectomeCoin" class="nge-coin nge-coin--xs" alt="" />{{ effectPrice(fx) }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div v-for="group in sectionGroups" :key="group.section" class="nge-avatar-section">
        <div class="nge-avatar-section-label">{{ prettify(group.section) }}</div>
        <div v-for="cat in group.categories" :key="cat.category" class="nge-avatar-category">
          <div class="nge-avatar-category-row">
            <div class="nge-avatar-category-head">
              <span class="nge-avatar-category-label">{{ prettify(cat.category) }}</span>
              <span v-if="cat.maxPrice > 0" class="nge-avatar-cat-cost">
<img :src="connectomeCoin" class="nge-coin nge-coin--xs" alt="" />{{ cat.minPrice }}<span v-if="cat.maxPrice !== cat.minPrice">–{{ cat.maxPrice }}</span>
              </span>
            </div>
            <div v-if="cat.items.length === 0" class="nge-avatar-empty">No items match the filter.</div>
            <div class="nge-avatar-items">
              <button
                v-if="cat.optional && filterMode === 'all'"
                class="nge-avatar-item"
                :class="{ 'nge-avatar-item--active': cat.activeItem === null }"
                @click="handleItemClick(cat.category, null)"
              >None</button>
              <button
                v-for="it in cat.items"
                :key="it.name"
                class="nge-avatar-item"
                :class="[
                  `nge-avatar-item--rarity-${it.rarity}`,
                  {
                    'nge-avatar-item--active': it.active,
                    'nge-avatar-item--locked': !it.unlocked,
                    'nge-avatar-item--owned': it.unlocked && !it.active && it.price > 0,
                  }
                ]"
                :title="!it.unlocked ? `${RARITY_LABEL[it.rarity]} — ${it.price} coins` : (it.price > 0 ? `${RARITY_LABEL[it.rarity]} (owned)` : '')"
                @click="handleItemClick(cat.category, it.name)"
              >
                <span class="nge-avatar-item-name">{{ prettify(it.name) }}</span>
                <span v-if="!it.unlocked" class="nge-avatar-item-price"><img :src="connectomeCoin" class="nge-coin nge-coin--xs" alt="" />{{ it.price }}</span>
              </button>
            </div>
          </div>
          <div v-if="cat.colors && cat.colors.length && cat.activeItem" class="nge-avatar-colors">
            <button
              v-for="(color, idx) in cat.colors"
              :key="color + idx"
              class="nge-avatar-color"
              :class="{ 'nge-avatar-color--active': cat.activeColorIndex === idx }"
              :style="{ background: color }"
              :title="color"
              @click="store.setColor(cat.category, idx)"
            />
          </div>
        </div>
      </div>
    </div>

    <Transition name="nge-avatar-purchase">
      <div v-if="purchasePrompt" class="nge-avatar-purchase-overlay" @click.self="cancelPurchase">
        <div class="nge-avatar-purchase-card" :class="`nge-avatar-purchase-card--${purchasePrompt.rarity}`">
          <div class="nge-avatar-purchase-tier">{{ RARITY_LABEL[purchasePrompt.rarity].toUpperCase() }}</div>
          <div class="nge-avatar-purchase-name">{{ prettify(purchasePrompt.item) }}</div>
          <div class="nge-avatar-purchase-cat">{{ prettify(purchasePrompt.category) }}</div>
          <div class="nge-avatar-purchase-tryon">↑ trying on — see how it looks ↑</div>
          <div class="nge-avatar-purchase-cost">
            <img :src="connectomeCoin" class="nge-coin nge-coin--lg" alt="" />
            <span>{{ purchasePrompt.price.toLocaleString() }}</span>
          </div>
          <div class="nge-avatar-purchase-after">
            Balance after: <strong><img :src="connectomeCoin" class="nge-coin" alt="" />{{ (coinsBalance - purchasePrompt.price).toLocaleString() }}</strong>
          </div>
          <div v-if="coinsBalance < purchasePrompt.price" class="nge-avatar-purchase-cant">
            Not enough Connectome Coins. Earn more by editing cells.
          </div>
          <div class="nge-avatar-purchase-actions">
            <button class="nge-avatar-purchase-btn nge-avatar-purchase-btn--cancel" @click="cancelPurchase">Cancel</button>
            <button
              class="nge-avatar-purchase-btn nge-avatar-purchase-btn--confirm"
              :disabled="coinsBalance < purchasePrompt.price"
              @click="confirmPurchase"
            >Unlock</button>
          </div>
        </div>
      </div>
    </Transition>
  </aside>
</template>

<style scoped>
.nge-avatar-editor {
  display: flex;
  flex-direction: column;
  width: 380px;
  flex-shrink: 0;
  background: rgba(10, 14, 30, 0.55);
  border-left: 1px solid rgba(120, 200, 255, 0.1);
  border-radius: 0 12px 12px 0;
  overflow: hidden;
  position: relative;
}

.nge-avatar-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(120, 200, 255, 0.08);
  flex-shrink: 0;
}
.nge-avatar-editor-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.72em;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: rgba(120, 200, 255, 0.85);
  text-shadow: 0 0 10px rgba(74, 158, 255, 0.25);
}

.nge-avatar-balance {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  background: linear-gradient(135deg, rgba(255, 200, 80, 0.12), rgba(255, 160, 60, 0.08));
  border: 1px solid rgba(255, 200, 80, 0.4);
  border-radius: 12px;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 0.78em;
  color: rgba(255, 220, 140, 0.95);
  font-variant-numeric: tabular-nums;
  text-shadow: 0 0 8px rgba(255, 180, 60, 0.25);
  cursor: pointer;
  transition: all 0.15s ease;
}
.nge-avatar-balance:hover {
  background: linear-gradient(135deg, rgba(255, 200, 80, 0.2), rgba(255, 160, 60, 0.14));
  box-shadow: 0 0 12px rgba(255, 180, 60, 0.25);
}
.nge-avatar-balance-num  { font-weight: 600; letter-spacing: 0.02em; }

/* Connectome Coin icon — inline next to numbers. */
.nge-coin {
  display: inline-block;
  height: 1em;
  width: 1em;
  vertical-align: -0.18em;
  margin-right: 0.2em;
  filter: drop-shadow(0 0 4px rgba(255, 200, 80, 0.3));
}
.nge-coin--xs { height: 0.85em; width: 0.85em; vertical-align: -0.1em; }
.nge-coin--lg { height: 1.4em; width: 1.4em; vertical-align: -0.32em; }

.nge-avatar-earn-card {
  margin: 0 16px;
  padding: 10px 12px 8px;
  background: rgba(255, 200, 80, 0.06);
  border: 1px solid rgba(255, 200, 80, 0.18);
  border-radius: 6px;
  font-size: 0.72em;
}
.nge-avatar-earn-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.85em;
  font-weight: 600;
  letter-spacing: 0.18em;
  color: rgba(255, 220, 140, 0.85);
  margin-bottom: 6px;
}
.nge-avatar-earn-row {
  display: flex;
  justify-content: space-between;
  padding: 2px 0;
  color: rgba(255, 255, 255, 0.6);
}
.nge-avatar-earn-row span:last-child {
  font-family: ui-monospace, 'Cascadia Code', monospace;
  color: rgba(255, 220, 140, 0.85);
}
.nge-avatar-earn-divider {
  height: 1px;
  background: rgba(255, 200, 80, 0.15);
  margin: 4px 0;
}
.nge-avatar-earn-row--total span:last-child { font-weight: 700; }
.nge-avatar-earn-row--spent  span:last-child { color: rgba(255, 140, 140, 0.7); }
.nge-avatar-earn-fade-enter-active,
.nge-avatar-earn-fade-leave-active { transition: opacity 0.15s ease, max-height 0.2s ease; overflow: hidden; }
.nge-avatar-earn-fade-enter-from,
.nge-avatar-earn-fade-leave-to { opacity: 0; max-height: 0; }
.nge-avatar-earn-fade-enter-to,
.nge-avatar-earn-fade-leave-from { opacity: 1; max-height: 240px; }

.nge-avatar-progress {
  padding: 10px 16px 4px;
}
.nge-avatar-progress-bar {
  height: 4px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 2px;
  overflow: hidden;
}
.nge-avatar-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, rgba(120, 200, 255, 0.7), rgba(180, 140, 255, 0.7));
  border-radius: 2px;
  transition: width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.nge-avatar-progress-label {
  font-size: 0.68em;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 5px;
  letter-spacing: 0.04em;
}
.nge-avatar-progress-label strong {
  color: rgba(180, 220, 255, 0.85);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.nge-avatar-gender-row {
  display: flex;
  gap: 6px;
  padding: 6px 16px 0;
}
.nge-avatar-gender-btn {
  flex: 1;
  height: 30px;
  border-radius: 6px;
  border: 1px solid rgba(120, 200, 255, 0.2);
  background: rgba(120, 200, 255, 0.04);
  color: rgba(255, 255, 255, 0.55);
  font-size: 1.05em;
  cursor: pointer;
  transition: all 0.15s ease;
}
.nge-avatar-gender-btn:hover:not(:disabled) {
  border-color: rgba(120, 200, 255, 0.5);
  color: rgba(255, 255, 255, 0.85);
}
.nge-avatar-gender-btn--active {
  background: rgba(120, 200, 255, 0.15);
  border-color: rgba(120, 200, 255, 0.7);
  color: rgba(180, 220, 255, 0.95);
  box-shadow: 0 0 12px rgba(74, 158, 255, 0.3);
}
.nge-avatar-gender-btn:disabled { opacity: 0.4; cursor: wait; }

.nge-avatar-filters {
  display: flex;
  gap: 4px;
  padding: 8px 16px 0;
}
.nge-avatar-filter {
  flex: 1;
  padding: 4px 8px;
  font-size: 0.68em;
  font-family: 'Orbitron', sans-serif;
  letter-spacing: 0.08em;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(120, 200, 255, 0.1);
  color: rgba(255, 255, 255, 0.45);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s ease;
}
.nge-avatar-filter:hover {
  border-color: rgba(120, 200, 255, 0.3);
  color: rgba(255, 255, 255, 0.75);
}
.nge-avatar-filter--active {
  background: rgba(120, 200, 255, 0.12);
  border-color: rgba(120, 200, 255, 0.5);
  color: rgba(180, 220, 255, 0.95);
}

.nge-avatar-editor-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 14px 18px;
  scrollbar-width: thin;
  scrollbar-color: rgba(74, 158, 255, 0.2) rgba(255, 255, 255, 0.03);
}
.nge-avatar-editor-scroll::-webkit-scrollbar        { width: 4px; }
.nge-avatar-editor-scroll::-webkit-scrollbar-track  { background: rgba(255, 255, 255, 0.02); }
.nge-avatar-editor-scroll::-webkit-scrollbar-thumb  { background: rgba(74, 158, 255, 0.2); border-radius: 2px; }
.nge-avatar-editor-scroll::-webkit-scrollbar-thumb:hover { background: rgba(74, 158, 255, 0.4); }

.nge-avatar-section { margin-top: 12px; }
.nge-avatar-section-label {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.62em;
  font-weight: 600;
  letter-spacing: 0.22em;
  color: rgba(180, 220, 255, 0.5);
  text-transform: uppercase;
  margin-bottom: 8px;
  padding-left: 4px;
  border-bottom: 1px solid rgba(120, 200, 255, 0.06);
  padding-bottom: 6px;
}

.nge-avatar-category { margin-bottom: 14px; }
.nge-avatar-category-row { display: flex; flex-direction: column; gap: 4px; }
.nge-avatar-category-head {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
}
.nge-avatar-category-label {
  font-size: 0.72em;
  color: rgba(255, 255, 255, 0.55);
  text-transform: capitalize;
  letter-spacing: 0.04em;
}
.nge-avatar-cat-cost {
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 0.62em;
  color: rgba(255, 200, 100, 0.55);
  letter-spacing: 0.04em;
}
.nge-avatar-empty {
  font-size: 0.7em;
  font-style: italic;
  color: rgba(255, 255, 255, 0.3);
  padding: 6px 4px;
}

.nge-avatar-items { display: flex; flex-wrap: wrap; gap: 4px; }

.nge-avatar-item {
  padding: 4px 9px;
  font-size: 0.7em;
  border: 1px solid rgba(120, 200, 255, 0.12);
  background: rgba(120, 200, 255, 0.03);
  color: rgba(255, 255, 255, 0.6);
  border-radius: 4px;
  cursor: pointer;
  text-transform: capitalize;
  transition: all 0.12s ease;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.nge-avatar-item:hover {
  border-color: rgba(120, 200, 255, 0.35);
  color: rgba(255, 255, 255, 0.9);
}
.nge-avatar-item-name { line-height: 1.1; }
.nge-avatar-item-price {
  display: inline-flex;
  align-items: center;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 0.85em;
  color: rgba(255, 200, 100, 0.85);
  letter-spacing: 0;
}

/* Rarity tints — applied as a subtle border accent on standard, more saturated on premium/legendary. */
.nge-avatar-item--rarity-premium {
  border-color: rgba(180, 140, 255, 0.25);
}
.nge-avatar-item--rarity-premium:hover {
  border-color: rgba(180, 140, 255, 0.55);
  color: rgba(220, 200, 255, 0.95);
}
.nge-avatar-item--rarity-legendary {
  border-color: rgba(255, 200, 80, 0.3);
  background: linear-gradient(135deg, rgba(255, 200, 80, 0.04), rgba(120, 200, 255, 0.02));
}
.nge-avatar-item--rarity-legendary:hover {
  border-color: rgba(255, 200, 80, 0.65);
  color: rgba(255, 230, 170, 0.95);
}

/* States stack on top of rarity tint. */
.nge-avatar-item--active {
  background: rgba(120, 200, 255, 0.18);
  border-color: rgba(120, 200, 255, 0.7);
  color: rgba(200, 230, 255, 1);
  box-shadow: 0 0 8px rgba(74, 158, 255, 0.2);
}
.nge-avatar-item--rarity-premium.nge-avatar-item--active {
  background: rgba(180, 140, 255, 0.18);
  border-color: rgba(180, 140, 255, 0.85);
  color: rgba(220, 200, 255, 1);
  box-shadow: 0 0 12px rgba(180, 140, 255, 0.4);
}
.nge-avatar-item--rarity-legendary.nge-avatar-item--active {
  background: rgba(255, 200, 80, 0.18);
  border-color: rgba(255, 200, 80, 0.95);
  color: rgba(255, 235, 180, 1);
  box-shadow: 0 0 14px rgba(255, 200, 80, 0.5);
}
.nge-avatar-item--owned {
  border-color: rgba(110, 230, 180, 0.3);
}
.nge-avatar-item--rarity-premium.nge-avatar-item--owned {
  border-color: rgba(180, 140, 255, 0.45);
}
.nge-avatar-item--rarity-legendary.nge-avatar-item--owned {
  border-color: rgba(255, 200, 80, 0.55);
}
.nge-avatar-item--locked {
  opacity: 0.5;
  background: rgba(120, 200, 255, 0.015);
}
.nge-avatar-item--rarity-standard.nge-avatar-item--locked {
  border-color: rgba(120, 200, 255, 0.06);
}
.nge-avatar-item--locked:hover {
  opacity: 1;
  background: rgba(255, 200, 100, 0.06);
}

.nge-avatar-colors {
  display: flex; gap: 5px; margin-top: 5px; padding-left: 2px; flex-wrap: wrap;
}
.nge-avatar-color {
  width: 18px; height: 18px;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
  padding: 0;
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}
.nge-avatar-color:hover { transform: scale(1.15); }
.nge-avatar-color--active {
  border: 2px solid rgba(180, 220, 255, 0.95);
  box-shadow: 0 0 8px rgba(74, 158, 255, 0.5);
  transform: scale(1.1);
}

/* ── Purchase confirmation card ── */
.nge-avatar-purchase-overlay {
  position: absolute;
  inset: 0;
  background: rgba(5, 8, 18, 0.85);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.nge-avatar-purchase-card {
  background: linear-gradient(180deg, rgba(20, 30, 60, 0.95), rgba(10, 14, 30, 0.95));
  border: 1px solid rgba(255, 200, 80, 0.4);
  border-radius: 10px;
  padding: 22px 24px;
  width: 80%;
  max-width: 320px;
  text-align: center;
  box-shadow: 0 0 30px rgba(255, 180, 60, 0.2), 0 0 0 1px rgba(255, 200, 80, 0.1) inset;
}
.nge-avatar-purchase-card--premium {
  border-color: rgba(180, 140, 255, 0.5);
  box-shadow: 0 0 30px rgba(180, 140, 255, 0.25), 0 0 0 1px rgba(180, 140, 255, 0.15) inset;
}
.nge-avatar-purchase-card--legendary {
  border-color: rgba(255, 200, 80, 0.65);
  box-shadow: 0 0 40px rgba(255, 200, 80, 0.35), 0 0 0 1px rgba(255, 200, 80, 0.2) inset;
}
.nge-avatar-purchase-tier {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.65em;
  font-weight: 700;
  letter-spacing: 0.28em;
  color: rgba(255, 220, 140, 0.85);
  margin-bottom: 12px;
}
.nge-avatar-purchase-card--premium .nge-avatar-purchase-tier   { color: rgba(220, 200, 255, 0.95); }
.nge-avatar-purchase-card--legendary .nge-avatar-purchase-tier { color: rgba(255, 235, 180, 1); }

.nge-avatar-purchase-name {
  font-size: 1.15em;
  font-weight: 600;
  color: rgba(220, 235, 255, 0.95);
  text-transform: capitalize;
  margin-bottom: 4px;
}
.nge-avatar-purchase-cat {
  font-size: 0.7em;
  color: rgba(180, 220, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 8px;
}
.nge-avatar-purchase-tryon {
  font-size: 0.7em;
  color: rgba(180, 220, 255, 0.55);
  font-style: italic;
  letter-spacing: 0.06em;
  margin-bottom: 12px;
  animation: nge-avatar-tryon-pulse 2.4s ease-in-out infinite;
}
@keyframes nge-avatar-tryon-pulse {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 0.85; }
}
.nge-avatar-purchase-cost {
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 1.5em;
  color: rgba(255, 220, 140, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 6px;
  text-shadow: 0 0 12px rgba(255, 180, 60, 0.4);
}
.nge-avatar-purchase-after {
  font-size: 0.78em;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 14px;
}
.nge-avatar-purchase-after strong {
  color: rgba(180, 220, 255, 0.85);
  font-variant-numeric: tabular-nums;
}
.nge-avatar-purchase-cant {
  font-size: 0.75em;
  color: rgba(255, 140, 140, 0.85);
  margin-bottom: 12px;
  font-style: italic;
}
.nge-avatar-purchase-actions { display: flex; gap: 10px; justify-content: center; }
.nge-avatar-purchase-btn {
  padding: 8px 18px;
  font-family: 'Orbitron', sans-serif;
  font-size: 0.7em;
  letter-spacing: 0.12em;
  border-radius: 5px;
  cursor: pointer;
  font-weight: 600;
  border: 1px solid;
  transition: all 0.15s ease;
}
.nge-avatar-purchase-btn--cancel {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.7);
}
.nge-avatar-purchase-btn--cancel:hover { background: rgba(255, 255, 255, 0.08); }
.nge-avatar-purchase-btn--confirm {
  background: rgba(255, 200, 80, 0.15);
  border-color: rgba(255, 200, 80, 0.6);
  color: rgba(255, 220, 140, 0.95);
}
.nge-avatar-purchase-btn--confirm:hover:not(:disabled) {
  background: rgba(255, 200, 80, 0.25);
  box-shadow: 0 0 14px rgba(255, 180, 60, 0.4);
}
.nge-avatar-purchase-btn--confirm:disabled { opacity: 0.4; cursor: not-allowed; }

.nge-avatar-purchase-enter-active,
.nge-avatar-purchase-leave-active { transition: opacity 0.18s ease; }
.nge-avatar-purchase-enter-active .nge-avatar-purchase-card,
.nge-avatar-purchase-leave-active .nge-avatar-purchase-card { transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1); }
.nge-avatar-purchase-enter-from,
.nge-avatar-purchase-leave-to { opacity: 0; }
.nge-avatar-purchase-enter-from .nge-avatar-purchase-card,
.nge-avatar-purchase-leave-to .nge-avatar-purchase-card { transform: scale(0.92); }
</style>
