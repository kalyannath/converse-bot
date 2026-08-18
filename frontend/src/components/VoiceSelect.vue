<script setup lang="ts">
defineProps<{
  voices: SpeechSynthesisVoice[];
  modelValue: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [uri: string] }>();
</script>

<template>
  <select
    class="voice-select"
    :value="modelValue"
    @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-for="voice in voices" :key="voice.voiceURI" :value="voice.voiceURI">
      {{ voice.name }} ({{ voice.lang }})
    </option>
  </select>
</template>

<style scoped>
.voice-select {
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  background: var(--color-surface);
  color: var(--color-text);
}
</style>
