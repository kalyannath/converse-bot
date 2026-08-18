import { Module } from '@nestjs/common';
import { OpenAIModule } from '../openai/openai.module';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { SocketStateService } from './services/socket-state.service';

@Module({
  imports: [OpenAIModule],
  providers: [ChatGateway, ChatService, SocketStateService],
})
export class ChatModule {}
