import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/AppSidebar"
import { MapView } from "@/components/MapView"
import { ReplayControls } from "@/components/ReplayControls"
import { Barogram } from "@/components/Barogram"
import { LoaderProgressDialog } from "@/components/LoaderProgressDialog"
import { FileText } from 'lucide-react';

import './i18n';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./components/ui/empty"
import { useTranslation } from "react-i18next"
import { useFlightStore } from "./state/useFlightStore"
import { useReplayEngine, useReplayKeyboardShortcuts } from "./replay/replayEngine"
import { useElevationLoader } from "./hooks/useElevationLoader"
import { ErrorBanner } from "./components/ErrorBanner"
import { useOpenaipAirports } from "./hooks/useOpenaipAirports"
import { useAutoLocalCheck } from "./hooks/useAutoLocalCheck"
import { EscapePathProfile } from "./components/EscapePathProfile"
import { useCurrentEscapePath } from "./hooks/useEscapeTargets"
import { useAutoReachableZone } from "./hooks/useAutoReachableZone"
import { HelpPanel } from "./components/HelpPanel"
import { useState } from "react"

export function App() {
  const flight = useFlightStore((s) => s.flight);
  const exception = useFlightStore((s) => s.exception);
  const setException = useFlightStore((s) => s.setException);
  
  const [isHelpOpen, setIsHelpOpen] = useState(false)

  useReplayEngine();
  useReplayKeyboardShortcuts();
  useElevationLoader();
  useOpenaipAirports();
  useAutoLocalCheck();
  useAutoReachableZone();
  const escapePath = useCurrentEscapePath();
  
  return (
    <SidebarProvider defaultOpen={false} className="h-screen flex-col overflow-hidden">

      <ErrorBanner
            error={exception}
            title="Une erreur est survenue"
            onDismiss={() => setException(null)}
         />
      <LoaderProgressDialog />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AppSidebar onOpenHelp={() => setIsHelpOpen(true)} />

        {/* CONTENU PRINCIPAL */}
        <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">

          {/* <SidebarTrigger /> */}
          {/* <!-- Premiere div : 70% de hauteur, 100% de largeur --> */}
          <MapView escapePath={escapePath} />

          {/* <!-- Deuxieme div : h-48 + h-12 de hauteur, 100% de largeur --> */}
          <div className="h-60 w-full shrink-0 flex flex-col">
            <div className="h-48 shrink-0 flex border-b">
              {flight && (
                <>
                  <Barogram />
                  <EscapePathProfile escapePath={escapePath} />
                </>
              )}
              {!flight &&  (
                <NoFlight />
              )}
            </div>
            <ReplayControls />
          </div>
      </SidebarInset>

      <HelpPanel open={isHelpOpen} onOpenChange={setIsHelpOpen} />

      </div>
    </SidebarProvider>
  )
}

 function NoFlight() {
  const { t } = useTranslation();
  
  return (
    <>
        <Empty className="border border-solid bg-muted/40 m-3 ">
          <EmptyHeader>
            <EmptyMedia>
              <FileText />
            </EmptyMedia>
            <EmptyTitle>
              {t('noFlight.title')}
            </EmptyTitle>
            <EmptyDescription>
              {t('noFlight.description')}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {/* <Button size="sm">Upload an IGC flight</Button> */}
          </EmptyContent>
        </Empty>
    </>
  )
}

export default App
