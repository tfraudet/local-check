import { useTranslation } from 'react-i18next';
import { useFlightStore } from '../state/useFlightStore';

const LEGEND_ITEMS = [
  { color: 'bg-cyan-400', key: 'initialClimb' },
  { color: 'bg-cyan-600', key: 'motor' },
  { color: 'bg-green-500', key: 'inLocal' },
  { color: 'bg-yellow-400', key: 'marginal' },
  { color: 'bg-red-500', key: 'outOfLocal' },
  { color: 'bg-blue-500', key: 'finalGlide' },
] as const;

export function ColorLegend() {
  const { t } = useTranslation();
  const arrivalHeightM = useFlightStore((s) => s.localCheckParams.arrivalHeightM);

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">
        {t('localCheck.legend.title')}
      </p>
      <ul className="space-y-0.5">
        {LEGEND_ITEMS.map(({ color, key }) => (
          <li key={key} className="flex items-center gap-2 text-xs">
            <span
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-sm ${color}`}
              aria-hidden="true"
            />
            {key === 'marginal'
              ? t(`localCheck.legend.${key}`, {
                  height: Math.round(arrivalHeightM),
                })
              : t(`localCheck.legend.${key}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
