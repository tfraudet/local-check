/// <reference lib="webworker" />

import { parseAndNormalizeIgc } from '../domain/normalizeIgc';
import type { IgcParseError, NormalizedFlight } from '../domain/flight';

export type IgcWorkerRequest = {
  type: 'parse';
  fileText: string;
};

export type IgcWorkerResponse =
  | { type: 'success'; flight: NormalizedFlight }
  | { type: 'error'; error: IgcParseError };

self.onmessage = (event: MessageEvent<IgcWorkerRequest>) => {
  const { data } = event;
  if (data.type !== 'parse') return;

  const result = parseAndNormalizeIgc(data.fileText);
  const response: IgcWorkerResponse =
    'flight' in result
      ? { type: 'success', flight: result.flight }
      : { type: 'error', error: result.error };

  (self as unknown as Worker).postMessage(response);
};
