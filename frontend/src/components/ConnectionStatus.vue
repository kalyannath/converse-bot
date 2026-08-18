<script setup lang="ts">
import { computed } from 'vue';
import type { ConnectionState } from '../types/socket-events';

const props = defineProps<{
  state: ConnectionState;
}>();

const labels: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  waking: 'Waking up the server, this can take up to a minute…',
  disconnected: 'Disconnected',
};

const dotClass = computed(() => (props.state === 'connected' ? 'ok' : props.state === 'disconnected' ? 'bad' : 'warn'));
</script>

<template>
  <div class="status" :class="dotClass">
    <span class="dot" />
    {{ labels[state] }}
  </div>
</template>

<style scoped>
.status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  font-size: 0.85rem;
  color: var(--color-text-muted);
  padding: var(--space-1) 0;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted);
}

.status.ok .dot {
  background: var(--color-success);
}

.status.warn .dot {
  background: var(--color-warning);
}

.status.bad .dot {
  background: var(--color-error);
}
</style>
