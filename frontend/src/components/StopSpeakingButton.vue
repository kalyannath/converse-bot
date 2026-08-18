<script setup lang="ts">
defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{ click: [] }>();
</script>

<template>
  <button v-if="visible" class="stop-btn" @click="emit('click')">
    <span class="square" /> Stop
  </button>
</template>

<style scoped>
.stop-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  align-self: center;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
  cursor: pointer;
  animation: fade-in 0.15s ease;
}

.square {
  width: 10px;
  height: 10px;
  background: var(--color-error);
  border-radius: 2px;
}
</style>
