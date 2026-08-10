/// <reference lib="webworker" />

import {
  computeReachableZone,
  type ReachableZoneInputs,
  type ReachableZoneResult,
} from '../domain/reachableZone';

export type ReachableZoneWorkerRequest = {
  type: 'run';
  requestId: number;
  input: ReachableZoneInputs;
};

export type ReachableZoneWorkerResponse =
  | { type: 'success'; requestId: number; result: ReachableZoneResult }
  | { type: 'error'; requestId: number; message: string };

self.onmessage = (event: MessageEvent<ReachableZoneWorkerRequest>) => {
  const { data } = event;
  if (data.type !== 'run') return;

  try {
    const result = computeReachableZone(data.input);
    const response: ReachableZoneWorkerResponse = {
      type: 'success',
      requestId: data.requestId,
      result,
    };
    (self as unknown as Worker).postMessage(response);
  } catch (err) {
    const response: ReachableZoneWorkerResponse = {
      type: 'error',
      requestId: data.requestId,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};
