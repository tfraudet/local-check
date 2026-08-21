import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { AlertCircle, CheckCircle, Circle } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useRef, useState } from "react";
import { useFlightStore } from "@/state/useFlightStore";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "./ui/item";

type Stage = 'parsing' | 'elevation' | 'airports' | 'computing' | 'ready';

type TaskStatus = 'not-started' | 'in-progress' | 'success' | 'error';

const READY_AUTO_CLOSE_MS = 3000;

interface TaskRowProps {
  label: string;
  status: TaskStatus;
  error: string
}

const taskStatusIcons: Record<TaskStatus, React.ReactNode> = {
  'not-started': <Circle className="size-5 text-muted-foreground" />,
  'in-progress': <Spinner className="size-5 "/>,
  'success': <CheckCircle className="size-5 text-primary" />,
  'error': <AlertCircle className="size-5 text-destructive"/>,
};

function TaskRow({ label, status, error }: TaskRowProps) {
  return (
    <Item size="xs" variant="default">
      <ItemMedia variant="icon">
        {taskStatusIcons[status]}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{label}</ItemTitle>
        {status === 'error' && (
          <ItemDescription className="text-destructive">{error}</ItemDescription>
        )}
      </ItemContent>
    </Item>
  );
}

export function LoaderProgressDialog() {
  const { t } = useTranslation();
  const isParsingIgc = useFlightStore((s) => s.isParsingIgc);
  const flight = useFlightStore((s) => s.flight);
  const loadError = useFlightStore((s) => s.loadError);

  const elevationGrid = useFlightStore((s) => s.elevationGrid);
  const elevationLoadError = useFlightStore((s) => s.elevationLoadError);

  const isLoadingAirports = useFlightStore((s) => s.isLoadingAirports);
  const hasLoadedAirports = useFlightStore((s) => s.hasLoadedAirports);
  const airportsLoadError = useFlightStore((s) => s.airportsLoadError);

  const isComputingLocalCheck = useFlightStore((s) => s.isComputingLocalCheck);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);
  const landingZones = useFlightStore((s) => s.landingZones);

  const [dismissed, setDismissed] = useState(false);

  // A completed run — not a non-null result — is the reliable "local check is
  // over" signal: the worker channel answers with no result when the
  // computation fails, so waiting on `localCheckResult` alone would keep the
  // dialog open forever after an error.
  const [localCheckRan, setLocalCheckRan] = useState(false);
  const wasComputingRef = useRef(false);
  useEffect(() => {
    if (isComputingLocalCheck) wasComputingRef.current = true;
    else if (wasComputingRef.current) setLocalCheckRan(true);
  }, [isComputingLocalCheck]);

  const hasError =
    flight === null
      ? loadError !== null
      : elevationLoadError !== null || airportsLoadError !== null;

  // `runLocalCheck` returns immediately while the landing-zone catalog is
  // empty, so there is nothing to wait for in that case. Zones arriving later
  // flip this back to "pending" and the auto-close timer below re-arms.
  const isLocalCheckDone =
    !isComputingLocalCheck && (landingZones.length === 0 || localCheckRan);

  const isReady =
    flight !== null &&
    elevationGrid !== null &&
    hasLoadedAirports &&
    isLocalCheckDone &&
    !hasError;

  // Re-arm the dialog when a new file is being parsed, or when the flight
  // transitions from absent to present (upload complete). Settings-driven
  // flight-object refreshes (e.g. QNH recalibration toggling) do NOT
  // re-arm — those are in-session updates, not new loads.
  const previousFlightRef = useRef(flight);
  useEffect(() => {
    const isNewLoad =
      isParsingIgc || (flight !== null && previousFlightRef.current === null);
    if (isNewLoad) {
      setDismissed(false);
      setLocalCheckRan(false);
      wasComputingRef.current = false;
    }
    previousFlightRef.current = flight;
  }, [isParsingIgc, flight]);

  useEffect(() => {
    if (!isReady) return;
    const timer = setTimeout(
      // () => setReadyAcknowledged(true),
      () => setDismissed(true),
      READY_AUTO_CLOSE_MS,
    );
    return () => clearTimeout(timer);
  }, [isReady]);

  let stage: Stage = 'parsing';
  if (!isParsingIgc && flight) {
    if (!elevationGrid && !elevationLoadError) stage = 'elevation';
    else if (isLoadingAirports) stage = 'airports';
    else if (isComputingLocalCheck) stage = 'computing';
    else stage = 'ready';
  }

  const stageLabel = t(`progress.${hasError ? 'errorTitle' : stage}`);

  const isActive = isParsingIgc  || (flight !== null && !hasError );
  const open = !dismissed && (isActive || hasError);

  const statusFlightLoading: TaskStatus = loadError 
    ? 'error' 
    : !flight 
      ? (isParsingIgc ? 'in-progress' : 'not-started')
      : (isParsingIgc ? 'in-progress' : 'success');

  const statusElevation: TaskStatus = elevationLoadError
    ? 'error'
    : !elevationGrid
      ? (flight ? 'in-progress' : 'not-started')
      :  'success' ;

  const statusAirports: TaskStatus = airportsLoadError
    ? 'error'
    : hasLoadedAirports
      ? 'success'
      : isLoadingAirports
        ? 'in-progress'
        : 'not-started';

  const statusComputing: TaskStatus = isComputingLocalCheck
    ? 'in-progress'
    : localCheckResult
      ? 'success'
      : 'not-started';

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
          <DialogTitle>{t('progress.title')}</DialogTitle>
          <DialogDescription>
            {t('progress.description')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">

          <ItemGroup>
            <TaskRow label={t('progress.parsing')} status={statusFlightLoading} error={loadError?.message || ''} />
            <TaskRow label={t('progress.elevation')} status={statusElevation} error={elevationLoadError || ''} />
            <TaskRow label={t('progress.airports')} status={statusAirports} error={airportsLoadError || ''} />
            <TaskRow label={t('progress.computing')} status={statusComputing} error={''} />
          </ItemGroup>
          
        </div>
          {hasError && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setDismissed(true)}>
                {t('progress.close')}
              </Button>
            </DialogFooter>
          )}
          {isReady && (
            <DialogFooter className="items-center sm:justify-center ">
              <CheckCircle className="size-5 shrink-0 text-primary" />
              <p className="text-sm text-primary">{stageLabel}</p>
            </DialogFooter>
          )}
      </DialogContent>
    </Dialog>
  );
}