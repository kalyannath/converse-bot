import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { SocketStateService } from '../services/socket-state.service';

@Injectable()
export class WsRateLimitGuard implements CanActivate {
  constructor(private readonly socketStateService: SocketStateService) {}

  canActivate(context: ExecutionContext): boolean {
    const client = context.switchToWs().getClient<Socket>();

    if (this.socketStateService.isInFlight(client.id)) {
      throw new WsException('Please wait for the current response to finish.');
    }

    if (!this.socketStateService.recordAndCheckRateLimit(client.id)) {
      throw new WsException("You're sending messages too quickly. Please slow down.");
    }

    return true;
  }
}
