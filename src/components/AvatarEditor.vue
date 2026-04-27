<script setup lang="ts">
import {computed, ref} from 'vue';
import {storeToRefs} from 'pinia';
import {useAvatarStore, AvatarGender} from '../store';
import {itemCost, formatCoins} from '../widgets/avatar/economy';

const store = useAvatarStore();
const {gender, ready, version, coinsBalance} = storeToRefs(store);

interface SectionGroup {
  section: string;
  categories: ReturnType<typeof store.categoryViews>;
}

const sectionGroups = computed<SectionGroup[]>(() => {
  void version.value;
  const all = store.categoryViews();
  const grouped = new Map<string, SectionGroup>();
  for (const v of all) {
    if (!grouped.has(v.section)) {
      grouped.set(v.section, {section: v.section, categories: []});
    }
    grouped.get(v.section)!.categories.push(v);
  }
  return [...grouped.values()];
});

function prettify(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
}

const purchasePrompt = ref<{category: string; item: string; cost: number} | null>(null);

function handleItemClick(category: string, itemName: string | null) {
  if (itemName === null) {
    store.selectItem(category, null);
    return;
  }
  const cost = itemCost(category);
  if (cost === 0 || store.isUnlocked(category, itemName)) {
    store.selectItem(category, itemName);
    return;
  }
  // Locked — open purchase prompt
  purchasePrompt.value = {category, item: itemName, cost};
}

async function confirmPurchase() {
  if (!purchasePrompt.value) return;
  const {category, item} = purchasePrompt.value;
  await store.purchase(category, item);
  purchasePrompt.value = null;
}
function cancelPurchase() { purchasePrompt.value = null; }
</script>

<template>
  <aside class="nge-avatar-editor">
    <div class="nge-avatar-editor-header">
      <div class="nge-avatar-editor-title">CUSTOMIZE</div>
      <div class="nge-avatar-balance" :title="`${coinsBalance.toLocaleString()} Connectome Coins`">
        <span class="nge-avatar-balance-icon">◎</span>
        <span class="nge-avatar-balance-num">{{ formatCoins(coinsBalance) }}</span>
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

    <div class="nge-avatar-editor-scroll">
      <div v-for="group in sectionGroups" :key="group.section" class="nge-avatar-section">
        <div class="nge-avatar-section-label">{{ prettify(group.section) }}</div>
        <div v-for="cat in group.categories" :key="cat.category" class="nge-avatar-category">
          <div class="nge-avatar-category-row">
            <div class="nge-avatar-category-head">
              <span class="nge-avatar-category-label">{{ prettify(cat.category) }}</span>
              <span v-if="itemCost(cat.category) > 0" class="nge-avatar-cat-cost">
                ◎{{ itemCost(cat.category) }} ea
              </span>
            </div>
            <div class="nge-avatar-items">
              <button
                v-if="cat.optional"
                class="nge-avatar-item"
                :class="{ 'nge-avatar-item--active': cat.activeItem === null }"
                @click="handleItemClick(cat.category, null)"
              >None</button>
              <button
                v-for="itemName in cat.items"
                :key="itemName"
                class="nge-avatar-item"
                :class="{
                  'nge-avatar-item--active': cat.activeItem === itemName,
                  'nge-avatar-item--locked': itemCost(cat.category) > 0 && !store.isUnlocked(cat.category, itemName),
                  'nge-avatar-item--owned': itemCost(cat.category) > 0 && store.isUnlocked(cat.category, itemName) && cat.activeItem !== itemName,
                }"
                :title="itemCost(cat.category) > 0 && !store.isUnlocked(cat.category, itemName) ? `Locked — ${itemCost(cat.category)} coins` : ''"
                @click="handleItemClick(cat.category, itemName)"
              >
                <span>{{ prettify(itemName) }}</span>
                <span
                  v-if="itemCost(cat.category) > 0 && !store.isUnlocked(cat.category, itemName)"
                  class="nge-avatar-item-price"
                >◎{{ itemCost(cat.category) }}</span>
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
        <div class="nge-avatar-purchase-card">
          <div class="nge-avatar-purchase-title">UNLOCK ITEM</div>
          <div class="nge-avatar-purchase-name">{{ prettify(purchasePrompt.item) }}</div>
          <div class="nge-avatar-purchase-cat">{{ prettify(purchasePrompt.category) }}</div>
          <div class="nge-avatar-purchase-cost">
            <span class="nge-avatar-balance-icon">◎</span>
            <span>{{ purchasePrompt.cost.toLocaleString() }} coins</span>
          </div>
          <div class="nge-avatar-purchase-after">
            Balance after: <strong>{{ (coinsBalance - purchasePrompt.cost).toLocaleString() }}</strong>
          </div>
          <div v-if="coinsBalance < purchasePrompt.cost" class="nge-avatar-purchase-cant">
            Not enough Connectome Coins. Earn more by editing cells.
          </div>
          <div class="nge-avatar-purchase-actions">
            <button class="nge-avatar-purchase-btn nge-avatar-purchase-btn--cancel" @click="cancelPurchase">Cancel</button>
            <button
              class="nge-avatar-purchase-btn nge-avatar-purchase-btn--confirm"
              :disabled="coinsBalance < purchasePrompt.cost"
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
}
.nge-avatar-balance-icon {
  font-size: 1.05em;
  line-height: 1;
}
.nge-avatar-balance-num { font-weight: 600; letter-spacing: 0.02em; }

.nge-avatar-gender-row {
  display: flex;
  gap: 6px;
  padding: 10px 16px 0;
}
.nge-avatar-gender-btn {
  flex: 1;
  height: 32px;
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
.nge-avatar-item--active {
  background: rgba(120, 200, 255, 0.18);
  border-color: rgba(120, 200, 255, 0.7);
  color: rgba(200, 230, 255, 1);
  box-shadow: 0 0 8px rgba(74, 158, 255, 0.2);
}
.nge-avatar-item--owned {
  border-color: rgba(110, 230, 180, 0.3);
}
.nge-avatar-item--locked {
  opacity: 0.55;
  border-color: rgba(120, 200, 255, 0.06);
  background: rgba(120, 200, 255, 0.015);
}
.nge-avatar-item--locked:hover {
  opacity: 0.95;
  border-color: rgba(255, 200, 100, 0.5);
  color: rgba(255, 220, 140, 0.95);
  background: rgba(255, 200, 100, 0.06);
}
.nge-avatar-item-price {
  display: inline-flex;
  align-items: center;
  font-family: ui-monospace, 'Cascadia Code', monospace;
  font-size: 0.85em;
  color: rgba(255, 200, 100, 0.85);
  letter-spacing: 0;
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
.nge-avatar-purchase-title {
  font-family: 'Orbitron', sans-serif;
  font-size: 0.7em;
  font-weight: 600;
  letter-spacing: 0.22em;
  color: rgba(255, 220, 140, 0.85);
  margin-bottom: 12px;
}
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
  margin-bottom: 14px;
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
.nge-avatar-purchase-actions {
  display: flex;
  gap: 10px;
  justify-content: center;
}
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
.nge-avatar-purchase-btn--cancel:hover {
  background: rgba(255, 255, 255, 0.08);
}
.nge-avatar-purchase-btn--confirm {
  background: rgba(255, 200, 80, 0.15);
  border-color: rgba(255, 200, 80, 0.6);
  color: rgba(255, 220, 140, 0.95);
}
.nge-avatar-purchase-btn--confirm:hover:not(:disabled) {
  background: rgba(255, 200, 80, 0.25);
  box-shadow: 0 0 14px rgba(255, 180, 60, 0.4);
}
.nge-avatar-purchase-btn--confirm:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.nge-avatar-purchase-enter-active,
.nge-avatar-purchase-leave-active {
  transition: opacity 0.18s ease;
}
.nge-avatar-purchase-enter-active .nge-avatar-purchase-card,
.nge-avatar-purchase-leave-active .nge-avatar-purchase-card {
  transition: transform 0.18s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.nge-avatar-purchase-enter-from,
.nge-avatar-purchase-leave-to {
  opacity: 0;
}
.nge-avatar-purchase-enter-from .nge-avatar-purchase-card,
.nge-avatar-purchase-leave-to .nge-avatar-purchase-card {
  transform: scale(0.92);
}
</style>
