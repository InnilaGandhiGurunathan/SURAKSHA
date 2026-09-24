import type {
  ReportCategory,
  ReportDeliverySummary,
  IncidentReport,
  ReportSeverity,
  ReportStatus,
} from './types.js';

/**
 * Reporting vocabulary and the honest delivery language used everywhere in the
 * product. If a status string appears in the UI, it comes from here.
 */

export const REPORT_ACK_TIMEOUT_MS = 30_000;

export const REPORT_CATEGORIES: Array<{ value: ReportCategory; label: string; description: string }> = [
  { value: 'harassment', label: 'Harassment', description: 'Unwanted attention, verbal abuse, or intimidation.' },
  { value: 'stalking', label: 'Stalking / following', description: 'Being followed or repeatedly watched.' },
  { value: 'unsafe_area', label: 'Unsafe area', description: 'A place that felt dangerous at a particular time.' },
  { value: 'poor_lighting', label: 'Poor lighting / visibility', description: 'Dark stretches, no lighting, blocked sightlines.' },
  { value: 'transport_issue', label: 'Transport issue', description: 'Unsafe cab, bus, train or station conditions.' },
  { value: 'accident', label: 'Accident', description: 'A collision or injury you witnessed or experienced.' },
  { value: 'medical', label: 'Medical need', description: 'Someone needing medical help.' },
  { value: 'theft', label: 'Theft / lost property', description: 'Bag snatching, pickpocketing, stolen property.' },
  { value: 'suspicious_activity', label: 'Suspicious activity', description: 'Behaviour worth flagging to other travellers.' },
  { value: 'infrastructure', label: 'Infrastructure problem', description: 'Broken paths, missing signage, unsafe crossings.' },
  { value: 'other', label: 'Other', description: 'Anything that does not fit the categories above.' },
];

export const REPORT_SEVERITIES: Array<{ value: ReportSeverity; label: string; hint: string }> = [
  { value: 'low', label: 'Low', hint: 'Worth recording; no immediate danger.' },
  { value: 'medium', label: 'Medium', hint: 'Uncomfortable or unsafe situation that has ended.' },
  { value: 'high', label: 'High', hint: 'Present or recent danger to you or someone else.' },
  { value: 'critical', label: 'Critical', hint: 'Emergency in progress — call emergency services first.' },
];

export const REPORT_STATUS_COPY: Record<ReportStatus, { label: string; description: string; tone: ReportDeliverySummary['tone'] }> = {
  draft: {
    label: 'Draft',
    description: 'Written on this device but not sent yet.',
    tone: 'muted',
  },
  queued: {
    label: 'Queued on this device',
    description: 'Stored locally. Nothing has reached a server yet.',
    tone: 'warn',
  },
  submitting: {
    label: 'Sending',
    description: 'Trying to reach the reporting server right now.',
    tone: 'warn',
  },
  submitted: {
    label: 'Sent, awaiting acknowledgement',
    description: 'The request left this device. Waiting for the server to acknowledge it.',
    tone: 'warn',
  },
  acknowledged: {
    label: 'Received by the reporting server',
    description: 'A server explicitly acknowledged this report.',
    tone: 'ok',
  },
  timeout: {
    label: 'No acknowledgement in 30 seconds',
    description: 'The reporting server did not answer in time. Nothing is confirmed as delivered.',
    tone: 'bad',
  },
  fallback_opened: {
    label: 'Handed to the reporting website',
    description: 'The online reporting site was opened with these details. It decides whether the report arrived.',
    tone: 'warn',
  },
  synced: {
    label: 'Synced',
    description: 'The local copy and the server copy are in step.',
    tone: 'ok',
  },
  failed: {
    label: 'Sending failed',
    description: 'Every attempt failed. The report stays on this device and will be retried.',
    tone: 'bad',
  },
  verified: {
    label: 'Reviewed and verified',
    description: 'A responder verified this report.',
    tone: 'ok',
  },
  rejected: {
    label: 'Not published',
    description: 'A responder reviewed it and decided not to publish it to the community feed.',
    tone: 'muted',
  },
};

/** Priority used when handing off to the online reporting website. */
export function shouldOpenFallback(report: Pick<IncidentReport, 'status' | 'attempts'>): boolean {
  return report.status === 'timeout' || (report.attempts >= 2 && report.status === 'failed');
}

/**
 * Human-readable tracking reference, derived from the client-side report id so
 * the same report always yields the same reference in the app, on the website and
 * on the server. Alphabet excludes I and O to avoid misreads.
 */
const REFERENCE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function reportReference(clientReportId: string): string {
  const compact = clientReportId.replace(/[^a-z0-9]/gi, '').toUpperCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < compact.length; i += 1) {
    hash ^= compact.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  let out = '';
  let value = hash;
  for (let i = 0; i < 6; i += 1) {
    out += REFERENCE_ALPHABET[value % REFERENCE_ALPHABET.length];
    value = Math.floor(value / REFERENCE_ALPHABET.length) + (compact.charCodeAt(i % Math.max(1, compact.length)) || 7);
  }
  return `SRK-${out}`;
}

export function deliverySummary(report: IncidentReport): ReportDeliverySummary {
  const copy = REPORT_STATUS_COPY[report.status] ?? REPORT_STATUS_COPY.queued;
  const delivered = Boolean(report.serverAckId) && ['acknowledged', 'synced', 'verified'].includes(report.status);

  const detailParts: string[] = [copy.description];
  if (report.attempts > 0) detailParts.push(`${report.attempts} attempt(s) from this device.`);
  if (report.serverAckId) detailParts.push(`Server acknowledgement ${report.serverAckId.slice(0, 10)}…`);
  if (report.fallbackOpenedAt) detailParts.push('The reporting website was opened with these details.');
  if (report.status === 'failed' && report.lastError) detailParts.push(`Last error: ${report.lastError}`);

  return {
    label: copy.label,
    tone: copy.tone,
    detail: detailParts.join(' '),
    delivered,
  };
}

/**
 * Redaction used before anything is shown to other people. Identity is stripped
 * by field, not by trust: emails, phone numbers and long digit runs.
 */
export function redactForCommunity(text: string): string {
  return text
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g, '[email hidden]')
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, '[number hidden]')
    .replace(/\bhttps?:\/\/\S+/g, '[link hidden]')
    .replace(/\s+/g, ' ')
    .trim();
}

export const REPORT_SOURCE_LABEL: Record<'pwa' | 'website' | 'sms', string> = {
  pwa: 'SURAKSHA app',
  website: 'Reporting website',
  sms: 'SMS handoff',
};
