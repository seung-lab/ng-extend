<script setup lang="ts">
import {computed} from 'vue';
import {storeToRefs} from 'pinia';
import {useAvatarStore, AvatarGender} from '../store';

const store = useAvatarStore();
const {gender, ready, version} = storeToRefs(store);

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
</script>

<template>
  <aside class="nge-avatar-editor">
    <div class="nge-avatar-editor-header">
      <div class="nge-avatar-editor-title">CUSTOMIZE</div>
      <div class="nge-avatar-gender">
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
    </div>

    <div class="nge-avatar-editor-scroll">
      <div v-for="group in sectionGroups" :key="group.section" class="nge-avatar-section">
        <div class="nge-avatar-section-label">{{ prettify(group.section) }}</div>
        <div v-for="cat in group.categories" :key="cat.category" class="nge-avatar-category">
          <div class="nge-avatar-category-row">
            <div class="nge-avatar-category-label">{{ prettify(cat.category) }}</div>
            <div class="nge-avatar-items">
              <button
                v-if="cat.optional"
                class="nge-avatar-item"
                :class="{ 'nge-avatar-item--active': cat.activeItem === null }"
                @click="store.selectItem(cat.category, null)"
              >None</button>
              <button
                v-for="itemName in cat.items"
                :key="itemName"
                class="nge-avatar-item"
                :class="{ 'nge-avatar-item--active': cat.activeItem === itemName }"
                @click="store.selectItem(cat.category, itemName)"
              >{{ prettify(itemName) }}</button>
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
}

.nge-avatar-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 12px;
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
.nge-avatar-gender {
  display: flex;
  gap: 6px;
}
.nge-avatar-gender-btn {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid rgba(120, 200, 255, 0.2);
  background: rgba(120, 200, 255, 0.04);
  color: rgba(255, 255, 255, 0.55);
  font-size: 1em;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
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

.nge-avatar-section {
  margin-top: 12px;
}
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
.nge-avatar-category {
  margin-bottom: 14px;
}
.nge-avatar-category-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.nge-avatar-category-label {
  font-size: 0.72em;
  color: rgba(255, 255, 255, 0.55);
  text-transform: capitalize;
  letter-spacing: 0.04em;
}
.nge-avatar-items {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
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

.nge-avatar-colors {
  display: flex;
  gap: 5px;
  margin-top: 5px;
  padding-left: 2px;
  flex-wrap: wrap;
}
.nge-avatar-color {
  width: 18px;
  height: 18px;
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
</style>
