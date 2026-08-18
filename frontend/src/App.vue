<script setup lang="ts">
import { computed, ref } from 'vue';
import ChatTranscript from './components/ChatTranscript.vue';
import ConnectionStatus from './components/ConnectionStatus.vue';
import InterimTranscript from './components/InterimTranscript.vue';
import MicButton from './components/MicButton.vue';
import SettingsPanel from './components/SettingsPanel.vue';
import StopSpeakingButton from './components/StopSpeakingButton.vue';
import TextFallbackInput from './components/TextFallbackInput.vue';
import { useConversation } from './composables/useConversation';
import { useSentenceBuffer } from './composables/useSentenceBuffer';
import { useSocket } from './composables/useSocket';
import { useSpeechRecognition } from './composables/useSpeechRecognition';
import { useSpeechSynthesis } from './composables/useSpeechSynthesis';
import { API_URL } from './constants';

const {
  connectionState,
  sendUserMessage,
  sendCancel,
  onBotToken,
  onBotDone,
  onBotError,
} = useSocket(API_URL);

const {
  messages,
  historyForRequest,
  addUserMessage,
  startBotMessage,
  appendBotToken,
  finalizeBotMessage,
  addErrorMessage,
  clearConversation,
} = useConversation();

const {
  isSpeaking,
  voices,
  selectedVoiceUri,
  rate,
  speak,
  cancel: stopSpeaking,
} = useSpeechSynthesis();

const sentenceBuffer = useSentenceBuffer((sentence) => speak(sentence));

const isThinking = ref(false);
const currentBotMessageId = ref<string | null>(null);
const settingsOpen = ref(false);

function handleFinalResult(text: string): void {
  if (!text) return;
  addUserMessage(text);
  isThinking.value = true;
  sendUserMessage({ messages: historyForRequest.value });
}

const { isSupported, isListening, interimText, error: sttError, start, stop } =
  useSpeechRecognition(handleFinalResult);

onBotToken(({ token }) => {
  if (!currentBotMessageId.value) {
    isThinking.value = false;
    currentBotMessageId.value = startBotMessage().id;
  }
  appendBotToken(currentBotMessageId.value, token);
  sentenceBuffer.feed(token);
});

onBotDone(({ fullText }) => {
  if (currentBotMessageId.value) {
    finalizeBotMessage(currentBotMessageId.value, fullText);
  }
  sentenceBuffer.flush();
  currentBotMessageId.value = null;
  isThinking.value = false;
});

onBotError(({ message }) => {
  addErrorMessage(message);
  sentenceBuffer.reset();
  currentBotMessageId.value = null;
  isThinking.value = false;
});

const micState = computed(() => {
  if (isListening.value) return 'listening';
  if (isThinking.value) return 'thinking';
  if (isSpeaking.value) return 'speaking';
  return 'idle';
});

function handleMicClick(): void {
  if (isListening.value) {
    stop();
    return;
  }
  if (isThinking.value || isSpeaking.value) {
    sendCancel();
    stopSpeaking();
    sentenceBuffer.reset();
    isThinking.value = false;
    currentBotMessageId.value = null;
  }
  start();
}

function handleClearConversation(): void {
  clearConversation();
  settingsOpen.value = false;
}
</script>

<template>
  <div class="app-shell">
    <ConnectionStatus :state="connectionState" />
    <p v-if="sttError" class="error-banner">{{ sttError }}</p>

    <ChatTranscript :messages="messages" />
    <InterimTranscript :text="interimText" :visible="isListening" />

    <div class="controls">
      <MicButton v-if="isSupported" :state="micState" @click="handleMicClick" />
      <TextFallbackInput v-else @submit="handleFinalResult" />
      <StopSpeakingButton :visible="isSpeaking || isThinking" @click="handleMicClick" />
    </div>

    <button class="settings-toggle" @click="settingsOpen = true">⚙ Settings</button>

    <SettingsPanel
      :open="settingsOpen"
      :voices="voices"
      :selected-voice-uri="selectedVoiceUri"
      :rate="rate"
      @close="settingsOpen = false"
      @update:selected-voice-uri="(v) => (selectedVoiceUri = v)"
      @update:rate="(r) => (rate = r)"
      @clear="handleClearConversation"
    />
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-3);
}

.error-banner {
  text-align: center;
  color: var(--color-error);
  background: var(--color-error-bg);
  border-radius: var(--radius-sm);
  padding: var(--space-2);
  margin: 0;
  font-size: 0.9rem;
}

.settings-toggle {
  align-self: center;
  border: none;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 0.85rem;
  padding: var(--space-2);
}
</style>
