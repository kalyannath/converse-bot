<script setup lang="ts">
type MicState = 'idle' | 'listening' | 'thinking' | 'speaking';

defineProps<{
  state: MicState;
  disabled?: boolean;
}>();

const emit = defineEmits<{ click: [] }>();

const labels: Record<MicState, string> = {
  idle: 'Start speaking',
  listening: 'Listening… tap to stop',
  thinking: 'Thinking…',
  speaking: 'Bot is speaking… tap to interrupt',
};
</script>

<template>
  <button
    class="mic-button"
    :class="state"
    :disabled="disabled"
    :aria-label="labels[state]"
    :title="labels[state]"
    @click="emit('click')"
  >
    <span v-if="state === 'thinking'" class="dots">
      <span></span><span></span><span></span>
    </span>
    <span v-else-if="state === 'speaking'" class="waveform">
      <span></span><span></span><span></span><span></span>
    </span>
    <svg v-else width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Z"
        fill="currentColor"
      />
      <path
        d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V21a1 1 0 1 0 2 0v-3.07A7 7 0 0 0 19 11Z"
        fill="currentColor"
      />
    </svg>
  </button>
</template>

<style scoped>
.mic-button {
  width: 84px;
  height: 84px;
  border-radius: var(--radius-full);
  border: none;
  background: var(--color-primary);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: var(--shadow-md);
  transition:
    background 0.15s ease,
    transform 0.1s ease;
  flex-shrink: 0;
}

.mic-button:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.mic-button:active:not(:disabled) {
  transform: scale(0.96);
}

.mic-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mic-button.listening {
  animation: mic-pulse 1.6s ease-out infinite;
}

.mic-button.speaking {
  background: var(--color-success);
}

.dots,
.waveform {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dots span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #fff;
  animation: bounce-dot 1.2s infinite ease-in-out;
}

.dots span:nth-child(2) {
  animation-delay: 0.15s;
}
.dots span:nth-child(3) {
  animation-delay: 0.3s;
}

.waveform span {
  width: 4px;
  height: 18px;
  border-radius: 2px;
  background: #fff;
  animation: bounce-dot 0.9s infinite ease-in-out;
}

.waveform span:nth-child(2) {
  animation-delay: 0.12s;
}
.waveform span:nth-child(3) {
  animation-delay: 0.24s;
}
.waveform span:nth-child(4) {
  animation-delay: 0.36s;
}
</style>
