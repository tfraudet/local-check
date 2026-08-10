import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFlightStore } from '@/state/useFlightStore';

import type {
  IgcWorkerRequest,
  IgcWorkerResponse,
} from '../workers/igcParser.worker';

/**
 * Shared IGC file-loading logic: validates the extension, parses off the
 * main thread via a dedicated Web Worker, and writes the result (or error)
 * into the flight store. Used by both the sidebar upload menu and the
 * empty-state upload zone (FR-M-1, FR-M-2, FR-M-6).
 *
 * The "is parsing" flag lives in the flight store (`isParsingIgc`) rather
 * than local component state so `IgcLoadProgressDialog` can observe it from
 * anywhere in the tree, regardless of which component actually calls
 * `loadFile`.
 */
export function useIgcFileLoader() {
  const { t } = useTranslation();
  const loadFlight = useFlightStore((s) => s.loadFlight);
  const clearFlight = useFlightStore((s) => s.clearFlight);
  const setLoadError = useFlightStore((s) => s.setLoadError);
  const loadError = useFlightStore((s) => s.loadError);
  const isParsing = useFlightStore((s) => s.isParsingIgc);
  const setIsParsingIgc = useFlightStore((s) => s.setIsParsingIgc);
  const workerRef = useRef<Worker | null>(null);

  const loadFile = useCallback(
    (file: File) => {
      if (!file.name.toLowerCase().endsWith('.igc')) {
        setLoadError({
          kind: 'invalid-format',
          message: t('errors.invalidFormat'),
        });
        return;
      }

      setLoadError(null);
      clearFlight();
      setIsParsingIgc(true);
      file
        .text()
        .then((fileText) => {
          if (!workerRef.current) {
            workerRef.current = new Worker(
              new URL('../workers/igcParser.worker.ts', import.meta.url),
              { type: 'module' },
            );
          }
          const worker = workerRef.current;

          const cleanup = () => {
            worker.removeEventListener('message', handleMessage);
            worker.removeEventListener('error', handleError);
          };

          const handleMessage = (event: MessageEvent<IgcWorkerResponse>) => {
            cleanup();
            setIsParsingIgc(false);
            if (event.data.type === 'success') {
              // `fileName` comes from the browser File object, not the IGC
              // content, so it's attached here rather than inside the
              // (framework-agnostic) parser/worker.
              loadFlight({ ...event.data.flight, fileName: file.name });
            } else {
              setLoadError(event.data.error);
            }
          };

          const handleError = () => {
            cleanup();
            setIsParsingIgc(false);
            setLoadError({ kind: 'unknown', message: t('errors.unknown') });
          };

          worker.addEventListener('message', handleMessage);
          worker.addEventListener('error', handleError);
          const request: IgcWorkerRequest = { type: 'parse', fileText };
          worker.postMessage(request);
        })
        .catch(() => {
          setIsParsingIgc(false);
          setLoadError({ kind: 'unknown', message: t('errors.unknown') });
        });
    },
    [clearFlight, loadFlight, setLoadError, setIsParsingIgc, t],
  );

  return { loadFile, isParsing, loadError };
}
