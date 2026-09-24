import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Camera,
  CheckCircle2,
  Clock,
  CloudOff,
  ExternalLink,
  FileWarning,
  Globe,
  Image as ImageIcon,
  MapPin,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import type { Journey, ReportAttachment, ReportCategory, ReportSeverity, UserProfile } from '@suraksha/shared';
import { REPORT_ACK_TIMEOUT_MS, REPORT_CATEGORIES, REPORT_SEVERITIES, reportReference, formatCoordinates } from '@suraksha/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckboxRow, Field, FormError, Input, Select, Textarea } from '@/components/ui/field';
import { Progress } from '@/components/ui/misc';
import { Disclaimer, InfoNote, SectionHeader } from '@/components/StatusPieces';
import { ReportStatusBadge } from '@/components/ReportStatus';
import { useCountdown, useOnline } from '@/hooks/useConnectivity';
import { useLocation } from '@/hooks/useLocation';
import { DISCLAIMERS, MAX_REPORT_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '@/lib/constants';
import { formatBytes, formatDateTime } from '@/lib/format';
import { listJourneys } from '@/services/journeys';
import { db } from '@/lib/db';
import { compressImage } from '@/services/media';
import {
  buildFallbackHandoff,
  createReport,
  openFallbackWebsite,
  reportReferenceText,
  submitReport,
  type SubmitOutcome,
} from '@/services/reports';
import { recordEvent } from '@/services/events';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * File an incident report.
 *
 * The flow, in the order the brief demands:
 *  1. validate and **write to IndexedDB** — the report exists before any network
 *     call, and the UI says so;
 *  2. attempt delivery with a visible countdown against a hard 30-second deadline;
 *  3. if the deadline passes, offer the fallback reporting website carrying the
 *     same unique report ID (so nothing can be duplicated);
 *  4. if offline, keep it queued and say plainly that nothing has been delivered.
 */
export function NewReportScreen({ user }: { user: UserProfile }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { usable } = useOnline();
  const location = useLocation({ watch: false });

  const [category, setCategory] = useState<ReportCategory>('harassment');
  const [severity, setSeverity] = useState<ReportSeverity>('medium');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [locationLabel, setLocationLabel] = useState('');
  const [useGps, setUseGps] = useState(true);
  const [anonymous, setAnonymous] = useState(false);
  const [journeyId, setJourneyId] = useState(params.get('journeyId') ?? '');
  const [attachments, setAttachments] = useState<ReportAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | undefined>();

  const [error, setError] = useState<string | undefined>();
  const [phase, setPhase] = useState<'form' | 'sending' | 'done'>('form');
  const [outcome, setOutcome] = useState<SubmitOutcome | undefined>();
  const [reportId, setReportId] = useState<string | undefined>();
  const [offerFallback, setOfferFallback] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const journeys = useLiveQuery(async () => listJourneys(user.id), [user.id], [] as Journey[]);
  const countdown = useCountdown(REPORT_ACK_TIMEOUT_MS, phase === 'sending');

  const report = useLiveQuery(
    async () => (reportId ? db.reports.get(reportId) : undefined),
    [reportId],
    undefined,
  );

  // Nudge the fallback offer the instant the deadline passes.
  useEffect(() => {
    if (phase === 'sending' && countdown.expired) setOfferFallback(true);
  }, [phase, countdown.expired]);

  const descriptionTooShort = description.trim().length > 0 && description.trim().length < 15;

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachmentError(undefined);

    const room = MAX_REPORT_ATTACHMENTS - attachments.length;
    if (room <= 0) {
      setAttachmentError(`A report can carry up to ${MAX_REPORT_ATTACHMENTS} photos.`);
      return;
    }

    const next: ReportAttachment[] = [];
    for (const file of Array.from(files).slice(0, room)) {
      if (!file.type.startsWith('image/')) {
        setAttachmentError('Only images can be attached on this device. Text and video are not supported yet.');
        continue;
      }
      try {
        const compressed = await compressImage(file, { maxDimension: 1280, quality: 0.72 });
        if (compressed.sizeBytes > MAX_ATTACHMENT_BYTES) {
          setAttachmentError(
            `${file.name} is still ${formatBytes(compressed.sizeBytes)} after resizing. Try a smaller photo.`,
          );
          continue;
        }
        next.push({
          id: `${file.name}-${file.lastModified}`,
          name: file.name,
          mimeType: 'image/jpeg',
          sizeBytes: compressed.sizeBytes,
          dataUrl: compressed.dataUrl,
        });
      } catch {
        setAttachmentError(`${file.name} could not be processed on this device.`);
      }
    }

    setAttachments((prev) => [...prev, ...next]);
  };

  const save = async (): Promise<string | undefined> => {
    setError(undefined);

    if (title.trim().length < 4) {
      setError('Give the report a short, recognisable title.');
      return undefined;
    }
    if (description.trim().length < 15) {
      setError('Describe what happened — at least a sentence, so a reviewer can act on it.');
      return undefined;
    }

    const draft = await createReport({
      owner: user,
      category,
      severity,
      title,
      description,
      occurredAt: new Date(occurredAt).toISOString(),
      location: useGps ? location.point : undefined,
      locationLabel: locationLabel || undefined,
      journeyId: journeyId || undefined,
      attachments,
      anonymity: anonymous ? 'anonymous' : 'named',
    });

    await recordEvent({
      ownerId: user.id,
      journeyId: journeyId || undefined,
      type: 'report_created',
      message: `Report ${reportReferenceText(draft)} written on this device (${category}, ${severity}).`,
      location: draft.location,
      data: { reportId: draft.id },
    });

    setReportId(draft.id);
    return draft.id;
  };

  const send = async () => {
    const id = reportId ?? (await save());
    if (!id) return;

    setPhase('sending');
    setOfferFallback(false);

    const result = await submitReport(id, {
      openFallbackWindow: false,
      timeoutMs: REPORT_ACK_TIMEOUT_MS,
    });

    setOutcome(result);
    setPhase('done');

    if (result.acknowledged) {
      await recordEvent({
        ownerId: user.id,
        journeyId: journeyId || undefined,
        type: result.duplicate ? 'report_synced' : 'report_acknowledged',
        message: result.duplicate
          ? 'The server already had this report; nothing was duplicated.'
          : 'Reporting server acknowledged the report.',
        data: { reportId: id, ackId: result.report.serverAckId },
      });
      toast.success('Report acknowledged by the reporting server.');
    } else if (result.timedOut) {
      await recordEvent({
        ownerId: user.id,
        journeyId: journeyId || undefined,
        type: 'report_timeout',
        message: 'No server acknowledgement within 30 seconds.',
        severity: 'warning',
        data: { reportId: id },
      });
      setOfferFallback(true);
    } else {
      toast.message(result.message);
    }
  };

  const openFallback = async () => {
    if (!report) return;
    const opened = await openFallbackWebsite(report);
    await recordEvent({
      ownerId: user.id,
      journeyId: journeyId || undefined,
      type: 'report_fallback_opened',
      message: opened.opened
        ? 'Reporting website opened with these details, carrying the same unique report ID.'
        : 'The reporting website could not be opened automatically. Use the copy button and open it manually.',
      severity: 'warning',
      data: { reportId: report.id, url: opened.url },
    });
    if (!opened.opened) {
      toast.message('Popup blocked. The link is shown below — open it from there.');
    } else {
      toast.success('Reporting website opened with your details.');
    }
  };

  const reference = useMemo(() => (report ? reportReference(report.clientReportId) : undefined), [report]);

  return (
    <div className="space-y-4 pb-8">
      <SectionHeader
        title="Report an incident"
        description="Saved on this device first. Delivery is only claimed when a server acknowledges it."
        action={
          <Button size="sm" variant="ghost" onClick={() => navigate('/app/report')}>
            <X className="size-3.5" />
            Close
          </Button>
        }
      />

      {phase === 'done' && report ? (
        <Card tone={outcome?.acknowledged ? 'success' : 'warning'}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                {outcome?.acknowledged ? (
                  <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
                ) : (
                  <Clock className="size-4 text-amber-500" aria-hidden />
                )}
                {outcome?.acknowledged ? 'Report received' : 'Report saved on this device'}
              </span>
              <ReportStatusBadge report={report} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs leading-relaxed">{outcome?.message ?? 'The report is stored locally.'}</p>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-xl border border-border bg-muted/30 px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Tracking reference</p>
                <p className="mt-0.5 font-mono text-xs font-semibold">{reference}</p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 px-2.5 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Unique report ID</p>
                <p className="mt-0.5 break-all font-mono text-[10px]">{report.clientReportId}</p>
              </div>
            </div>

            {offerFallback && !outcome?.acknowledged ? (
              <InfoNote tone="warning" title="No acknowledgement within 30 seconds">
                <p>
                  The primary channel has not confirmed receipt. You can hand these exact details to the reporting
                  website — it uses the same backend and the same unique report ID, so it cannot create a
                  duplicate.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="accent" onClick={() => void openFallback()}>
                    <Globe className="size-3.5" />
                    Open reporting website
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const handoff = await buildFallbackHandoff(report);
                      try {
                        await navigator.clipboard.writeText(handoff.url);
                        toast.success('Link copied. Open it in any browser.');
                      } catch {
                        toast.message(handoff.url);
                      }
                    }}
                  >
                    Copy fallback link
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void send()}>
                    Try the app again
                  </Button>
                </div>
                {report.fallbackUrl ? (
                  <p className="mt-1.5 break-all text-[10px] text-muted-foreground">{report.fallbackUrl}</p>
                ) : null}
              </InfoNote>
            ) : null}

            {!outcome?.acknowledged && !offerFallback ? (
              <InfoNote tone="info" title="What happens next">
                <p>
                  {usable
                    ? 'SURAKSHA will retry automatically and tell you the real outcome.'
                    : 'You are offline, so the report waits on this device. It is retried automatically when a connection returns.'}
                </p>
              </InfoNote>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => navigate(`/app/report/${report.id}`)}>
                <FileWarning className="size-3.5" />
                Open report
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setPhase('form');
                  setOutcome(undefined);
                  setReportId(undefined);
                  setOfferFallback(false);
                  setTitle('');
                  setDescription('');
                  setAttachments([]);
                }}
              >
                File another report
              </Button>
            </div>

            <Disclaimer>
              Filed {formatDateTime(report.createdAt)} · {report.attempts} delivery attempt(s) from this device.
              {report.serverAckId ? ` Server acknowledgement ${report.serverAckId.slice(0, 12)}…` : ' No server acknowledgement yet.'}
            </Disclaimer>
          </CardContent>
        </Card>
      ) : null}

      {phase !== 'done' ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <FileWarning className="size-4 text-teal-500" aria-hidden />
                What happened
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FormError message={error} />

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Category" htmlFor="report-category" required>
                  <Select
                    id="report-category"
                    value={category}
                    onChange={(event) => setCategory(event.target.value as ReportCategory)}
                    options={REPORT_CATEGORIES.map((item) => ({ value: item.value, label: item.label }))}
                  />
                </Field>
                <Field
                  label="Severity"
                  htmlFor="report-severity"
                  required
                  hint={REPORT_SEVERITIES.find((item) => item.value === severity)?.hint}
                >
                  <Select
                    id="report-severity"
                    value={severity}
                    onChange={(event) => setSeverity(event.target.value as ReportSeverity)}
                    options={REPORT_SEVERITIES.map((item) => ({ value: item.value, label: item.label }))}
                  />
                </Field>
              </div>

              {severity === 'critical' ? (
                <InfoNote tone="danger" title="Is this happening now?">
                  <p>
                    If you are in danger, call your emergency number ({user.emergency.emergencyNumber || '112'})
                    and use SOS. A report is not an emergency call and nobody is dispatched from it.
                  </p>
                </InfoNote>
              ) : null}

              <Field label="Title" htmlFor="report-title" required>
                <Input
                  id="report-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Followed from the station exit"
                  maxLength={120}
                />
              </Field>

              <Field
                label="Description"
                htmlFor="report-description"
                required
                error={descriptionTooShort ? 'A little more detail helps a reviewer — aim for a full sentence.' : undefined}
                hint="What happened, where, and anything that would help others or responders."
              >
                <Textarea
                  id="report-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  className="min-h-[160px]"
                  maxLength={4000}
                  placeholder="At about 21:40 a man followed me from the exit towards the taxi stand. He stopped when I entered the shop."
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="When did it happen?" htmlFor="report-when" required>
                  <Input
                    id="report-when"
                    type="datetime-local"
                    value={occurredAt}
                    onChange={(event) => setOccurredAt(event.target.value)}
                  />
                </Field>
                <Field label="Place (free text)" htmlFor="report-place" hint="A landmark is often more useful than a coordinate.">
                  <Input
                    id="report-place"
                    value={locationLabel}
                    onChange={(event) => setLocationLabel(event.target.value)}
                    placeholder="Opposite the pharmacy, north exit"
                  />
                </Field>
              </div>

              <CheckboxRow
                id="report-gps"
                checked={useGps}
                onChange={setUseGps}
                label={`Attach my current position${location.point ? ` (${formatCoordinates(location.point, 4)})` : ''}`}
                description={
                  location.point
                    ? location.accuracyLabel
                    : location.qualityLabel ?? 'No GPS fix yet — the report can be filed without a position.'
                }
              />

              <Field label="Related journey (optional)" htmlFor="report-journey" hint="Links the report to a journey timeline.">
                <Select
                  id="report-journey"
                  value={journeyId}
                  onChange={(event) => setJourneyId(event.target.value)}
                  options={[
                    { value: '', label: 'Not linked to a journey' },
                    ...(journeys ?? []).map((journey) => ({ value: journey.id, label: journey.title })),
                  ]}
                />
              </Field>

              <CheckboxRow
                id="report-anon"
                checked={anonymous}
                onChange={setAnonymous}
                label="Report anonymously"
                description="Your name and contact details are withheld. The report still carries a unique ID so you can track it."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2">
                <Camera className="size-4 text-teal-500" aria-hidden />
                Photos (optional)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Photos are resized on this device and stored with the report locally. A report is never held back
                waiting for media.
              </p>

              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(event) => void addFiles(event.target.files)}
              />

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => fileInput.current?.click()}>
                  <ImageIcon className="size-4" />
                  Add photos
                </Button>
                {attachments.length > 0 ? (
                  <Button variant="ghost" onClick={() => setAttachments([])}>
                    <Trash2 className="size-4" />
                    Remove all
                  </Button>
                ) : null}
              </div>

              {attachmentError ? <FormError message={attachmentError} /> : null}

              {attachments.length > 0 ? (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {attachments.map((attachment) => (
                    <li key={attachment.id} className="relative overflow-hidden rounded-xl border border-border">
                      {attachment.dataUrl ? (
                        <img src={attachment.dataUrl} alt={attachment.name} className="h-24 w-full object-cover" />
                      ) : null}
                      <button
                        type="button"
                        aria-label={`Remove ${attachment.name}`}
                        onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))}
                        className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-navy-950/70 text-white"
                      >
                        <X className="size-3" />
                      </button>
                      <p className="truncate px-1.5 py-1 text-[10px] text-muted-foreground">
                        {formatBytes(attachment.sizeBytes)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          {phase === 'sending' ? (
            <Card tone="info">
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-semibold">
                    <Send className="size-4 text-sky-500" aria-hidden />
                    Sending to the reporting server
                  </p>
                  <Badge variant={countdown.expired ? 'danger' : 'info'}>
                    {countdown.expired ? 'deadline passed' : `${countdown.remainingSeconds}s left`}
                  </Badge>
                </div>
                <Progress value={countdown.percent} tone={countdown.expired ? 'danger' : 'accent'} label="Acknowledgement window" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Waiting up to 30 seconds for an explicit acknowledgement. If none arrives, SURAKSHA offers the
                  reporting website instead of pretending the report was sent.
                </p>
              </CardContent>
            </Card>
          ) : null}

          <div className="space-y-2">
            <Button
              variant="accent"
              size="lg"
              full
              loading={phase === 'sending'}
              onClick={() => void send()}
              loadingText="Waiting for acknowledgement…"
            >
              <Send className="size-4" />
              Save and send report
            </Button>
            <Button
              variant="outline"
              full
              onClick={async () => {
                const id = await save();
                if (!id) return;
                toast.success('Saved on this device. Send it when you are ready.');
                navigate('/app/report');
              }}
            >
              <CloudOff className="size-4" />
              Save without sending
            </Button>
          </div>

          <InfoNote tone="info" title="Where this goes">
            <ul className="list-inside list-disc space-y-0.5">
              <li>Stored in this device’s database first, with a unique report ID.</li>
              <li>
                Sent to {import.meta.env.VITE_API_BASE_URL ?? '/api'} — the same backend the public reporting
                website uses, which is what prevents duplicates.
              </li>
              <li>
                If verified by a responder, it may appear in the community feed with your identity stripped and
                contact details removed.
              </li>
            </ul>
            <Disclaimer className="mt-2">{DISCLAIMERS.community}</Disclaimer>
          </InfoNote>
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" asChild>
          <a href="/report-site" target="_blank" rel="noreferrer">
            <ExternalLink className="size-3.5" />
            Prefer the website?
          </a>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate('/app/report')}>
          All my reports
        </Button>
      </div>

      {report ? (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <ShieldCheck className="size-3" aria-hidden />
          Report ID {report.clientReportId} · status snapshot only, the report detail screen has the full picture.
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-1.5 pt-5">
          <p className="flex items-center gap-1.5 text-xs font-semibold">
            <MapPin className="size-3.5 text-teal-500" aria-hidden />
            Location handling
          </p>
          <p className={cn('text-[11px] leading-relaxed', location.error ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
            {location.error
              ? `${location.error.message} ${location.error.remedy}`
              : location.point
                ? `${location.accuracyLabel}. ${location.isStale ? 'This fix is old — check it before you rely on it.' : ''}`
                : 'Waiting for a position. You can still file the report; the place description carries the context.'}
          </p>
          {location.point ? (
            <p className="text-[10px] text-muted-foreground">
              {formatCoordinates(location.point, 5)} · recorded {formatDateTime(location.recordedAt)}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

export default NewReportScreen;
