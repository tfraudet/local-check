import { useEffect } from 'react';
import '../i18n';
import { useTranslation } from 'react-i18next';
import { Moon, Sun } from 'lucide-react';
import { useFlightStore } from '../state/useFlightStore';
import { useTheme } from '../hooks/useTheme';
import {
  useReplayEngine,
  useReplayKeyboardShortcuts,
} from '../replay/replayEngine';
import { useElevationLoader } from '../hooks/useElevationLoader';
import { useOutlandingDatabase } from '../hooks/useOutlandingDatabase';
import { useOpenaipAirports } from '../hooks/useOpenaipAirports';
import { useAutoLocalCheck } from '../hooks/useAutoLocalCheck';
import { useAutoReachableZone } from '../hooks/useAutoReachableZone';
import { AppSidebar } from '../components/AppSidebar';
import { MapView } from '../components/MapView';
import { Barogram } from '../components/Barogram';
import { EscapePathProfilePanel } from '../components/EscapePathProfilePanel';
import { ReplayControls } from '../components/ReplayControls';
import { TelemetryPanel } from '../components/TelemetryPanel';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '../components/ui/sidebar';
import { TooltipProvider } from '../components/ui/tooltip';
import { Separator } from '../components/ui/separator';
import { Button } from '../components/ui/button';

/**
 * AppShell composition root. A left sidebar hosts the upload menu; the map
 * is always visible (centered on Issoire until a flight is loaded). Once a
 * flight loads, the barogram, telemetry/summary panels, and replay
 * controls appear alongside it.
 */
function App() {
  const { t } = useTranslation();
  const flight = useFlightStore((s) => s.flight);
  const showEscapePath = useFlightStore((s) => s.showEscapePath);
  const { theme, toggleTheme } = useTheme();

  useReplayEngine();
  useReplayKeyboardShortcuts();
  useElevationLoader();
  useOutlandingDatabase();
  useOpenaipAirports();
  useAutoLocalCheck();
  useAutoReachableZone();

  useEffect(() => {
    document.title = t('app.title');
  }, [t]);

  return (
    <TooltipProvider>
      <SidebarProvider
        className="h-screen flex-col overflow-hidden"
        style={
          {
            '--sidebar-width': 'calc(var(--sidebar-width-icon) + 1px + 16rem)',
          } as React.CSSProperties
        }
      >
        <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <h1 className="text-lg font-semibold">{t('app.title')}</h1>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={toggleTheme}
            aria-label={
              theme === 'dark'
                ? t('theme.switchToLight')
                : t('theme.switchToDark')
            }
            title={
              theme === 'dark'
                ? t('theme.switchToLight')
                : t('theme.switchToDark')
            }
          >
            {theme === 'dark' ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </Button>
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <AppSidebar />
          <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
            <main className="flex flex-1 overflow-hidden">
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex-1 overflow-hidden">
                  <MapView />
                </div>
                {flight && !showEscapePath && <TelemetryPanel />}
                {flight && !showEscapePath && (
                  <div className="h-48 border-t">
                    <Barogram />
                  </div>
                )}
                {flight && showEscapePath && (
                  <div className="flex">
                    <div className="flex min-w-0 flex-1 flex-col">
                      {/* TelemetryPanel provides its own top border, so the
                          outer wrapper doesn't add one — otherwise the two
                          would stack and offset the left column by 1 px
                          below the right panel's top edge. */}
                      <TelemetryPanel />
                      <div className="h-48 border-t">
                        <Barogram />
                      </div>
                    </div>
                    <div className="min-w-0 basis-[30%] border-l border-t">
                      <EscapePathProfilePanel />
                    </div>
                  </div>
                )}
              </div>
            </main>
            {flight && <ReplayControls />}
          </SidebarInset>
        </div>
      </SidebarProvider>
    </TooltipProvider>
  );
}

export default App;
