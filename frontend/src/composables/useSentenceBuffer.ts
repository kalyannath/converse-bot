import { extractSentences } from '../utils/sentenceSplitter';

export function useSentenceBuffer(onSentence: (sentence: string) => void) {
  let buffer = '';

  function feed(token: string): void {
    buffer += token;
    const { sentences, remainder } = extractSentences(buffer);
    sentences.forEach(onSentence);
    buffer = remainder;
  }

  function flush(): void {
    const trimmed = buffer.trim();
    if (trimmed) onSentence(trimmed);
    buffer = '';
  }

  function reset(): void {
    buffer = '';
  }

  return { feed, flush, reset };
}
