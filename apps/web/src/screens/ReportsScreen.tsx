import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, CloudOff, FileWarning, Plus, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import type { IncidentReport, UserProfile } from '@suraksha/shared';
import { REPORT_CATEGORIES, deliverySummary } from '@suraksha/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { EmptyState, InfoNote, SectionHeader, StatusTile, Disclaimer } from '@/components/StatusPieces';
import { ReportStatusBadge } from '@/components/ReportStatus';
import { formatDateTime, formatRelative, truncate } from '@/lib/format';
import { listReports, retryAllReports, deleteReport } from '@/services/reports';
import { useOnline } from '@/hooks/useConnectivity';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * Incident reports list.
 *
 * The organising principle is delivery truth: the tabs are "still on this device"
 * versus "delivered", because that is the question a user actually has. Nothing
 * is grouped as sent simply because it was written.
 */
export function ReportsScreen({ user }: { user: UserProfile }) {
  const { usable } = useOnline();
  const reports = useLiveQuery(async () => listReports(user.id), [user.id], undefined);
  const [tab, setTab] = useState<'pending' | 'delivered'>('pending');
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const list = reports ?? [];
    const delivered = list.filter((report) =>
      ['acknowledged', 'synced', 'verified', 'rejected'].includes(report.status),
    );
    const pending = list.filter((report) => !delivered.includes(report));
    return { delivered, pending, all: list };
  }, [reports]);

  const retryAll = async () => {
    setBusy(true);
    const result = await retryAllReports(user.id);
    setBusy(false);
    toast.message(
      result.attempted === 0
        ? 'Nothing waiting to send.'
        : `${result.acknowledged} of ${result.attempted} report(s) acknowledged. ${result.stillPending} still pending.`,
    );
  };

  const renderList = (items: IncidentReport[], empty: React.ReactNode) =>
    items.length === 0 ? (
      empty
    ) : (
      <ul className="space-y-2.5">
        {items.map((report) => {
          const summary = deliverySummary(report);
          const category = REPORT_CATEGORIES.find((item) => item.value === report.category);

          return (
            <li key={report.id}>
              <Link to={`/app/report/${report.id}`} className="block">
                <Card className={cn('transition-colors hover:bg-muted/40', summary.tone === 'bad' && 'border-red-500/40')}>
                  <CardContent className="space-y-2 pt-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {report.title}
                          {report.isDemo ? <Badge variant="muted" className="ml-2">demo</Badge> : null}
                        </p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {category?.label ?? report.category} · {report.severity} · occurred{' '}
                          {formatDateTime(report.occurredAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <ReportStatusBadge report={report} />
                        {report.verification === 'verified' ? (
                          <Badge variant="success">
                            <ShieldCheck className="size-3" aria-hidden />
                            verified
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {truncate(report.description, 140)}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span>ID {report.clientReportId.slice(0, 14)}…</span>
                      <span>{report.attempts} attempt(s)</span>
                      {report.serverAckId ? <span>ack {report.serverAckId.slice(0, 8)}…</span> : <span>no server ack</span>}
                      {report.attachments.length > 0 ? <span>{report.attachments.length} photo(s)</span> : null}
                      <span>updated {formatRelative(report.updatedAt)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    );

  if (!reports) {
    return <p className="text-xs text-muted-foreground">Reading reports from this device…</p>;
  }

  return (
    <div className="space-y-4 pb-6">
      <SectionHeader
        title="Incident reports"
        description="Written on this device first. Delivery status shows what actually happened."
        action={
          <Button size="sm" variant="accent" asChild>
            <Link to="/app/report/new">
              <Plus className="size-3.5" />
              New
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatusTile label="Total" value={String(grouped.all.length)} />
        <StatusTile
          label="On device only"
          value={String(grouped.pending.length)}
          tone={grouped.pending.length ? 'warn' : 'ok'}
          hint="Not acknowledged by a server"
        />
        <StatusTile
          label="Delivered"
          value={String(grouped.delivered.length)}
          tone="ok"
          hint="Server acknowledged"
        />
        <StatusTile
          label="Connection"
          value={usable ? 'online' : 'offline'}
          tone={usable ? 'ok' : 'warn'}
          hint={usable ? 'reports can be sent' : 'they queue locally'}
        />
      </div>

      {grouped.pending.length > 0 ? (
        <InfoNote
          tone={usable ? 'info' : 'warning'}
          title={`${grouped.pending.length} report(s) are still only on this device`}
          actions={
            <Button size="sm" variant="outline" loading={busy} onClick={() => void retryAll()}>
              <RefreshCw className="size-3.5" />
              Try sending all
            </Button>
          }
        >
          <p>
            {usable
              ? 'A connection is available. Retrying now will report the real outcome for each one.'
              : 'With no connection they stay queued. SURAKSHA retries automatically when a connection returns.'}
          </p>
        </InfoNote>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList>
          <TabsTrigger value="pending">
            <CloudOff className="mr-1.5 size-3.5" aria-hidden />
            On this device ({grouped.pending.length})
          </TabsTrigger>
          <TabsTrigger value="delivered">
            <ShieldCheck className="mr-1.5 size-3.5" aria-hidden />
            Delivered ({grouped.delivered.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          {renderList(
            grouped.pending,
            <EmptyState
              icon={<FileWarning className="size-5" />}
              title="Nothing waiting on this device"
              description="Reports you file appear here immediately, even before a server acknowledges them."
              action={
                <Button size="sm" variant="accent" asChild>
                  <Link to="/app/report/new">Report something</Link>
                </Button>
              }
            />,
          )}
        </TabsContent>

        <TabsContent value="delivered">
          {renderList(
            grouped.delivered,
            <EmptyState
              icon={<ShieldCheck className="size-5" />}
              title="No reports delivered yet"
              description="A report moves here only when a server explicitly acknowledged it."
            />,
          )}
        </TabsContent>
      </Tabs>

      {grouped.all.length > 0 ? (
        <Card>
          <CardContent className="space-y-2 pt-5">
            <p className="flex items-center gap-1.5 text-xs font-semibold">
              <AlertTriangle className="size-3.5 text-amber-500" aria-hidden />
              Managing local copies
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Deleting a report removes it from this device only. If it was already delivered, the server copy
              stays — delete it there if you need it gone.
            </p>
            <ul className="space-y-1.5">
              {grouped.all.slice(0, 3).map((report) => (
                <li key={report.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate">{report.title}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={async () => {
                      await deleteReport(report.id);
                      toast.success('Report removed from this device.');
                    }}
                  >
                    Delete local copy
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <InfoNote tone="muted" title="How delivery is reported">
        <ul className="list-inside list-disc space-y-0.5">
          <li>
            <strong>Queued</strong> — stored on this device. No server has seen it.
          </li>
          <li>
            <strong>Received</strong> — a server acknowledged it. This is the only “delivered” state.
          </li>
          <li>
            <strong>No acknowledgement in 30 s</strong> — the app can hand your details to the reporting website,
            which uses the same backend and the same unique report ID.
          </li>
          <li>
            <strong>Verified</strong> — a responder reviewed it; it may then appear in the community feed without
            your identity.
          </li>
        </ul>
        <Disclaimer className="mt-2">
          SURAKSHA never shows a delivery confirmation it did not receive. {usable ? '' : 'You are offline now.'}
        </Disclaimer>
      </InfoNote>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link to="/report-site">
            <WifiOff className="size-3.5" />
            Open the reporting website
          </Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/app/community">Community reports</Link>
        </Button>
      </div>
    </div>
  );
}

export default ReportsScreen;
