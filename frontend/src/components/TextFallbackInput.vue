<script setup lang="ts">
import { ref } from 'vue';
import { MAX_MESSAGE_LEN } from '../constants';

defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{ submit: [text: string] }>();

const text = ref('');

function submit() {
  const trimmed = text.value.trim();
  if (!trimmed) return;
  emit('submit', trimmed);
  text.value = '';
}
</script>

<template>
  <form class="fallback" @submit.prevent="submit">
    <input
      v-model="text"
      type="text"
      placeholder="Type your message…"
      :maxlength="MAX_MESSAGE_LEN"
      :disabled="disabled"
    />
    <button type="submit" :disabled="disabled || !text.trim()">Send</button>
  </form>
</template>

<style scoped>
.fallback {
  display: flex;
  gap: var(--space-2);
}

input {
  flex: 1;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  font-size: 1rem;
}

input:disabled {
  opacity: 0.6;
}

button {
  padding: 0 var(--space-5);
  border-radius: var(--radius-full);
  border: none;
  background: var(--color-primary);
  color: #fff;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
