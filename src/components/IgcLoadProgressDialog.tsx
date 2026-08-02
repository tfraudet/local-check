import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { useFlightStore } from '../state/useFlightStore';
import { Spinner } from './ui/spinner';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

type Stage = 'parsing' | 'elevation' | 'landingZones' | 'computing' | 'ready';

/** How long the "ready" state stays visible before the dialog auto-closes. */
const READY_AUTO_CLOSE_MS = 900;

/**
 * Modal shown from the moment an IGC file starts parsing until the local
 * check result for that flight is ready, walking the user through each
 * background step (parsing → terrain data → landing zones → local check).
 * Briefly shows a "ready" confirmation and then closes itself automatically;
 * surfaces a dismissible error state instead if parsing or terrain loading
 * fails.
 */
export function IgcLoadProgressDialog() {
  const { t } = useTranslation();
  const isParsingIgc = useFlightStore((s) => s.isParsingIgc);
  const loadError = useFlightStore((s) => s.loadError);
  const flight = useFlightStore((s) => s.flight);
  const elevationGrid = useFlightStore((s) => s.elevationGrid);
  const elevationLoadError = useFlightStore((s) => s.elevationLoadError);
  const landingZones = useFlightStore((s) => s.landingZones);
  const isComputingLocalCheck = useFlightStore((s) => s.isComputingLocalCheck);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);

  const [dismissed, setDismissed] = useState(false);
  const [readyAcknowledged, setReadyAcknowledged] = useState(false);

  const hasError =
    flight === null ? loadError !== null : elevationLoadError !== null;
  const isReady = flight !== null && localCheckResult !== null && !hasError;

  // A flight object identity changes on every successful load, so use it to
  // re-arm the dialog (clearing any earlier dismissal/ready state) for the
  // new file.
  const previousFlightRef = useRef(flight);
  useEffect(() => {
    if (isParsingIgc || flight !== previousFlightRef.current) {
      setDismissed(false);
      setReadyAcknowledged(false);
    }
    previousFlightRef.current = flight;
  }, [isParsingIgc, flight]);

  useEffect(() => {
    if (!isReady) return;
    const timer = setTimeout(
      () => setReadyAcknowledged(true),
      READY_AUTO_CLOSE_MS,
    );
    return () => clearTimeout(timer);
  }, [isReady]);

  const isActive =
    isParsingIgc || (flight !== null && !hasError && !readyAcknowledged);
  const open = !dismissed && (isActive || hasError);

  let stage: Stage = 'parsing';
  if (!isParsingIgc && flight) {
    if (!elevationGrid && !elevationLoadError) stage = 'elevation';
    else if (landingZones.length === 0) stage = 'landingZones';
    else if (isComputingLocalCheck || !localCheckResult) stage = 'computing';
    else stage = 'ready';
  }

  const stageLabel = t(`upload.progress.${hasError ? 'errorTitle' : stage}`);
  const errorMessage =
    flight === null ? loadError?.message : elevationLoadError;

  return (
    <Dialog
      open={open}
      onOpenChange={(next, eventDetails) => {
        // Local check is a short, unattended background sequence — block
        // dismissal via backdrop press/Escape while it's still running so
        // the user always sees the outcome (ready or error).
        if (!next && !hasError) {
          eventDetails.cancel();
          return;
        }
        if (!next) setDismissed(true);
      }}
    >
      <DialogContent showCloseButton={hasError}>
        <DialogHeader>
          <DialogTitle>{t('upload.progress.title')}</DialogTitle>
          <DialogDescription>
            {t('upload.progress.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 py-2">
          {hasError ? (
            <CircleAlert className="size-5 shrink-0 text-destructive" />
          ) : stage === 'ready' ? (
            <CheckCircle2 className="size-5 shrink-0 text-primary" />
          ) : (
            <Spinner className="size-5 shrink-0" />
          )}
          <p className="text-sm">{hasError ? errorMessage : stageLabel}</p>
        </div>
        {hasError && (
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissed(true)}>
              {t('upload.progress.close')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
