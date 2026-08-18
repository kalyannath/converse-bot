import { Injectable } from '@nestjs/common';

export interface SocketState {
  inFlight: boolean;
  abortController: AbortController | null;
  messageTimestamps: number[];
}

const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_MESSAGES = 10;

@Injectable()
export class SocketStateService {
  private readonly states = new Map<string, SocketState>();

  init(socketId: string): void {
    this.states.set(socketId, {
      inFlight: false,
      abortController: null,
      messageTimestamps: [],
    });
  }

  remove(socketId: string): void {
    const state = this.states.get(socketId);
    state?.abortController?.abort();
    this.states.delete(socketId);
  }

  get(socketId: string): SocketState | undefined {
    return this.states.get(socketId);
  }

  isInFlight(socketId: string): boolean {
    return this.states.get(socketId)?.inFlight ?? false;
  }

  setInFlight(socketId: string, inFlight: boolean): void {
    const state = this.states.get(socketId);
    if (state) {
      state.inFlight = inFlight;
    }
  }

  startRequest(socketId: string): AbortController {
    const state = this.states.get(socketId);
    const controller = new AbortController();
    if (state) {
      state.inFlight = true;
      state.abortController = controller;
    }
    return controller;
  }

  endRequest(socketId: string): void {
    const state = this.states.get(socketId);
    if (state) {
      state.inFlight = false;
      state.abortController = null;
    }
  }

  cancel(socketId: string): void {
    const state = this.states.get(socketId);
    state?.abortController?.abort();
    if (state) {
      state.inFlight = false;
      state.abortController = null;
    }
  }

  /** Records a message send and reports whether the socket is within its 60s rate limit window. */
  recordAndCheckRateLimit(socketId: string): boolean {
    const state = this.states.get(socketId);
    if (!state) {
      return true;
    }
    const now = Date.now();
    state.messageTimestamps = state.messageTimestamps.filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
    );
    if (state.messageTimestamps.length >= RATE_LIMIT_MAX_MESSAGES) {
      return false;
    }
    state.messageTimestamps.push(now);
    return true;
  }
}
