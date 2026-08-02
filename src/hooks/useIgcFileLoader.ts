import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useFlightStore } from '../state/useFlightStore';
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

          const handleMessage = (event: MessageEvent<IgcWorkerResponse>) => {
            setIsParsingIgc(false);
            if (event.data.type === 'success') {
              loadFlight(event.data.flight);
            } else {
              setLoadError(event.data.error);
            }
            worker.removeEventListener('message', handleMessage);
          };

          worker.addEventListener('message', handleMessage);
          const request: IgcWorkerRequest = { type: 'parse', fileText };
          worker.postMessage(request);
        })
        .catch(() => {
          setIsParsingIgc(false);
          setLoadError({ kind: 'unknown', message: t('errors.unknown') });
        });
    },
    [loadFlight, setLoadError, setIsParsingIgc, t],
  );

  return { loadFile, isParsing, loadError };
}
