type PollControllerConfig = {
  baseInterval: number;
  fn: () => Promise<unknown> | unknown;
  maxInterval: number;
  onError?: (error: unknown) => void;
  onSuccess?: () => void;
};

export type PollController = {
  getCurrentInterval: () => number;
  reset: () => void;
  start: () => void;
  stop: () => void;
};

export function createPollController(config: PollControllerConfig): PollController {
  let consecutiveFailures = 0;
  let running = false;
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  let pending = false;

  const clearTimer = () => {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const getCurrentInterval = () =>
    Math.min(
      config.maxInterval,
      config.baseInterval * 2 ** Math.min(consecutiveFailures, 4)
    );

  const scheduleNext = (delay: number) => {
    clearTimer();
    timeoutId = globalThis.setTimeout(() => {
      void tick();
    }, delay);
  };

  const tick = async () => {
    if (!running || pending) {
      return;
    }

    pending = true;
    try {
      await config.fn();
      consecutiveFailures = 0;
      config.onSuccess?.();
    } catch (error) {
      consecutiveFailures += 1;
      config.onError?.(error);
    } finally {
      pending = false;
      if (running) {
        scheduleNext(getCurrentInterval());
      }
    }
  };

  return {
    getCurrentInterval,
    reset() {
      consecutiveFailures = 0;
      if (running) {
        scheduleNext(config.baseInterval);
      }
    },
    start() {
      if (running) {
        return;
      }
      running = true;
      consecutiveFailures = 0;
      void tick();
    },
    stop() {
      running = false;
      pending = false;
      clearTimer();
    },
  };
}
