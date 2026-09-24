import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ArrowLeft,
  ExternalLink,
  FileText,
  Globe,
  MapPin,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { IncidentReport, UserProfile } from '@suraksha/shared';
import { REPORT_CATEGORIES, REPORT_SEVERITIES, formatCoordinates, reportReference } from '@suraksha/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { DeliveryStatusCard, ReportStatusBadge } from '@/components/ReportStatus';
import { Disclaimer, InfoNote, LoadingBlock, SectionHeader, StatusTile } from '@/components/StatusPieces';
import { MapView } from '@/components/MapView';
import { TimelineList } from '@/components/TimelineList';
import { db } from '@/lib/db';
import { DISCLAIMERS } from '@/lib/constants';
import { formatBytes, formatDateTime, formatRelative, truncate } from '@/lib/format';
import { reportReferenceText } from '@/services/reports';
import { deleteReport, openFallbackWebsite, submitReport } from '@/services/reports';
import { listEvents } from '@/services/events';
import { copyText } from '@/services/sms';
import { toast } from 'sonner';

/**
 * One report, in full.
 *
 * This screen has to be scrupulously honest: the delivery card shows exactly what
 * is known, the unique ID is visible so it can be quoted to a responder, and the
 * actions (retry, fallback, copy reference) match what the product can actually
 * do. Nothing here claims a delivery the server has not acknowledged.
 */
export function ReportDetailScreen({ user }: { user: UserProfile }) {
  const { reportId = '' } = useParams();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'details' | 'delivery' | 'timeline'>('details');
  const [busy, setBusy] = useState(false);

  const report = useLiveQuery(async () => db.reports.get(reportId), [reportId]);

  const events = useLiveQuery(
    async () => {
      const all = await listEvents({ ownerId: user.id, limit: 300 });
      return all.filter((event) => (event.data as { reportId?: string } | undefined)?.reportId === reportId);
    },
    [user.id, reportId],
  );

  const category = useMemo(
    () => REPORT_CATEGORIES.find((item) => item.value === report?.category),
    [report?.category],
  );

  if (!report) {
    return <LoadingBlock label="Loading this report from the device…" rows={3} />;
  }

  const reference = reportReferenceText(report);

  const retry = async () => {
    setBusy(true);
    const outcome = await submitReport(report.id, { timeoutMs: 30_000, openFallbackWindow: false });
    setBusy(false);
    toast.message(outcome.message);
  };

  const severity = REPORT_SEVERITIES.find((item) => item.value === report.severity);

  return (
    <div className="space-y-4 pb-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/app/report')}>
        <ArrowLeft className="size-3.5" />
        All reports
      </Button>

      <SectionHeader
        title={report.title}
        description={`${category?.label ?? report.category} · ${severity?.label ?? report.severity} · occurred ${formatDateTime(
          report.occurredAt,
        )}`}
        action={<ReportStatusBadge report={report} />}
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatusTile
          label="Delivery"
          value={report.serverAckId ? 'acknowledged' : report.status.replace('_', ' ')}
          tone={report.serverAckId ? 'ok' : 'warn'}
          hint={report.serverAckId ? `ack ${report.serverAckId.slice(0, 8)}…` : 'no server acknowledgement'}
        />
        <StatusTile
          label="Attempts"
          value={String(report.attempts)}
          hint={report.lastAttemptAt ? `last ${formatRelative(report.lastAttemptAt)}` : 'not tried yet'}
        />
        <StatusTile
          label="Verification"
          value={report.verification.replace('_', ' ')}
          tone={report.verification === 'verified' ? 'ok' : 'default'}
          hint={report.isCommunityVisible ? 'visible in the community feed' : 'not published'}
        />
        <StatusTile
          label="Location"
          value={report.location ? 'attached' : 'none'}
          tone={report.location ? 'ok' : 'warn'}
          hint={report.locationLabel ?? (report.location ? formatCoordinates(report.location) : 'no position recorded')}
        />
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="delivery">Delivery</TabsTrigger>
          <TabsTrigger value="timeline">Timeline ({(events ?? []).length})</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <FileText className="size-4 text-teal-500" aria-hidden />
                What was reported
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="whitespace-pre-wrap text-xs leading-relaxed">{report.description}</p>

              <dl className="grid grid-cols-2 gap-2 text-[11px]">
                <Row label="Category" value={category?.label ?? report.category} />
                <Row label="Severity" value={severity?.label ?? report.severity} />
                <Row label="Occurred" value={formatDateTime(report.occurredAt)} />
                <Row label="Filed" value={formatDateTime(report.createdAt)} />
                <Row label="Anonymity" value={report.anonymity === 'anonymous' ? 'anonymous' : 'named'} />
                <Row label="Linked journey" value={report.journeyId ? 'yes' : 'no'} />
              </dl>

              {report.location || report.locationLabel ? (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <MapPin className="size-3.5 text-teal-500" aria-hidden />
                    Where
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {report.locationLabel ?? 'No description given'}
                    {report.location ? ` · ${formatCoordinates(report.location)}` : ''}
                  </p>
                  {report.location ? (
                    <MapView
                      markers={[{ id: 'report', point: report.location, label: 'Report location', kind: 'user' }]}
                      className="border-0"
                    />
                  ) : null}
                </div>
              ) : null}

              {report.attachments.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold">Photos ({report.attachments.length})</p>
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {report.attachments.map((attachment) => (
                      <li key={attachment.id} className="overflow-hidden rounded-xl border border-border">
                        {attachment.dataUrl ? (
                          <img src={attachment.dataUrl} alt={attachment.name} className="h-24 w-full object-cover" />
                        ) : (
                          <div className="grid h-24 place-items-center bg-muted px-2 text-center text-[10px] text-muted-foreground">
                            {attachment.remoteUrl ? 'Uploaded to the server' : 'Stored locally'}
                          </div>
                        )}
                        <p className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">
                          {formatBytes(attachment.sizeBytes)}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-muted-foreground">
                    Photos stay on this device unless a server accepts them. A report is never held back because of
                    media.
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Identifiers you can quote</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Row label="Tracking reference" value={<span className="font-mono">{reference}</span>} />
              <Row
                label="Unique report ID"
                value={<span className="break-all font-mono text-[10px]">{report.clientReportId}</span>}
              />
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const ok = await copyText(`${reference} (${report.clientReportId})`);
                    toast.message(ok ? 'Reference copied.' : 'Could not copy on this browser.');
                  }}
                >
                  Copy reference
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <Link
                    to={`${import.meta.env.VITE_FALLBACK_REPORT_URL ?? '/report-site'}?ref=${reference}&id=${report.clientReportId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="size-3.5" />
                    Open on the reporting website
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="delivery">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <ShieldCheck className="size-4 text-teal-500" aria-hidden />
                  Delivery status
                </span>
                <ReportStatusBadge report={report} />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DeliveryStatusCard
                report={report}
                retrying={busy}
                onRetry={() => void retry()}
                onOpenFallback={async () => {
                  const result = await openFallbackWebsite(report);
                  toast.message(
                    result.opened
                      ? 'Reporting website opened with these details.'
                      : result.carriedInUrl
                        ? 'The browser blocked the popup. Open the reporting website manually — the details are carried in the link, which is stored on this device.'
                        : 'The browser blocked the popup. Open the reporting website manually and paste the reference below.',
                  );
                }}
                onCopyReference={async () => {
                  const ok = await copyText(reference);
                  toast.message(ok ? 'Reference copied.' : 'Could not copy.');
                }}
              />
            </CardContent>
          </Card>

          {report.status === 'fallback_opened' ? (
            <InfoNote tone="warning" title="Handed to the reporting website">
              <p>
                The app opened the website with these details after the acknowledgement deadline. Whether the report
                reached the server is decided there — the tracking box on that page is the answer, not this screen.
              </p>
            </InfoNote>
          ) : null}

          {report.verification !== 'unverified' ? (
            <InfoNote
              tone={report.verification === 'verified' ? 'success' : 'info'}
              title={`Reviewer decision: ${report.verification}`}
            >
              <p>
                {report.verification === 'verified'
                  ? report.isCommunityVisible
                    ? 'A responder verified this report, so a redacted version may appear in the community feed.'
                    : 'A responder verified this report but kept it private.'
                  : report.verificationNote ?? 'A responder reviewed this report and did not publish it.'}
              </p>
            </InfoNote>
          ) : null}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Globe className="size-4 text-teal-500" aria-hidden />
                Two channels, one report
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
              <p>
                The app and the public reporting website submit to the same backend and send the same{' '}
                <strong>unique report ID</strong>. If both arrive, the server stores one and tells the second caller it
                was a duplicate — which is exactly why the fallback can be opened automatically without risking a
                second incident record.
              </p>
              <Disclaimer>{DISCLAIMERS.delivery}</Disclaimer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle>Report lifecycle</CardTitle>
            </CardHeader>
            <CardContent>
              <TimelineList events={events ?? []} emptyLabel="No timeline entries recorded for this report yet." />
              <p className="mt-3 text-[10px] text-muted-foreground">
                Written, sent, acknowledged, timed out, handed to the website, reviewed — every step is recorded on
                this device.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" loading={busy} onClick={() => void retry()}>
          <RefreshCw className="size-3.5" />
          Retry delivery
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={async () => {
            const result = await openFallbackWebsite(report);
            toast.message(
              result.opened
                ? 'Reporting website opened with these details.'
                : 'The popup was blocked — the handoff link was stored on this device; open the reporting website from the browser menu.',
            );
          }}
        >
          <Send className="size-3.5" />
          Open reporting website
        </Button>
        <ConfirmDialog
          trigger={
            <Button size="sm" variant="ghost" className="text-destructive">
              <Trash2 className="size-3.5" />
              Delete local copy
            </Button>
          }
          title="Delete this report from the device?"
          description={
            report.serverAckId
              ? 'A server copy exists and is not affected. This removes only the copy on this device, including any photos.'
              : 'No server has acknowledged this report. Deleting it removes the only copy that exists.'
          }
          confirmLabel="Delete"
          onConfirm={async () => {
            await deleteReport(report.id);
            toast.success('Report removed from this device.');
            navigate('/app/report', { replace: true });
          }}
        />
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          This screen shows exactly what SURAKSHA knows. {truncate(DISCLAIMERS.noRescueGuarantee, 180)}
        </p>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-2.5 py-2">
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[11px] font-medium">{value}</dd>
    </div>
  );
}

export default ReportDetailScreen;
