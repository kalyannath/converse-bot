import { UseFilters, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service';
import { UserMessageDto } from './dto/user-message.dto';
import { WsExceptionFilter } from './filters/ws-exception.filter';
import { WsRateLimitGuard } from './guards/ws-rate-limit.guard';
import { SocketStateService } from './services/socket-state.service';

/**
 * Origin allow-list is read from process.env inside this callback (not the outer
 * decorator options object) because @WebSocketGateway metadata is evaluated at
 * module-import time, before dotenv/ConfigModule has loaded .env values.
 */
function corsOriginCheck(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  callback(null, !origin || allowedOrigins.includes(origin));
}

@WebSocketGateway({
  cors: {
    origin: corsOriginCheck,
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly socketStateService: SocketStateService,
  ) {}

  handleConnection(client: Socket): void {
    this.socketStateService.init(client.id);
  }

  handleDisconnect(client: Socket): void {
    this.socketStateService.remove(client.id);
  }

  @UseGuards(WsRateLimitGuard)
  @UseFilters(WsExceptionFilter)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @SubscribeMessage('user_message')
  async handleUserMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() dto: UserMessageDto,
  ): Promise<void> {
    const result = await this.chatService.streamReply(
      client.id,
      dto.messages,
      (token) => client.emit('bot_token', { token }),
    );

    if (result.aborted) {
      return;
    }
    if (result.errorMessage) {
      client.emit('bot_error', { message: result.errorMessage });
      return;
    }
    client.emit('bot_done', { fullText: result.fullText ?? '' });
  }

  @SubscribeMessage('cancel')
  handleCancel(@ConnectedSocket() client: Socket): void {
    this.socketStateService.cancel(client.id);
  }
}
