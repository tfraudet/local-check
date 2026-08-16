import { useTranslation } from "react-i18next";
import { SidebarGroup, SidebarGroupContent } from "./ui/sidebar";
import { AlertCircle, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useFlightStore } from "@/state/useFlightStore";
import { useIgcFileLoader } from '../hooks/useIgcFileLoader';
import { Button } from './ui/button';
import { Input } from "./ui/input";
import { cn } from '../lib/utils';
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Skeleton } from "./ui/skeleton";
import { FlightSummaryPanel } from "./FlightSummaryPanel";
import { LocalStats } from "./LocalStats";
import { ColorLegend } from "./ColorLegend";
import { Separator } from "./ui/separator";

export function FlightPanel() {
  const { t } = useTranslation();
  const { loadFile, isParsing, loadError } = useIgcFileLoader();
  const flight = useFlightStore((s) => s.flight);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const dragCounterRef = useRef(0);

  const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) loadFile(file, 'picker');
    event.target.value = '';
  };

  const onDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (isParsing) return;
    dragCounterRef.current += 1;
    setIsDragActive(true);
  };

  const onDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const onDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragActive(false);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragCounterRef.current = 0;
    setIsDragActive(false);
    if (isParsing) return;
    const file = event.dataTransfer.files?.[0];
    if (file) loadFile(file, 'dragdrop');
  };

  return (
    <>
      <SidebarGroup>
        <SidebarGroupContent className="px-1.5 md:px-0">
            <div className="flex justify-center">
              <Button
                className="w-fit"
                onClick={() => inputRef.current?.click()}
                disabled={isParsing}
              >
                <Upload />
                <span>
                  {isParsing ? t('upload.parsing') : t('upload.menuItem')}
                </span>
              </Button>
            </div>
            <Input
              ref={inputRef}
              type="file"
              accept=".igc"
              className="hidden"
              onChange={onFileInputChange}
            />
            <div
              role="button"
              tabIndex={0}
              aria-label={t('upload.dragHint')}
              onClick={() => !isParsing && inputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  if (!isParsing) inputRef.current?.click();
                }
              }}
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              className={cn(
                'mx-2 mt-2 flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed p-4 text-center transition-colors',
                isDragActive
                  ? 'border-primary bg-accent/50'
                  : 'border-border hover:bg-accent/30',
                isParsing && 'pointer-events-none opacity-50',
              )}
            >
              <Upload className="size-4 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                {t('upload.dragHint')}
              </p>
            </div>

            {loadError && (
              <Alert variant="destructive" className="mt-2">
                <AlertCircle />
                <AlertTitle>{t('errors.title')}</AlertTitle>
                <AlertDescription>{loadError.message}</AlertDescription>
              </Alert>
            )}
            {isParsing && !flight && (
              <div className="mt-3 flex flex-col gap-2 px-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-20 w-full" />
              </div>
            )}
        </SidebarGroupContent>
      </SidebarGroup>
      
      {flight && (
        <>
          <SidebarGroup>
            <SidebarGroupContent >
                <FlightSummaryPanel />
            </SidebarGroupContent>
          </SidebarGroup>
          
          <Separator />

          <SidebarGroup>
            <SidebarGroupContent >
                <LocalStats />
            </SidebarGroupContent>
          </SidebarGroup>
          
          <Separator />

          <SidebarGroup>
            <SidebarGroupContent >
                <ColorLegend />
            </SidebarGroupContent>
          </SidebarGroup>
        </>  
      )}
    </>
  )
}