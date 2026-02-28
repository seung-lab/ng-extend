<script setup lang="ts">
import {storeToRefs} from 'pinia';
import ModalOverlay from 'components/ModalOverlay.vue';

import {useLoginStore, useUserStatsStore} from '../store';
import {BADGE_DEFINITIONS} from '../widgets/badge_definitions';
import {BADGE_IMAGE_MAP} from '../widgets/badge_images';

const {sessions} = storeToRefs(useLoginStore());
const {stats} = storeToRefs(useUserStatsStore());

function getBadgeUrl(imageKey: string): string {
  return BADGE_IMAGE_MAP[imageKey] ?? '';
}

function isBadgeEarned(editThreshold: number): boolean {
  if (editThreshold === 0) return false;  // manual-grant only
  return (stats.value.editsAllTime ?? 0) >= editThreshold;
}

const emit = defineEmits({hide: null});
</script>

<template>
  <!-- id ensures old instances are replaced; v-if on parent handles lifecycle in production -->
  <modal-overlay id="nge-profile-modal" class="nge-profile-modal" @hide="emit('hide')">
    <button class="nge-profile-exit" @click="emit('hide')">×</button>

    <div class="nge-profile-content">
      <!-- Header: name + email -->
      <div class="nge-profile-header" v-if="sessions.length > 0">
        <div class="nge-profile-name">{{ sessions[0].name }}</div>
        <div class="nge-profile-email">{{ sessions[0].email }}</div>
      </div>

      <!-- Stats grid: Edits | Cells -->
      <div class="nge-profile-grid">
        <!-- Edits column -->
        <div>
          <div class="nge-profile-col-header">Edits</div>
          <div class="nge-profile-subgrid">
            <div class="nge-profile-timespan">Today</div>
            <div class="nge-profile-timespan">Past 7 Days</div>
            <div class="nge-profile-timespan">All Time</div>
            <div class="nge-profile-count">
              {{ stats.editsToday }}
              <span class="nge-profile-split">({{ stats.mergesToday }} | {{ stats.splitsToday }})</span>
            </div>
            <div class="nge-profile-count">
              {{ stats.editsThisWeek }}
              <span class="nge-profile-split">({{ stats.mergesThisWeek }} | {{ stats.splitsThisWeek }})</span>
            </div>
            <div class="nge-profile-count">
              {{ stats.editsAllTime }}
              <span class="nge-profile-split">({{ stats.mergesAllTime }} | {{ stats.splitsAllTime }})</span>
            </div>
          </div>
        </div>

        <!-- Cells column -->
        <div>
          <div class="nge-profile-col-header">Cells</div>
          <div class="nge-profile-subgrid">
            <div class="nge-profile-timespan">Today</div>
            <div class="nge-profile-timespan">Past 7 Days</div>
            <div class="nge-profile-timespan">All Time</div>
            <div class="nge-profile-count">0</div>
            <div class="nge-profile-count">0</div>
            <div class="nge-profile-count">{{ stats.cellsSubmitted }}</div>
          </div>
        </div>
      </div>

      <!-- Badges -->
      <div class="nge-profile-badges">
        <div class="nge-profile-badges-label">Badges</div>
        <div class="nge-profile-badges-grid">
          <div
            v-for="badge in BADGE_DEFINITIONS"
            :key="badge.id"
            class="nge-profile-badge"
            :class="{ 'nge-profile-badge--locked': !isBadgeEarned(badge.editThreshold) }"
            :title="isBadgeEarned(badge.editThreshold)
              ? badge.name + ' — ' + badge.description
              : badge.name + ' (locked: ' + badge.editThreshold.toLocaleString() + ' edits)'"
          >
            <div class="nge-profile-badge-img">
              <img
                :src="getBadgeUrl(badge.imageKey)"
                :alt="badge.name"
                class="nge-profile-badge-icon"
              />
            </div>
            <div class="nge-profile-badge-name">{{ badge.name }}</div>
          </div>
        </div>
      </div>

      <!-- Hook: user profile repo connects here via useUserStatsStore().setStats({...}) -->
    </div>
  </modal-overlay>
</template>

<style scoped>
.nge-profile-modal {
  font-size: 0.9em;
}

.nge-profile-exit {
  position: absolute;
  top: 10px;
  right: 14px;
  background: none;
  border: none;
  color: #aaa;
  font-size: 1.6em;
  cursor: pointer;
  line-height: 1;
  padding: 0;
}

.nge-profile-exit:hover {
  color: #fff;
}

.nge-profile-content {
  width: 540px;
  max-height: 80vh;
  overflow-y: auto;
  padding: 40px 50px 30px;
  box-sizing: border-box;
}

.nge-profile-header {
  padding-bottom: 28px;
}

.nge-profile-name {
  font-size: 1.4em;
  font-weight: 600;
}

.nge-profile-email {
  font-style: italic;
  color: #9e9e9e;
  font-size: 0.9em;
}

/* ── Stats grid ─────────────────────────────────── */
.nge-profile-grid {
  display: grid;
  grid-template-columns: 50% 50%;
  margin-bottom: 24px;
}

.nge-profile-col-header {
  padding-bottom: 14px;
  font-size: 1.4em;
  font-weight: 600;
}

.nge-profile-subgrid {
  display: grid;
  grid-template-columns: 33% 33% 34%;
}

.nge-profile-timespan {
  font-size: 0.78em;
  color: #9e9e9e;
  padding-bottom: 6px;
}

.nge-profile-count {
  font-size: 1.1em;
  padding-bottom: 4px;
}

.nge-profile-split {
  display: block;
  font-size: 0.75em;
  color: #9e9e9e;
  white-space: nowrap;
}

/* ── Badges ────────────────────────────────────── */
.nge-profile-badges-label {
  font-size: 1.4em;
  font-weight: 600;
  padding-top: 16px;
  padding-bottom: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.nge-profile-badges-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 10px;
}

.nge-profile-badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  cursor: default;
  transition: transform 0.1s;
}

.nge-profile-badge:hover {
  transform: scale(1.06);
}

.nge-profile-badge--locked {
  opacity: 0.28;
  filter: grayscale(100%);
}

.nge-profile-badge-img {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  height: 60px;
}

.nge-profile-badge-icon {
  width: 54px;
  height: 54px;
  object-fit: contain;
}

.nge-profile-badge-name {
  font-size: 0.68em;
  color: #bbb;
  margin-top: 4px;
  line-height: 1.2;
  max-width: 72px;
  word-break: break-word;
}

.nge-profile-badge--locked .nge-profile-badge-name {
  color: #666;
}
</style>
