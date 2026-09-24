/**
 * Community safety — a lightweight, privacy-preserving board.
 * No feeds, no comments, no personal data, no live locations.
 */

import { useState } from 'react';
import {
  BadgeCheck,
  Building2,
  Check,
  Clock,
  Coffee,
  Hospital,
  Info,
  MapPin,
  Plus,
  ShieldHalf,
  ThumbsUp,
  TrafficCone,
} from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  EmptyState,
  Field,
  Input,
  Modal,
  Segmented,
  Select,
  Textarea,
} from '@/components/ui/primitives';
import { PageHeader, SectionHeading } from '@/components/domain/blocks';
import { useAppState, store } from '@/store/hooks';
import type { SafePlace, SafetyReport } from '@/domain/types';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

const PLACE_ICON: Record<SafePlace['type'], typeof Building2> = {
  security: ShieldHalf,
  reception: Building2,
  hospital: Hospital,
  help_desk: MapPin,
  cafe: Coffee,
  gate: MapPin,
};

const CATEGORY_LABEL: Record<SafetyReport['category'], string> = {
  lighting: 'Lighting',
  access: 'Access',
  footpath: 'Footpath',
  crowd: 'Crowding',
  other: 'Other',
};

export function Community() {
  const { places, reports, now } = useAppState();
  const [tab, setTab] = useState<'places' | 'reports'>('places');
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Traveller · Community"
        title="Community safety"
        description="Verified places you can walk into, and practical reports about the route. No feeds, no names, no live locations."
        actions={
          <Button size="sm" icon={<Plus size={15} />} onClick={() => setReportOpen(true)}>
            Add a report
          </Button>
        }
      />

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'places', label: 'Verified safe places' },
          { value: 'reports', label: 'Safety reports' },
        ]}
      />

      {tab === 'places' ? (
        <div>
          <SectionHeading
            title="Verified safe places"
            description="Places with staff, lighting and a door you can wait behind."
          />
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {places.map((place) => {
              const Icon = PLACE_ICON[place.type];
              return (
                <li key={place.id}>
                  <Card className="h-full">
                    <CardBody className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink-100 text-ink-600">
                          <Icon size={18} />
                        </span>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {place.verified ? (
                            <Chip tone="safe">
                              <BadgeCheck size={12} /> Verified
                            </Chip>
                          ) : null}
                          <Chip tone={place.openNow ? 'safe' : 'watch'}>{place.openNow ? 'Open now' : 'Closed'}</Chip>
                        </div>
                      </div>
                      <div>
                        <p className="text-[14px] font-bold text-ink-900">{place.name}</p>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">{place.note}</p>
                      </div>
                      <div className="flex items-center gap-3 text-[11.5px] font-medium text-ink-500">
                        <span className="inline-flex items-center gap-1.5">
                          <MapPin size={12} /> {place.distanceMeters} m
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Clock size={12} /> {place.hours}
                        </span>
                      </div>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <SectionHeading title="Safety reports" description="Practical, non-identifying notes about places." />
            {reports.length ? (
              <ul className="space-y-3">
                {reports.map((report) => (
                  <li key={report.id}>
                    <Card>
                      <CardBody className="space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[14px] font-bold text-ink-900">{report.title}</p>
                            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-500">
                              <span className="inline-flex items-center gap-1.5">
                                <MapPin size={12} /> {report.locationLabel}
                              </span>
                              <span className="text-ink-300">·</span>
                              <span>{formatRelative(report.createdAt, now)}</span>
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <Chip tone="neutral">{CATEGORY_LABEL[report.category]}</Chip>
                            <Chip tone={report.status === 'verified' ? 'safe' : report.status === 'closed' ? 'neutral' : 'watch'}>
                              {report.status}
                            </Chip>
                          </div>
                        </div>

                        {report.note ? <p className="text-[12.5px] leading-relaxed text-ink-600">{report.note}</p> : null}

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => store.confirmReport(report.id)}
                            className={cn(
                              'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold transition-state',
                              report.confirmedByMe
                                ? 'border-safe-300 bg-safe-50 text-safe-800'
                                : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50',
                            )}
                          >
                            <Check size={14} /> I&apos;ve seen this · {report.confirms}
                          </button>
                          <button
                            type="button"
                            onClick={() => store.upvoteReport(report.id)}
                            className={cn(
                              'inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold transition-state',
                              report.upvotedByMe
                                ? 'border-brand-300 bg-brand-50 text-brand-800'
                                : 'border-ink-200 bg-white text-ink-700 hover:bg-ink-50',
                            )}
                          >
                            <ThumbsUp size={14} /> Helpful · {report.upvotes}
                          </button>
                          <span className="text-[11.5px] text-ink-400">Your confirmation is anonymous.</span>
                        </div>
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<TrafficCone size={20} />} title="No reports yet" description="Nothing has been noted on your usual routes." />
            )}
          </div>

          <Card tone="brand" className="bg-brand-50">
            <CardHeader title="What never appears here" icon={<Info size={16} />} />
            <CardBody className="space-y-2 text-[12.5px] leading-relaxed text-brand-900/85">
              <p>Personal phone numbers — never collected.</p>
              <p>Live user locations — never shown, to anyone.</p>
              <p>Private incident details — those stay in your own incident records.</p>
              <p>Names or identities of people involved in any report.</p>
              <div className="mt-2 rounded-xl bg-white/70 px-3.5 py-3 text-[12px] text-ink-600">
                Reports are about places and infrastructure: lighting, access, footpaths, crowding. If you want to report
                something about a person, contact your institution or local authorities.
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} />
    </div>
  );
}

function ReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [category, setCategory] = useState<SafetyReport['category']>('lighting');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a safety report"
      description="Describe the place and the issue — not people. No names, no phone numbers."
      footer={
        <>
          <Button
            onClick={() => {
              if (!title.trim()) return setError('Add a short title.');
              if (!location.trim()) return setError('Add a location label.');
              store.addReport({
                title: title.trim(),
                locationLabel: location.trim(),
                category,
                note: note.trim() || undefined,
              });
              setTitle('');
              setLocation('');
              setNote('');
              setError(null);
              onClose();
            }}
          >
            Submit report
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title" htmlFor="r-title">
          <Input
            id="r-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Streetlight not working near Gate 3"
          />
        </Field>
        <Field label="Location label" htmlFor="r-loc" hint="A landmark is enough — no exact coordinates.">
          <Input id="r-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Campus Road, Gate 3" />
        </Field>
        <Field label="Category" htmlFor="r-cat">
          <Select id="r-cat" value={category} onChange={(e) => setCategory(e.target.value as SafetyReport['category'])}>
            {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Details (optional)" htmlFor="r-note">
          <Textarea
            id="r-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Two-pole stretch is fully dark after 9:30 PM."
          />
        </Field>
        {error ? <p className="text-[12.5px] font-semibold text-critical-700">{error}</p> : null}
      </div>
    </Modal>
  );
}
