import { computed, ref } from 'vue';
import { MAX_HISTORY } from '../constants';
import type { ChatMessage } from '../types/chat';

export function useConversation() {
  const messages = ref<ChatMessage[]>([]);

  const historyForRequest = computed(() =>
    messages.value
      .filter((m) => !m.isError)
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content })),
  );

  function addUserMessage(text: string): ChatMessage {
    const message: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    messages.value.push(message);
    return message;
  }

  function startBotMessage(): ChatMessage {
    const message: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      isStreaming: true,
    };
    messages.value.push(message);
    return message;
  }

  function appendBotToken(id: string, token: string): void {
    const message = messages.value.find((m) => m.id === id);
    if (message) message.content += token;
  }

  function finalizeBotMessage(id: string, fullText: string): void {
    const message = messages.value.find((m) => m.id === id);
    if (message) {
      message.content = fullText;
      message.isStreaming = false;
    }
  }

  function addErrorMessage(text: string): void {
    messages.value.push({ id: crypto.randomUUID(), role: 'assistant', content: text, isError: true });
  }

  function clearConversation(): void {
    messages.value = [];
  }

  return {
    messages,
    historyForRequest,
    addUserMessage,
    startBotMessage,
    appendBotToken,
    finalizeBotMessage,
    addErrorMessage,
    clearConversation,
  };
}
