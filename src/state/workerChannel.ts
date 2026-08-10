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

  const getWorker = (): Worker => (worker ??= spawn());

  return {
    run(input: TInput): Promise<TResult | null> {
      const requestId = ++latestRequestId;
      const w = getWorker();

      return new Promise<TResult | null>((resolve) => {
        const handler = (event: MessageEvent) => {
          const data = event.data as {
            requestId: number;
            type: string;
            result?: TResult;
          };
          if (data.requestId !== requestId) return; // another request's answer

          w.removeEventListener('message', handler);
          settledRequestId = Math.max(settledRequestId, requestId);

          // Stale: a newer request has been issued since.
          if (requestId !== latestRequestId) {
            resolve(null);
            return;
          }
          resolve(data.type === 'success' ? (data.result ?? null) : null);
        };

        w.addEventListener('message', handler);
        w.postMessage({ type: 'run', requestId, input });
      });
    },

    isLatestPending() {
      return settledRequestId < latestRequestId;
    },
  };
}
