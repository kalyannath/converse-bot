export interface UserMessagePayload {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface BotTokenPayload {
  token: string;
}

export interface BotDonePayload {
  fullText: string;
}

export interface BotErrorPayload {
  message: string;
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'waking' | 'disconnected';
