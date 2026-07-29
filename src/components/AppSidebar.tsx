import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Upload } from 'lucide-react';
import { cn } from '../lib/utils';
import { useIgcFileLoader } from '../hooks/useIgcFileLoader';
import { useFlightStore } from '../state/useFlightStore';
import { FlightSummaryPanel } from './FlightSummaryPanel';
import { LandingZonesPanel } from './LandingZonesPanel';
import { LocalCheckSettings } from './LocalCheckSettings';
import { LocalStatsPanel } from './LocalStatsPanel';
import { ColorLegend } from './ColorLegend';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from './ui/sidebar';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Skeleton } from './ui/skeleton';
import { Separator } from './ui/separator';

export function AppSidebar() {
  const { t } = useTranslation();
  const { loadFile, isParsing, loadError } = useIgcFileLoader();
  const flight = useFlightStore((s) => s.flight);
  const elevationLoadError = useFlightStore((s) => s.elevationLoadError);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const dragCounterRef = useRef(0);

  const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) loadFile(file);
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
    if (file) loadFile(file);
  };

  return (
    <Sidebar className="top-12 h-[calc(100svh-3rem)]">
      <SidebarHeader className="px-2 py-1">
        <h1 className="text-lg font-semibold">{t('app.title')}</h1>
      </SidebarHeader>
      <SidebarContent>
        {/* ── Flight upload ─────────────────────────────────────────────── */}
        <SidebarGroup>
          <SidebarGroupLabel>{t('upload.menuGroup')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => inputRef.current?.click()}
                  disabled={isParsing}
                  tooltip={t('upload.menuItem')}
                >
                  <Upload />
                  <span>
                    {isParsing ? t('upload.parsing') : t('upload.menuItem')}
                  </span>
                </SidebarMenuButton>
                <Input
                  ref={inputRef}
                  type="file"
                  accept=".igc"
                  className="hidden"
                  onChange={onFileInputChange}
                />
              </SidebarMenuItem>
            </SidebarMenu>
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
            {flight && (
              <div className="mt-2 flex flex-wrap items-center gap-1 px-2">
                {flight.header.gliderType && (
                  <Badge variant="secondary">{flight.header.gliderType}</Badge>
                )}
                {flight.header.date && (
                  <Badge variant="outline">{flight.header.date}</Badge>
                )}
              </div>
            )}
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
            {flight && (
              <div className="mt-3 px-2">
                <FlightSummaryPanel />
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        {/* ── Landing Zones (Phase 2) ───────────────────────────────────── */}
        {flight && (
          <>
            <Separator />
            <SidebarGroup>
              <SidebarGroupLabel>{t('landingZones.menuGroup')}</SidebarGroupLabel>
              <SidebarGroupContent className="px-2">
                {elevationLoadError && (
                  <Alert variant="destructive" className="mb-2">
                    <AlertCircle className="size-4" />
                    <AlertTitle>{t('errors.title')}</AlertTitle>
                    <AlertDescription>{t('errors.elevation.fetchFailed')}</AlertDescription>
                  </Alert>
                )}
                <LandingZonesPanel />
              </SidebarGroupContent>
            </SidebarGroup>

            {/* ── Local Check Settings ─────────────────────────────────── */}
            <Separator />
            <SidebarGroup>
              <SidebarGroupLabel>{t('localCheck.settings.title')}</SidebarGroupLabel>
              <SidebarGroupContent className="px-2">
                <LocalCheckSettings />
              </SidebarGroupContent>
            </SidebarGroup>

            {/* ── Results ──────────────────────────────────────────────── */}
            <Separator />
            <SidebarGroup>
              <SidebarGroupLabel>{t('localCheck.stats.title')}</SidebarGroupLabel>
              <SidebarGroupContent className="px-2">
                <LocalStatsPanel />
              </SidebarGroupContent>
            </SidebarGroup>

            {/* ── Color Legend ─────────────────────────────────────────── */}
            <Separator />
            <SidebarGroup>
              <SidebarGroupContent className="px-2">
                <ColorLegend />
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
