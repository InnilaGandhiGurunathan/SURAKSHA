/** Guardian incident list — filterable history with status. */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileText, ShieldAlert } from 'lucide-react';
import {
  Badge,
  Card,
  CardBody,
  Chip,
  EmptyState,
  Segmented,
  StatusPill,
} from '@/components/ui/primitives';
import { PageHeader } from '@/components/domain/blocks';
import { useAppState, store } from '@/store/hooks';
import { formatDate, formatDateTime } from '@/lib/format';
import type { IncidentSeverity } from '@/domain/types';

export function GuardianIncidents() {
  const { incidents, alerts } = useAppState();
  const [filter, setFilter] = useState<'all' | 'open' | IncidentSeverity>('all');

  const filtered = incidents.filter((incident) => {
    if (filter === 'all') return true;
    if (filter === 'open') return incident.status !== 'RESOLVED';
    return incident.severity === filter;
  });

  const openCount = incidents.filter((i) => i.status !== 'RESOLVED').length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Guardian · Records"
        title="Incidents"
        description="Incidents are records of stacked safety signals — a timeline, an explanation and any evidence, so you can review rather than reconstruct."
        actions={
          <>
            <Chip tone={openCount ? 'critical' : 'safe'}>{openCount} open</Chip>
            <Chip tone="neutral">{alerts.length} alerts total</Chip>
          </>
        }
      />

      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'open', label: 'Open' },
          { value: 'CRITICAL', label: 'Critical' },
          { value: 'ALERT', label: 'Alert' },
          { value: 'WATCH', label: 'Watch' },
        ]}
      />

      {filtered.length ? (
        <div className="overflow-hidden rounded-card border border-ink-200 bg-white shadow-card">
          <table className="w-full min-w-[680px] border-collapse text-left">
            <thead>
              <tr className="border-b border-ink-200 bg-ink-50 text-[11px] font-bold uppercase tracking-[0.07em] text-ink-500">
                <th className="px-4 py-3">Incident</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Traveller</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Risk</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((incident) => (
                <tr key={incident.id} className="border-b border-ink-100 last:border-0 hover:bg-ink-50/60">
                  <td className="px-4 py-3">
                    <span className="font-mono text-[13px] font-bold text-ink-900">{incident.code}</span>
                    {incident.evidence.length ? (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-500">
                        <FileText size={11} /> {incident.evidence.length} evidence
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <StatusPill band={incident.severity} size="sm" showEmoji={false} />
                  </td>
                  <td className="px-4 py-3 text-[13px] text-ink-700">{incident.travellerName}</td>
                  <td className="px-4 py-3 text-[12.5px] text-ink-600">
                    {formatDate(incident.createdAt, { month: 'short', day: 'numeric' })}
                    <span className="block text-[11px] text-ink-400">{formatDateTime(incident.createdAt).split('·')[1]}</span>
                  </td>
                  <td className="px-4 py-3 text-[13px] font-semibold text-ink-800 tabular">{incident.riskScore}</td>
                  <td className="px-4 py-3">
                    <Badge tone={incident.status === 'RESOLVED' ? 'safe' : incident.status === 'ACKNOWLEDGED' ? 'brand' : 'critical'}>
                      {incident.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/guardian/incidents/${incident.id}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-200 px-3 text-[12.5px] font-semibold text-ink-800 hover:bg-ink-50"
                    >
                      Open <ArrowRight size={13} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={<ShieldAlert size={22} />}
          title="No incidents in this filter"
          description="Try another filter, or wait for a signal — SURAKSHA creates records only when signals actually stack up."
        />
      )}

      {store.getState().travellerProfile.demoMode ? (
        <Card className="border-dashed border-brand-300 bg-brand-50/50">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] font-semibold text-brand-900">
              Demo: create an incident instantly with Quick SOS on the traveller side.
            </p>
            <button
              type="button"
              onClick={() => store.toggleUi('demoPanelOpen', true)}
              className="rounded-xl bg-brand-600 px-3.5 py-2 text-[12.5px] font-semibold text-white hover:bg-brand-700"
            >
              Open demo panel
            </button>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
