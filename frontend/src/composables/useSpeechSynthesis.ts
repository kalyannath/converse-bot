import { onMounted, onUnmounted, ref } from 'vue';
import { DEFAULT_SPEECH_RATE } from '../constants';

export function useSpeechSynthesis() {
  const isSpeaking = ref(false);
  const voices = ref<SpeechSynthesisVoice[]>([]);
  const selectedVoiceUri = ref<string>('');
  const rate = ref(DEFAULT_SPEECH_RATE);

  let queue: SpeechSynthesisUtterance[] = [];
  let speakingCount = 0;

  function loadVoices() {
    const available = window.speechSynthesis.getVoices();
    if (available.length === 0) return;
    voices.value = available;
    if (!selectedVoiceUri.value) {
      const defaultVoice = available.find((v) => v.lang.startsWith('en')) ?? available[0];
      selectedVoiceUri.value = defaultVoice.voiceURI;
    }
  }

  onMounted(() => {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  });

  onUnmounted(() => {
    window.speechSynthesis.onvoiceschanged = null;
    cancel();
  });

  function speak(text: string): void {
    if (!text.trim()) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = voices.value.find((v) => v.voiceURI === selectedVoiceUri.value);
    if (voice) utterance.voice = voice;
    utterance.rate = rate.value;

    utterance.onstart = () => {
      speakingCount += 1;
      isSpeaking.value = true;
    };
    utterance.onend = utterance.onerror = () => {
      speakingCount = Math.max(0, speakingCount - 1);
      isSpeaking.value = speakingCount > 0;
    };

    queue.push(utterance);
    window.speechSynthesis.speak(utterance);
  }

  function cancel(): void {
    window.speechSynthesis.cancel();
    queue = [];
    speakingCount = 0;
    isSpeaking.value = false;
  }

  return { isSpeaking, voices, selectedVoiceUri, rate, speak, cancel };
}
