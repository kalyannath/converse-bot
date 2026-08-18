import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch()
export class WsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();

    if (exception instanceof WsException) {
      client.emit('bot_error', { message: exception.message });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    client.emit('bot_error', { message: 'Invalid message format.' });
  }
}
