import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { AlertCircle, CheckCircle, Circle } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useRef, useState } from "react";
import { useFlightStore } from "@/state/useFlightStore";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "./ui/item";

type Stage = 'parsing' | 'elevation' | 'computing' | 'ready';

type TaskStatus = 'not-started' | 'in-progress' | 'success' | 'error';

const READY_AUTO_CLOSE_MS = 3000;

interface TaskRowProps {
  label: string;
  status: TaskStatus;
  error: string
}

const taskStatusIcons: Record<TaskStatus, React.ReactNode> = {
  'not-started': <Circle className="size-5 " />,
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

  const isComputingLocalCheck = useFlightStore((s) => s.isComputingLocalCheck);
  const localCheckResult = useFlightStore((s) => s.localCheckResult);
 
  const [dismissed, setDismissed] = useState(false);
  
  const hasError = flight === null ? loadError !== null : elevationLoadError !== null;
  // const isReady = flight !== null && localCheckResult !== null && !hasError;
  const isReady = flight !== null && elevationGrid !== null && !hasError;

  // A flight object identity changes on every successful load, so use it to
  // re-arm the dialog (clearing any earlier dismissal/ready state) for the
  // new file.
  const previousFlightRef = useRef(flight);
  useEffect(() => {
    if (isParsingIgc || flight !== previousFlightRef.current) {
      setDismissed(false);
      // setReadyAcknowledged(false);
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

  const statusComputing: TaskStatus = localCheckResult
    ? 'success' 
    : isComputingLocalCheck 
      ?  'in-progress' 
      :  'not-started' ;    

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

{}