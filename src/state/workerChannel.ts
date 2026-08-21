/**
 * Minimal request/response plumbing for the domain workers.
 *
 * Both the local-check and reachable-zone workers speak the same protocol
 * (`{ type: 'run', requestId, input }` → `{ type, requestId, result }`), so
 * the correlation, stale-response guard, and listener cleanup live here
 * instead of being re-implemented per store action.
 */

export interface WorkerChannel<TInput, TResult> {
  /**
   * Post `input` to the worker and resolve with its result.
   *
   * Resolves with `null` when a newer request was issued before this one
   * answered — callers must then leave the store untouched, otherwise a
   * slow stale response would overwrite fresher data.
   */
  run(input: TInput): Promise<TResult | null>;
  /** True while the newest in-flight request has not answered yet. */
  isLatestPending(): boolean;
}

export function createWorkerChannel<TInput, TResult>(
  spawn: () => Worker,
): WorkerChannel<TInput, TResult> {
  let worker: Worker | null = null;
  let latestRequestId = 0;
  let settledRequestId = 0;
  let inFlight = false;

  // At most one call waiting for the current in-flight request to finish
  // before it can be posted. A newer call replaces it outright — the
  // superseded one resolves with `null`, same as a stale response — so the
  // worker never queues up more than one stale computation behind the one
  // it's already running.
  let queued: {
    requestId: number;
    input: TInput;
    resolve: (result: TResult | null) => void;
  } | null = null;

  const getWorker = (): Worker => (worker ??= spawn());

  const post = (
    requestId: number,
    input: TInput,
    resolve: (result: TResult | null) => void,
  ) => {
    const w = getWorker();
    inFlight = true;

    const handler = (event: MessageEvent) => {
      const data = event.data as {
        requestId: number;
        type: string;
        result?: TResult;
      };
      if (data.requestId !== requestId) return; // another request's answer

      w.removeEventListener('message', handler);
      inFlight = false;
      settledRequestId = Math.max(settledRequestId, requestId);

      // Stale: a newer request has been issued since.
      if (requestId !== latestRequestId) {
        resolve(null);
      } else {
        resolve(data.type === 'success' ? (data.result ?? null) : null);
      }

      // A newer call queued up while this one was running — send it now
      // rather than waiting for the next caller to notice the worker is free.
      if (queued) {
        const next = queued;
        queued = null;
        post(next.requestId, next.input, next.resolve);
      }
    };

    w.addEventListener('message', handler);
    w.postMessage({ type: 'run', requestId, input });
  };

  return {
    run(input: TInput): Promise<TResult | null> {
      const requestId = ++latestRequestId;

      return new Promise<TResult | null>((resolve) => {
        if (inFlight) {
          // Don't pile requests up on the worker: keep only the freshest
          // pending call and resolve whichever one it displaces as stale.
          queued?.resolve(null);
          queued = { requestId, input, resolve };
          return;
        }
        post(requestId, input, resolve);
      });
    },

    isLatestPending() {
      return settledRequestId < latestRequestId;
    },
  };
}
