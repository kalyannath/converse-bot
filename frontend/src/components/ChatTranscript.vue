<script setup lang="ts">
import { nextTick, watch } from 'vue';
import { useTemplateRef } from 'vue';
import type { ChatMessage } from '../types/chat';
import ChatMessageBubble from './ChatMessageBubble.vue';

const props = defineProps<{
  messages: ChatMessage[];
}>();

const containerRef = useTemplateRef<HTMLDivElement>('container');

watch(
  () => [props.messages.length, props.messages.at(-1)?.content],
  async () => {
    await nextTick();
    const el = containerRef.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);
</script>

<template>
  <div ref="container" class="transcript">
    <p v-if="messages.length === 0" class="empty">Tap the mic and say something to get started.</p>
    <ChatMessageBubble v-for="message in messages" :key="message.id" :message="message" />
  </div>
</template>

<style scoped>
.transcript {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-2);
}

.empty {
  margin: auto;
  color: var(--color-text-muted);
  text-align: center;
}
</style>
