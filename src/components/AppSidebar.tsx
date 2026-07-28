import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import { useIgcFileLoader } from '../hooks/useIgcFileLoader';
import { useFlightStore } from '../state/useFlightStore';
import { FlightSummaryPanel } from './FlightSummaryPanel';
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

/**
 * Left navigation sidebar. Currently hosts a single menu action to upload
 * an IGC flight log (FR-M-1); the flight name is shown once loaded.
 */
export function AppSidebar() {
  const { t } = useTranslation();
  const { loadFile, isParsing, loadError } = useIgcFileLoader();
  const flight = useFlightStore((s) => s.flight);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) loadFile(file);
    event.target.value = '';
  };

  return (
    <Sidebar className="top-12 h-[calc(100svh-3rem)]">
      <SidebarHeader className="px-2 py-1">
        <h1 className="text-lg font-semibold">{t('app.title')}</h1>
      </SidebarHeader>
      <SidebarContent>
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
                <input
                  ref={inputRef}
                  type="file"
                  accept=".igc"
                  className="hidden"
                  onChange={onFileInputChange}
                />
              </SidebarMenuItem>
            </SidebarMenu>
            {flight && (
              <p className="text-muted-foreground mt-2 truncate px-2 text-xs">
                {flight.header.gliderType ?? t('upload.menuItem')} ·{' '}
                {flight.header.date}
              </p>
            )}
            {loadError && (
              <Alert variant="destructive" className="mt-2">
                <AlertTitle>{t('errors.title')}</AlertTitle>
                <AlertDescription>{loadError.message}</AlertDescription>
              </Alert>
            )}
            {flight && (
              <div className="mt-3 px-2">
                <FlightSummaryPanel />
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
