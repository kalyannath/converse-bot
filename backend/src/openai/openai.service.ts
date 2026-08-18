import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { AppConfig } from '../config/configuration';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT =
  'You are ConverseBot, a friendly, concise voice assistant. Keep replies short and conversational ' +
  '(a few sentences), since they are spoken aloud. Avoid markdown, lists, or code blocks.';

// Load-test mode (LOAD_TEST=true) streams this instead of calling OpenAI, so
// load tests measure this server's own capacity instead of OpenAI's latency,
// rate limits, and per-token cost.
const MOCK_REPLY_TOKENS = ['Hello', '! ', 'This ', 'is ', 'a ', 'mocked ', 'reply ', 'for ', 'load ', 'testing.'];
const MOCK_TOKEN_DELAY_MS = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class OpenAIService {
  private readonly client: OpenAI;
  private readonly loadTestMode: boolean;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    this.client = new OpenAI({
      apiKey: this.configService.get('openaiApiKey', { infer: true }),
    });
    this.loadTestMode = this.configService.get('loadTest', { infer: true });
  }

  async streamChatCompletion(
    messages: ChatTurn[],
    signal: AbortSignal,
    onToken: (token: string) => void,
  ): Promise<string> {
    if (this.loadTestMode) {
      return this.streamMockCompletion(signal, onToken);
    }

    const stream = await this.client.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        stream: true,
      },
      { signal },
    );

    let fullText = '';
    for await (const chunk of stream) {
      if (signal.aborted) {
        break;
      }
      const token = chunk.choices[0]?.delta?.content ?? '';
      if (token) {
        fullText += token;
        onToken(token);
      }
    }
    return fullText;
  }

  private async streamMockCompletion(signal: AbortSignal, onToken: (token: string) => void): Promise<string> {
    let fullText = '';
    for (const token of MOCK_REPLY_TOKENS) {
      if (signal.aborted) {
        break;
      }
      await sleep(MOCK_TOKEN_DELAY_MS);
      fullText += token;
      onToken(token);
    }
    return fullText;
  }
}
