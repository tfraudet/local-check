/// <reference lib="webworker" />

import { runLocalCheckFull } from '../domain/localCheck';
import type { LocalCheckInput, LocalCheckResult } from '../domain/localCheck';

export type LocalCheckWorkerRequest = {
  type: 'run';
  requestId: number;
  input: LocalCheckInput;
};

export type LocalCheckWorkerResponse =
  | { type: 'success'; requestId: number; result: LocalCheckResult }
  | { type: 'error'; requestId: number; message: string };

self.onmessage = (event: MessageEvent<LocalCheckWorkerRequest>) => {
  const { data } = event;
  if (data.type !== 'run') return;
  
  const startedAt = import.meta.env.DEV ? performance.now() : 0;
  try {

    const result = runLocalCheckFull(data.input);
    const response: LocalCheckWorkerResponse = {
      type: 'success',
      requestId: data.requestId,
      result,
    };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: LocalCheckWorkerResponse = {
      type: 'error',
      requestId: data.requestId,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  } finally {
    if (import.meta.env.DEV) {
      console.log(
        `[runLocalCheckFull] ${(performance.now() - startedAt).toFixed(2)} ms`,
      );
    }
  }
};
