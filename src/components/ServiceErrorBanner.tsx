import { AlertCircle, X } from 'lucide-react';
import { useFlightStore } from '../state/useFlightStore';
import { Alert, AlertAction, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';

/**
 * Fixed-position stack of dismissible error alerts, sitting under the app
 * header. Pushed by any service hook (elevation, OpenAIP, outlanding DB)
 * via `useFlightStore.getState().pushServiceError(...)`. Consumers are
 * expected to shape their error into a friendly title/message/hint
 * *before* pushing — the banner is a pure renderer.
 */
export function ServiceErrorBanner() {
  const serviceErrors = useFlightStore((s) => s.serviceErrors);
  const dismiss = useFlightStore((s) => s.dismissServiceError);

  if (serviceErrors.length === 0) return null;

  return (
    <div className="pointer-events-none fixed top-14 right-4 z-50 flex w-[26rem] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {serviceErrors.map((err) => (
        <Alert
          key={err.id}
          variant="destructive"
          className="pointer-events-auto shadow-lg"
        >
          <AlertCircle />
          <AlertTitle>{err.title}</AlertTitle>
          <AlertDescription>
            <p>{err.message}</p>
            {err.hint && <p className="mt-1 text-xs opacity-80">{err.hint}</p>}
          </AlertDescription>
          <AlertAction>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => dismiss(err.id)}
              aria-label="Dismiss"
            >
              <X className="size-4" />
            </Button>
          </AlertAction>
        </Alert>
      ))}
    </div>
  );
}
