import { useTranslation } from 'react-i18next';

/**
 * Persistent, always-visible safety disclaimer plus a compact keyboard
 * shortcuts legend for replay controls.
 */
export function LegendAndDisclaimer() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-1 border-t bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
      <p className="font-medium">{t('app.disclaimer')}</p>
      <p>
        <span className="font-semibold">{t('legend.shortcutsTitle')}:</span>{' '}
        Space — {t('legend.spaceKey')} · ←/→ — {t('legend.arrowKeys')} · Home —{' '}
        {t('legend.homeKey')}
      </p>
    </div>
  );
}
