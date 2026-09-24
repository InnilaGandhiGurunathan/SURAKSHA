import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Globe,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import type { IncidentReport } from '@suraksha/shared';
import { REPORT_STATUS_COPY, deliverySummary } from '@suraksha/shared';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/format';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { InfoNote } from './StatusPieces';

/**
 * Delivery status, told exactly.
 *
 * The single most important honesty requirement in the product: a report is
 * "delivered" only when a server acknowledged it. Everything else is described as
 * what it is — on this device, timed out, or handed to the website.
 */

const STATUS_ICON: Record<string, typeof Clock> = {
  draft: FileText,
  queued: Clock,
  submitting: Send,
  submitted: Send,
  acknowledged: CheckCircle2,
  timeout: AlertTriangle,
  fallback_opened: Globe,
  synced: RefreshCw,
  failed: AlertTriangle,
  verified: ShieldCheck,
  rejected: FileText,
};

export function ReportStatusBadge({ report, className }: { report: IncidentReport; className?: string }) {
  const copy = REPORT_STATUS_COPY[report.status];
  const Icon = STATUS_ICON[report.status] ?? Clock;
  const variant =
    copy.tone === 'ok' ? 'success' : copy.tone === 'bad' ? 'danger' : copy.tone === 'warn' ? 'warning' : 'muted';

  return (
    <Badge variant={variant} className={className}>
      <Icon aria-hidden />
      {copy.label}
    </Badge>
  );
}

export function DeliveryStatusCard({
  report,
  onRetry,
  onOpenFallback,
  onCopyReference,
  retrying,
  className,
}: {
  report: IncidentReport;
  onRetry?: () => void;
  onOpenFallback?: () => void;
  onCopyReference?: () => void;
  retrying?: boolean;
  className?: string;
}) {
  const summary = deliverySummary(report);
  const tone = summary.tone === 'ok' ? 'success' : summary.tone === 'bad' ? 'danger' : summary.tone === 'warn' ? 'warning' : 'muted';

  return (
    <div className={cn('space-y-3', className)}>
      <InfoNote tone={tone} title={summary.label}>
        <p>{summary.detail}</p>
      </InfoNote>

      <dl className="grid grid-cols-2 gap-2 text-[11px]">
        <Detail label="Unique report ID" value={report.clientReportId} mono />
        <Detail label="Reference" value={`SRK-${report.clientReportId.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase()}`} mono />
        <Detail label="Channel" value={report.deliveryChannel === 'website' ? 'Reporting website' : 'SURAKSHA app'} />
        <Detail label="Attempts from this device" value={String(report.attempts)} />
        <Detail
          label="Server acknowledgement"
          value={report.serverAckId ? `${report.serverAckId.slice(0, 12)}…` : 'none yet'}
          mono={Boolean(report.serverAckId)}
        />
        <Detail label="Received by server" value={report.receivedAt ? formatDateTime(report.receivedAt) : 'not yet'} />
        {report.fallbackOpenedAt ? (
          <Detail label="Fallback opened" value={formatDateTime(report.fallbackOpenedAt)} />
        ) : null}
        {report.verificationNote ? <Detail label="Reviewer note" value={report.verificationNote} span /> : null}
      </dl>

      <div className="flex flex-wrap gap-2">
        {summary.delivered ? null : (
          <>
            {onRetry ? (
              <Button size="sm" variant="accent" loading={retrying} onClick={onRetry}>
                <Send className="size-3.5" />
                Try again now
              </Button>
            ) : null}
            {onOpenFallback ? (
              <Button size="sm" variant="outline" onClick={onOpenFallback}>
                <ExternalLink className="size-3.5" />
                Open reporting website
              </Button>
            ) : null}
          </>
        )}
        {onCopyReference ? (
          <Button size="sm" variant="ghost" onClick={onCopyReference}>
            Copy tracking reference
          </Button>
        ) : null}
      </div>

      {report.status === 'timeout' ? (
        <InfoNote tone="warning" title="Why the fallback exists">
          <p>
            The app waited a full 30 seconds for a server acknowledgement. Rather than keep retrying silently,
            it can hand your details to the reporting website, which uses the same backend and the same unique
            report ID — so nothing is duplicated.
          </p>
        </InfoNote>
      ) : null}

      {report.status === 'failed' && report.lastError ? (
        <InfoNote tone="danger" title="Last error">
          <p>{report.lastError}</p>
        </InfoNote>
      ) : null}
    </div>
  );
}

function Detail({
  label,
  value,
  mono = false,
  span = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  span?: boolean;
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-muted/30 px-2.5 py-2', span && 'col-span-2')}>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 break-all text-[11px] font-medium', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}
