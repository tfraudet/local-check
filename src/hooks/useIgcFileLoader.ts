import { useCallback, useRef, useState } from 'react';
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
 */
export function useIgcFileLoader() {
  const { t } = useTranslation();
  const loadFlight = useFlightStore((s) => s.loadFlight);
  const setLoadError = useFlightStore((s) => s.setLoadError);
  const loadError = useFlightStore((s) => s.loadError);
  const [isParsing, setIsParsing] = useState(false);
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

      setIsParsing(true);
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
            setIsParsing(false);
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
          setIsParsing(false);
          setLoadError({ kind: 'unknown', message: t('errors.unknown') });
        });
    },
    [loadFlight, setLoadError, t],
  );

  return { loadFile, isParsing, loadError };
}
