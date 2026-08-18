import { Injectable, Logger } from '@nestjs/common';
import { OpenAIService, ChatTurn } from '../openai/openai.service';
import { SocketStateService } from './services/socket-state.service';

export interface StreamReplyResult {
  fullText?: string;
  errorMessage?: string;
  aborted: boolean;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly openAIService: OpenAIService,
    private readonly socketStateService: SocketStateService,
  ) {}

  async streamReply(
    socketId: string,
    messages: ChatTurn[],
    onToken: (token: string) => void,
  ): Promise<StreamReplyResult> {
    const controller = this.socketStateService.startRequest(socketId);
    try {
      const fullText = await this.openAIService.streamChatCompletion(
        messages,
        controller.signal,
        onToken,
      );
      return { fullText, aborted: controller.signal.aborted };
    } catch (error) {
      if (controller.signal.aborted) {
        return { aborted: true };
      }
      this.logger.error(error instanceof Error ? error.stack : error);
      return {
        aborted: false,
        errorMessage: 'Something went wrong talking to the assistant. Please try again.',
      };
    } finally {
      this.socketStateService.endRequest(socketId);
    }
  }
}
