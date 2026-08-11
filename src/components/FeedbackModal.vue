<script setup lang="ts">
/**
 * FeedbackModal.vue
 * "Submit an issue" — lets any user report a bug / idea / data problem from
 * anywhere in the app. Posts to the `submitIssue` Cloud Function which relays
 * to Slack (#citsci_feedback) and keeps a Firestore record. No auth required.
 */
import { ref } from 'vue';
import ModalOverlay from 'components/ModalOverlay.vue';
import { useProofreadingBackendStore } from '../store';
import { mintShortStateLink } from '../util/state_link';

const emit = defineEmits({ hide: null });
const backend = useProofreadingBackendStore();

const ISSUE_URL =
  (window as any).__NGE_SUBMIT_ISSUE_URL ||
  'https://us-central1-ytho-4bff2.cloudfunctions.net/submitIssue';

const CATEGORIES = ['Bug', 'Idea', 'Data problem', 'Other'] as const;
const category = ref<typeof CATEGORIES[number]>('Bug');
const message = ref('');
const sending = ref(false);
const done = ref(false);
const error = ref('');

function currentDataset(): string {
  try {
    const viewer = (window as any)['viewer'];
    for (const ml of viewer?.layerManager?.managedLayers ?? []) {
      if ((ml.layer?.constructor?.name ?? '').includes('Segmentation')) return ml.name ?? '';
    }
  } catch {}
  return '';
}

async function submit() {
  const text = message.value.trim();
  if (!text || sending.value) {
    if (!text) error.value = 'Please describe the issue.';
    return;
  }
  sending.value = true;
  error.value = '';
  try {
    // NEVER send window.location.href: the hash carries the full viewer
    // state (multiple KB) and relays like Slack truncate it, leaving a link
    // that dies with "Error parsing state: Unterminated string in JSON".
    // Mint a short saved-state link instead; if that fails (no auth, state
    // server down), send the bare page URL plus the position so the report
    // still locates the spot without a broken link.
    const shortLink = await mintShortStateLink();
    let pageUrl = shortLink;
    if (!pageUrl) {
      const v: any = (window as any)['viewer'];
      const pos = v?.navigationState?.position?.value;
      const at = pos ? ` @ ${Math.round(pos[0])},${Math.round(pos[1])},${Math.round(pos[2])}` : '';
      pageUrl = `${window.location.origin}${window.location.pathname}${at}`;
    }
    const res = await fetch(ISSUE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: text,
        category: category.value,
        url: pageUrl,
        dataset: currentDataset(),
        user: backend.userName || '',
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Mirror into Supabase so the triage agent can read reports (the Cloud
    // Function's Slack/Firestore relay stays the human-facing feed).
    // Best-effort: a failure here must not surface as a failed submit.
    try {
      const { supabase } = await import('../supabase');
      await supabase.from('site_issues').insert({
        category: category.value,
        message: text,
        url: pageUrl,
        dataset: currentDataset() || null,
        user_id: backend.userId || null,
        user_name: backend.userName || null,
      });
    } catch (e) {
      console.warn('[feedback] Supabase mirror failed:', e);
    }
    done.value = true;
    setTimeout(() => emit('hide'), 1600);
  } catch (e: any) {
    error.value = 'Could not submit — please try again.';
    console.warn('[feedback] submit failed:', e);
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <modal-overlay id="nge-feedback-modal" class="nge-feedback-modal" @hide="emit('hide')">
    <div class="nge-fb-shell">
      <button class="nge-fb-exit" @click="emit('hide')">×</button>

      <div v-if="!done" class="nge-fb-body">
        <div class="nge-fb-title">Submit an issue</div>
        <div class="nge-fb-hint">Found a bug or have an idea? Tell us — it goes straight to the team.</div>

        <div class="nge-fb-chips">
          <button
            v-for="c in CATEGORIES" :key="c"
            class="nge-fb-chip"
            :class="{ 'nge-fb-chip--active': category === c }"
            @click="category = c"
          >{{ c }}</button>
        </div>

        <textarea
          v-model="message"
          class="nge-fb-note"
          rows="4"
          placeholder="What happened? What did you expect? Steps to reproduce help a lot."
          @keydown.stop @keyup.stop @keypress.stop
          @input="error = ''"
        ></textarea>

        <div v-if="error" class="nge-fb-err">{{ error }}</div>

        <div class="nge-fb-actions">
          <button class="nge-fb-submit" :disabled="sending" @click="submit">
            {{ sending ? 'Sending…' : 'Submit' }}
          </button>
          <button class="nge-fb-cancel" @click="emit('hide')">Cancel</button>
        </div>
      </div>

      <div v-else class="nge-fb-done">
        <div class="nge-fb-done-icon">✓</div>
        <div class="nge-fb-done-text">Thanks — your report was sent.</div>
      </div>
    </div>
  </modal-overlay>
</template>

<style scoped>
.nge-feedback-modal { font-size: 0.9em; }
.nge-fb-shell {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 340px;
  max-width: 460px;
  padding: 20px 22px;
}
.nge-fb-exit {
  position: absolute;
  top: 8px;
  right: 10px;
  background: none;
  border: none;
  color: #889;
  font-size: 1.4em;
  cursor: pointer;
  line-height: 1;
}
.nge-fb-exit:hover { color: #ccd; }
.nge-fb-title {
  font-size: 1.15em;
  font-weight: 700;
  color: #eef;
  margin-bottom: 4px;
}
.nge-fb-hint {
  font-size: 0.82em;
  color: #99a;
  margin-bottom: 14px;
}
.nge-fb-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}
.nge-fb-chip {
  font-size: 0.78em;
  padding: 4px 12px;
  border-radius: 14px;
  color: #bcd;
  background: rgba(120, 140, 255, 0.08);
  border: 1px solid rgba(120, 140, 255, 0.2);
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
}
.nge-fb-chip:hover { background: rgba(120, 140, 255, 0.16); }
.nge-fb-chip--active {
  background: rgba(120, 140, 255, 0.28);
  border-color: rgba(150, 170, 255, 0.6);
  color: #fff;
}
.nge-fb-note {
  width: 100%;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #ccd;
  font-size: 0.86em;
  font-family: inherit;
  padding: 8px 10px;
  resize: vertical;
  min-height: 84px;
}
.nge-fb-note:focus { outline: none; border-color: rgba(120, 140, 255, 0.5); }
.nge-fb-note::placeholder { color: #667; }
.nge-fb-err { color: #ff9d9d; font-size: 0.78em; margin-top: 6px; }
.nge-fb-actions {
  display: flex;
  gap: 8px;
  margin-top: 14px;
}
.nge-fb-submit {
  padding: 7px 18px;
  font-size: 0.84em;
  font-weight: 600;
  color: #fff;
  background: rgba(90, 130, 255, 0.9);
  border: 1px solid rgba(120, 150, 255, 0.7);
  border-radius: 7px;
  cursor: pointer;
}
.nge-fb-submit:hover:not(:disabled) { background: rgba(110, 150, 255, 1); }
.nge-fb-submit:disabled { opacity: 0.5; cursor: default; }
.nge-fb-cancel {
  padding: 7px 16px;
  font-size: 0.84em;
  color: #99a;
  background: none;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  cursor: pointer;
}
.nge-fb-cancel:hover { color: #ccd; border-color: rgba(255, 255, 255, 0.25); }
.nge-fb-done {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 30px 24px;
  min-width: 300px;
}
.nge-fb-done-icon {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(0, 220, 120, 0.15);
  border: 1px solid rgba(0, 220, 120, 0.5);
  color: #34e6a8;
  font-size: 1.4em;
}
.nge-fb-done-text { color: #cde; font-size: 0.9em; }
</style>
