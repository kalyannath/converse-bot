<script setup lang="ts">
import { MAX_SPEECH_RATE, MIN_SPEECH_RATE } from '../constants';
import VoiceSelect from './VoiceSelect.vue';

defineProps<{
  open: boolean;
  voices: SpeechSynthesisVoice[];
  selectedVoiceUri: string;
  rate: number;
}>();

const emit = defineEmits<{
  close: [];
  'update:selectedVoiceUri': [uri: string];
  'update:rate': [rate: number];
  clear: [];
}>();
</script>

<template>
  <div v-if="open" class="backdrop" @click.self="emit('close')">
    <div class="panel">
      <header>
        <h2>Settings</h2>
        <button class="close" aria-label="Close settings" @click="emit('close')">✕</button>
      </header>

      <div class="field">
        <label>Voice</label>
        <VoiceSelect
          :voices="voices"
          :model-value="selectedVoiceUri"
          @update:model-value="(v) => emit('update:selectedVoiceUri', v)"
        />
      </div>

      <div class="field">
        <label>Speech rate: {{ rate.toFixed(1) }}×</label>
        <input
          type="range"
          :min="MIN_SPEECH_RATE"
          :max="MAX_SPEECH_RATE"
          step="0.1"
          :value="rate"
          @input="emit('update:rate', Number(($event.target as HTMLInputElement).value))"
        />
      </div>

      <button class="clear-btn" @click="emit('clear')">Clear conversation</button>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 20;
}

.panel {
  width: 100%;
  max-width: 640px;
  background: var(--color-surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  animation: fade-in 0.15s ease;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

h2 {
  margin: 0;
  font-size: 1.1rem;
}

.close {
  border: none;
  background: none;
  color: var(--color-text-muted);
  font-size: 1.1rem;
  cursor: pointer;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.field label {
  font-size: 0.85rem;
  color: var(--color-text-muted);
}

input[type='range'] {
  width: 100%;
}

.clear-btn {
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-error);
  background: transparent;
  color: var(--color-error);
  cursor: pointer;
}
</style>
