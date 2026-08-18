import { onUnmounted, ref } from 'vue';
import { RECOGNITION_LANG } from '../constants';
import { getSpeechRecognitionCtor, isSpeechRecognitionSupported } from '../utils/browserSupport';

const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed': 'Microphone access is blocked. Please enable it in your browser settings.',
  'no-speech': "Didn't catch that — try again.",
  'audio-capture': 'No microphone was found.',
  network: 'A network error interrupted speech recognition.',
};

export function useSpeechRecognition(onFinalResult: (text: string) => void) {
  const isSupported = isSpeechRecognitionSupported();
  const isListening = ref(false);
  const interimText = ref('');
  const error = ref<string | null>(null);

  let recognition: SpeechRecognition | null = null;

  function ensureRecognition(): SpeechRecognition | null {
    if (recognition) return recognition;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return null;

    recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = RECOGNITION_LANG;

    recognition.onstart = () => {
      isListening.value = true;
      interimText.value = '';
      error.value = null;
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          onFinalResult(result[0].transcript.trim());
        } else {
          interim += result[0].transcript;
        }
      }
      interimText.value = interim;
    };

    recognition.onerror = (event) => {
      error.value = ERROR_MESSAGES[event.error] ?? 'Speech recognition failed. Please try again.';
    };

    recognition.onend = () => {
      isListening.value = false;
      interimText.value = '';
    };

    return recognition;
  }

  function start(): void {
    const instance = ensureRecognition();
    if (!instance || isListening.value) return;
    error.value = null;
    instance.start();
  }

  function stop(): void {
    recognition?.stop();
  }

  onUnmounted(() => {
    recognition?.abort();
  });

  return { isSupported, isListening, interimText, error, start, stop };
}
