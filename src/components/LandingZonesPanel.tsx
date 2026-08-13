import { useFlightStore } from "@/state/useFlightStore";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "./ui/scroll-area";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "./ui/item";
import { AlertTriangleIcon, Circle, Eye, EyeOff, Square } from "lucide-react";
import { Button } from "./ui/button";
import { Alert, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";

export function LandingZonesPanel() {
  const { t } = useTranslation();

  const landingZones = useFlightStore((s) => s.landingZones);
  const visibleIds = useFlightStore((s) => s.visibleLandingZoneIds);
  const toggleVisibility = useFlightStore((s) => s.toggleLandingZoneVisibility);

  const airfieldCount = landingZones.filter((z) => z.isAirfield).length;
  const outlandingCount = landingZones.length - airfieldCount;

  return (
    <>
      {landingZones.length === 0 ? (
        <div className="p-2">
          <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-50">
            <AlertTriangleIcon />
            <AlertTitle>{t('landingZones.empty')}</AlertTitle>
          </Alert>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-center flex-wrap gap-2 px-2 pt-0 pb-3">
            <Badge className="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300">
              <Circle fill="var(--primary)" color="var(--primary)" className="size-3" data-icon="inline-start" />
                {airfieldCount} {t('landingZones.airfield')}
            </Badge>
             <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
              <Square fill="var(--color-purple-700)" color="var(--color-purple-700)" className="size-3" data-icon="inline-start" />
                {outlandingCount} {t('landingZones.outlanding')}
            </Badge>           
          </div>

        <div className="px-2 border-t border-b border-green-200 bg-green-50  text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-50">
          <label className="text-xs font-light text-muted-foreground">
            {visibleIds.size} {t('landingZones.visible')} - {landingZones.length - visibleIds.size} {t('landingZones.hiden')}: 
          </label>
        </div>
        <ScrollArea className="h-50 w-full border-b" >
          <ItemGroup className="has-data-[size=sm]:gap-0 has-data-[size=xs]:gap-0">
            {landingZones.map((lz) => {
              const visible = visibleIds.has(lz.id);
              return (
                <Item className="py-0" size="xs" key={lz.id}>
                  <ItemMedia variant="icon">
                    <Circle fill="var(--primary)" color="var(--primary)" className="size-3"/>
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle  className="text-xs font-light">{lz.name}</ItemTitle>
                  </ItemContent>
                    <ItemActions>
                    <Button 
                      size="icon-sm" variant="outline" className="rounded-full"
                      onClick={() => toggleVisibility(lz.id)}
                      aria-label={visible ? 'Hide' : 'Show'}
                      >
                      {visible ? (
                        <Eye  />
                      ) : (
                        <EyeOff />
                      )}
                    </Button>
                    </ItemActions>
                </Item>
              );
            })}             
          </ItemGroup>
        </ScrollArea>     
        </>     
      )}
    </>      

  );
}