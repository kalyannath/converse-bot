import { io, type Socket } from 'socket.io-client';
import { onUnmounted, ref } from 'vue';
import type {
  BotDonePayload,
  BotErrorPayload,
  BotTokenPayload,
  ConnectionState,
  UserMessagePayload,
} from '../types/socket-events';

const WAKING_DELAY_MS = 5000;

export function useSocket(url: string) {
  const connectionState = ref<ConnectionState>('connecting');
  const outboundQueue: UserMessagePayload[] = [];
  let wakingTimer: ReturnType<typeof setTimeout> | null = null;
  let hasConnectedOnce = false;

  const socket: Socket = io(url, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 10000,
    timeout: 60000,
  });

  function clearWakingTimer() {
    if (wakingTimer) {
      clearTimeout(wakingTimer);
      wakingTimer = null;
    }
  }

  function flushQueue() {
    while (outboundQueue.length > 0) {
      socket.emit('user_message', outboundQueue.shift());
    }
  }

  socket.on('connect', () => {
    hasConnectedOnce = true;
    clearWakingTimer();
    connectionState.value = 'connected';
    flushQueue();
  });

  socket.on('disconnect', () => {
    connectionState.value = hasConnectedOnce ? 'reconnecting' : 'connecting';
  });

  socket.on('connect_error', () => {
    if (!hasConnectedOnce && !wakingTimer) {
      wakingTimer = setTimeout(() => {
        connectionState.value = 'waking';
      }, WAKING_DELAY_MS);
    }
  });

  socket.io.on('reconnect_attempt', () => {
    connectionState.value = 'reconnecting';
  });

  socket.io.on('reconnect', () => {
    connectionState.value = 'connected';
    flushQueue();
  });

  socket.io.on('reconnect_failed', () => {
    connectionState.value = 'disconnected';
  });

  function sendUserMessage(payload: UserMessagePayload): void {
    if (socket.connected) {
      socket.emit('user_message', payload);
    } else {
      outboundQueue.push(payload);
    }
  }

  function sendCancel(): void {
    socket.emit('cancel');
  }

  function onBotToken(cb: (payload: BotTokenPayload) => void): void {
    socket.on('bot_token', cb);
  }

  function onBotDone(cb: (payload: BotDonePayload) => void): void {
    socket.on('bot_done', cb);
  }

  function onBotError(cb: (payload: BotErrorPayload) => void): void {
    socket.on('bot_error', cb);
  }

  onUnmounted(() => {
    clearWakingTimer();
    socket.disconnect();
  });

  return {
    connectionState,
    sendUserMessage,
    sendCancel,
    onBotToken,
    onBotDone,
    onBotError,
  };
}
