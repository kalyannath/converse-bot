const SENTENCE_BOUNDARY = /[^.!?]+[.!?]+(?:\s+|$)/g;

/**
 * Splits completed sentences off the front of `buffer`. Returns the completed
 * sentences (trimmed) and whatever incomplete text remains at the end.
 */
export function extractSentences(buffer: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let matchedLength = 0;

  SENTENCE_BOUNDARY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_BOUNDARY.exec(buffer)) !== null) {
    const sentence = match[0].trim();
    if (sentence) sentences.push(sentence);
    matchedLength = match.index + match[0].length;
  }

  return { sentences, remainder: buffer.slice(matchedLength) };
}
