import type { RiskAssessment, SafetyRules } from '@suraksha/shared';
import { Activity, Info, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { RISK_HEURISTIC_NOTE, RISK_BAND_META } from '@/lib/format';
import { stageExplanation, stageLabel } from '@suraksha/risk-engine';
import { Badge, RiskBadge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Progress } from './ui/misc';
import { Disclaimer, InfoNote } from './StatusPieces';

/**
 * Risk presentation.
 *
 * Hard rules encoded here so no screen can break them:
 *  - the score is always accompanied by the heuristic disclaimer;
 *  - the threshold table is visible, so the number is auditable rather than magic;
 *  - the current escalation stage is spelled out, including what it does *not* do.
 */
export function RiskPanel({
  assessment,
  rules,
  compact = false,
  className,
}: {
  assessment?: RiskAssessment;
  rules?: SafetyRules;
  compact?: boolean;
  className?: string;
}) {
  if (!assessment) {
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4 text-teal-500" />
            Risk indicator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            No assessment yet. Start a journey and turn monitoring on — the engine then evaluates on this device
            every few seconds.
          </p>
          <Disclaimer>{RISK_HEURISTIC_NOTE}</Disclaimer>
        </CardContent>
      </Card>
    );
  }

  const meta = RISK_BAND_META[assessment.band];

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Activity className="size-4 text-teal-500" />
            Risk indicator
          </span>
          <RiskBadge band={assessment.band} score={assessment.score} />
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        <Progress
          value={assessment.score}
          tone={assessment.band === 'critical' || assessment.band === 'high' ? 'danger' : assessment.band === 'medium' ? 'warning' : 'success'}
          label="Heuristic risk score out of 100"
        />

        <p className="text-xs leading-relaxed text-muted-foreground">{meta.description}</p>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">{stageLabel(assessment.stage)}</Badge>
          {assessment.triggeredBy ? <Badge variant="muted">trigger: {assessment.triggeredBy.replace(/_/g, ' ')}</Badge> : null}
          {assessment.requiresHumanConfirmation ? (
            <Badge variant="info">waits for your confirmation</Badge>
          ) : null}
        </div>

        <p className="text-[11px] leading-relaxed text-muted-foreground">{stageExplanation(assessment.stage)}</p>

        {assessment.rationale.length > 0 ? (
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              What added to the score
            </p>
            <ul className="space-y-1">
              {assessment.rationale.map((reason) => (
                <li key={reason} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-current" aria-hidden />
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            No signals — nothing on this device looks unusual right now.
          </p>
        )}

        {!compact ? (
          <div className="rounded-xl border border-border bg-muted/30 p-2.5">
            <p className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Info className="size-3" aria-hidden />
              Prototype weights (configurable in Settings)
            </p>
            <ul className="grid grid-cols-1 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground sm:grid-cols-2">
              <li>Missed checkpoint: +{rules?.missedCheckpointWeight ?? 10}</li>
              <li>Deviation with unusual context: +{rules?.deviationContextWeight ?? 25}</li>
              <li>Plain deviation: +{rules?.deviationWeight ?? 12}</li>
              <li>Manual SOS: +{rules?.manualSosWeight ?? 50}</li>
              <li>Delay beyond {rules?.delayThresholdMinutes ?? 20} min: +{rules?.delayWeight ?? 15}</li>
              <li>Unanswered check-in: +{rules?.unreachableWeight ?? 20}</li>
              <li>Answered “not safe”: +{rules?.declinedCheckInWeight ?? 45}</li>
              <li>GPS lost over 12 min: +{rules?.gpsLostWeight ?? 6}</li>
            </ul>
          </div>
        ) : null}

        {assessment.band === 'safe' || assessment.band === 'low' ? (
          <InfoNote tone="muted">
            <p>
              A missed checkpoint alone raises this indicator by{' '}
              {rules?.missedCheckpointWeight ?? 10} points and never contacts anyone. Escalation needs several
              independent signals, an explicit SOS, or an answer of “not safe”.
            </p>
          </InfoNote>
        ) : null}

        <Disclaimer>
          {assessment.disclaimer} {RISK_HEURISTIC_NOTE}
        </Disclaimer>
      </CardContent>
    </Card>
  );
}

export function RiskLegend({ className }: { className?: string }) {
  const bands: Array<{ id: keyof typeof RISK_BAND_META; range: string; meaning: string }> = [
    { id: 'safe', range: '0–9', meaning: 'Nothing unusual on the device.' },
    { id: 'low', range: '10–24', meaning: 'Minor signals; quiet monitoring.' },
    { id: 'medium', range: '25–49', meaning: 'Several signals; a discreet check-in is offered.' },
    { id: 'high', range: '50–74', meaning: 'Escalation criteria met; trusted contacts told.' },
    { id: 'critical', range: '75–100', meaning: 'SOS or “not safe”; emergency workflow open.' },
  ];

  return (
    <div className={cn('space-y-1.5', className)}>
      {bands.map((band) => (
        <div key={band.id} className="flex items-center gap-2 text-[11px]">
          <span className={cn('size-2.5 shrink-0 rounded-full', `bg-${RISK_BAND_META[band.id].token}`)} aria-hidden />
          <span className="w-14 shrink-0 font-medium">{RISK_BAND_META[band.id].label}</span>
          <span className="w-14 shrink-0 tabular-nums text-muted-foreground">{band.range}</span>
          <span className="min-w-0 flex-1 text-muted-foreground">{band.meaning}</span>
        </div>
      ))}
      <p className="flex items-start gap-1.5 pt-1 text-[10px] text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-3 shrink-0" aria-hidden />
        Thresholds are configurable; these are the defaults. Scores are heuristic indicators, not probabilities.
      </p>
    </div>
  );
}
