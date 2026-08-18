<script setup lang="ts">
defineProps<{
  text: string;
  visible: boolean;
}>();
</script>

<template>
  <div v-if="visible" class="interim">
    {{ text || '…' }}
  </div>
</template>

<style scoped>
.interim {
  text-align: center;
  font-style: italic;
  color: var(--color-text-muted);
  min-height: 1.2em;
  padding: 0 var(--space-4);
  animation: fade-in 0.15s ease;
}
</style>
