export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  isStreaming?: boolean;
  isError?: boolean;
}
