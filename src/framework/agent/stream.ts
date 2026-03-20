export type StreamAbortReason = 'user' | 'timeout' | null;

type StreamControllerOptions = {
  idleTimeoutMs?: number;
  onSlowResponse?: () => void;
  onTimeout?: () => void;
  slowResponseMs?: number;
  totalTimeoutMs?: number;
};

export class StreamController {
  private abortController: AbortController | null = null;
  private abortReason: StreamAbortReason = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private slowResponseTimer: ReturnType<typeof setTimeout> | null = null;
  private totalTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: StreamControllerOptions = {}) {}

  start() {
    this.finish();
    this.abortController = new AbortController();
    this.abortReason = null;

    const slowResponseMs = this.options.slowResponseMs || 0;
    if (slowResponseMs > 0 && this.options.onSlowResponse) {
      this.slowResponseTimer = setTimeout(() => {
        this.options.onSlowResponse?.();
      }, slowResponseMs);
    }

    const totalTimeoutMs = this.options.totalTimeoutMs || 0;
    if (totalTimeoutMs > 0) {
      this.totalTimer = setTimeout(() => {
        this.abortDueToTimeout();
      }, totalTimeoutMs);
    }

    this.markActivity();
  }

  get reason() {
    return this.abortReason;
  }

  get signal() {
    if (!this.abortController) {
      throw new Error('StreamController has not been started.');
    }

    return this.abortController.signal;
  }

  abort(reason: Exclude<StreamAbortReason, null> = 'user') {
    this.abortReason = reason;
    this.abortController?.abort();
  }

  dismissSlowResponse() {
    if (this.slowResponseTimer) {
      clearTimeout(this.slowResponseTimer);
      this.slowResponseTimer = null;
    }
  }

  finish() {
    this.dismissSlowResponse();

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    if (this.totalTimer) {
      clearTimeout(this.totalTimer);
      this.totalTimer = null;
    }

    this.abortController = null;
    this.abortReason = null;
  }

  markActivity() {
    const idleTimeoutMs = this.options.idleTimeoutMs || 0;
    if (idleTimeoutMs <= 0) {
      return;
    }

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      this.abortDueToTimeout();
    }, idleTimeoutMs);
  }

  private abortDueToTimeout() {
    this.abortReason = 'timeout';
    this.options.onTimeout?.();
    this.abortController?.abort();
  }
}

type ReadTextResponseStreamParams = {
  onActivity?: () => void;
  onFirstChunk?: () => void;
  onText?: (text: string) => void;
  response: Response;
  transformChunk?: (chunk: string) => string;
};

export async function readTextResponseStream({
  onActivity,
  onFirstChunk,
  onText,
  response,
  transformChunk,
}: ReadTextResponseStreamParams) {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('No response body');
  }

  const decoder = new TextDecoder();
  let fullText = '';
  let receivedFirstChunk = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    onActivity?.();

    const decodedChunk = decoder.decode(value, { stream: true });
    const chunk = transformChunk ? transformChunk(decodedChunk) : decodedChunk;
    if (!chunk) {
      continue;
    }

    if (!receivedFirstChunk) {
      receivedFirstChunk = true;
      onFirstChunk?.();
    }

    fullText += chunk;
    onText?.(fullText);
  }

  return fullText;
}
