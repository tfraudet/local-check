// components/ErrorBanner.tsx
import React from "react";
import { AlertCircle, X } from "lucide-react";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "@/components/ui/alert";
import { Button } from "./ui/button";
// import { useFlightStore } from "@/state/useFlightStore";

interface ErrorBannerProps {
  error: Error | string | null;
  title?: string;
  onDismiss?: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({
  error,
  title = "Une erreur est survenue",
  onDismiss,
}) => {
  // const dismiss = useFlightStore((s) => s.setException);

  if (!error) return null;

console.log('onDismiss: ', onDismiss);
const errorMessage = typeof error === "string" ? error : error.message;

return (
    // <Alert 
    //     variant="destructive" 
    //     className="relative my-4 border-red-500/50 bg-red-50 dark:bg-red-950/20"
    // >
    //   <AlertCircle className="h-4 w-4" />
    //   <div className="flex-1 pr-6">
    //     <AlertTitle className="font-semibold">{title}</AlertTitle>
    //     <AlertDescription className="mt-1 text-sm">
    //       {errorMessage}
    //     </AlertDescription>
    //   </div>

    //   {onDismiss && (
    //     <button
    //       onClick={onDismiss}
    //       className="absolute right-3 top-3 rounded-md p-1 text-red-500 opacity-70 transition-opacity hover:opacity-100 focus:outline-none"
    //       aria-label="Fermer"
    //     >
    //       <X className="h-4 w-4" />
    //     </button>
    //   )}
    // </Alert>

    // <div className="pointer-events-none fixed top-14 right-4 z-50 flex w-104 max-w-[calc(100vw-2rem)] flex-col gap-2">
    <div className="fixed top-4 right-4 z-50 w-104 max-w-[calc(100vw-2rem)] grid items-start gap-4">
        <Alert
        //   key={err.id}
        variant="destructive"
        className="pointer-events-auto shadow-lg"
        >
        <AlertCircle />
        <AlertTitle className="min-w-0">{title}</AlertTitle>
        <AlertDescription className="min-w-0 break-words [overflow-wrap:anywhere]">
            <p>{errorMessage}</p>
            {/* {err.hint && <p className="mt-1 text-xs opacity-80">{err.hint}</p>} */}
        </AlertDescription>
        <AlertAction>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
            <X className="size-4" />
            </Button>
        </AlertAction>
        </Alert>
    </div>
  );
};
