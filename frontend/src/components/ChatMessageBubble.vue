<script setup lang="ts">
import type { ChatMessage } from '../types/chat';

defineProps<{
  message: ChatMessage;
}>();
</script>

<template>
  <div class="row" :class="message.role">
    <div class="bubble" :class="{ user: message.role === 'user', error: message.isError }">
      {{ message.content }}<span v-if="message.isStreaming" class="cursor">▍</span>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  animation: fade-in 0.15s ease;
}

.row.user {
  justify-content: flex-end;
}

.row.assistant {
  justify-content: flex-start;
}

.bubble {
  max-width: 80%;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--color-bot-bubble);
  color: var(--color-bot-bubble-text);
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.4;
}

.bubble.user {
  background: var(--color-user-bubble);
  color: var(--color-user-bubble-text);
  border-bottom-right-radius: var(--radius-sm);
}

.row.assistant .bubble {
  border-bottom-left-radius: var(--radius-sm);
}

.bubble.error {
  background: var(--color-error-bg);
  color: var(--color-error);
}

.cursor {
  display: inline-block;
  animation: bounce-dot 1s steps(2) infinite;
}
</style>
