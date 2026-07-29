/// <reference lib="webworker" />

import { runLocalCheck } from '../domain/localCheck';
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

  try {
    const result = runLocalCheck(data.input);
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
  }
};
