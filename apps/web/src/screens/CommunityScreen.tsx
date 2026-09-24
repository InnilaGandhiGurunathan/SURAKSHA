import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Filter, MapPin, ShieldCheck, Users, WifiOff } from 'lucide-react';
import type { Journey, ReportCategory, UserProfile } from '@suraksha/shared';
import { REPORT_CATEGORIES, haversineMeters } from '@suraksha/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Disclaimer, EmptyState, InfoNote, SectionHeader, StatusTile } from '@/components/StatusPieces';
import { MapView } from '@/components/MapView';
import { ReportStatusBadge } from '@/components/ReportStatus';
import { useLocation } from '@/hooks/useLocation';
import { db } from '@/lib/db';
import { DISCLAIMERS } from '@/lib/constants';
import { formatDateTime, formatDistance, formatRelative } from '@/lib/format';
import { publishableReports } from '@/services/reports';
import { listJourneys } from '@/services/journeys';
import { apiFetch } from '@/services/api';
import { useOnline } from '@/hooks/useConnectivity';
import { cn } from '@/lib/utils';

/**
 * Community safety.
 *
 * Only reports a responder has **verified** appear here, identity is stripped at
 * the source (no reporter name, no contact details, redacted free text), and
 * community items are never used to score anyone's risk. The point is context —
 * "others flagged this area" — not surveillance.
 */
interface FeedItem {
  id: string;
  category: ReportCategory | string;
  severity: string;
  title: string;
  summary: string;
  locationLabel?: string;
  location?: { lat: number; lng: number };
  occurredAt: string;
  reference: string;
  verification: string;
  source: 'local' | 'server';
}

const RADIUS_OPTIONS = [
  { value: '0', label: 'Anywhere' },
  { value: '2000', label: 'Within 2 km' },
  { value: '5000', label: 'Within 5 km' },
  { value: '15000', label: 'Within 15 km' },
  { value: '50000', label: 'Within 50 km' },
];

export function CommunityScreen({ user }: { user: UserProfile }) {
  const { usable } = useOnline();
  const location = useLocation({ watch: false });

  const [category, setCategory] = useState<string>('all');
  const [radius, setRadius] = useState('15000');
  const [tab, setTab] = useState<'feed' | 'map'>('feed');
  const [remote, setRemote] = useState<FeedItem[] | undefined>();
  const [remoteMessage, setRemoteMessage] = useState<string | undefined>();

  const local = useLiveQuery(async () => publishableReports(), [], [] as FeedItem[]);
  const journeys = useLiveQuery(async () => listJourneys(user.id), [user.id], [] as Journey[]);

  const items = useMemo(() => {
    const base: FeedItem[] = [
      ...(local ?? []).map((item) => ({ ...item, source: 'local' as const, verification: 'verified' })),
      ...(remote ?? []),
    ];

    const deduped = new Map<string, FeedItem>();
    for (const item of base) deduped.set(item.title + item.occurredAt, item);

    const centre = location.point;
    const radiusMeters = Number(radius);

    return [...deduped.values()]
      .filter((item) => (category === 'all' ? true : item.category === category))
      .filter((item) => {
        if (!centre || radiusMeters === 0 || !item.location) return true;
        return haversineMeters(centre, item.location) <= radiusMeters;
      })
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }, [local, remote, category, radius, location.point]);

  const loadFeed = async () => {
    if (!usable) {
      setRemoteMessage('Offline — showing verified reports stored on this device. Server-fetched reports arrive when a connection returns.');
      return;
    }
    try {
      const query = location.point
        ? `?lat=${location.point.lat}&lng=${location.point.lng}&radiusKm=${Math.round(Number(radius) / 1000)}`
        : '';
      const data = await apiFetch<{ items: Array<Omit<FeedItem, 'source'>>; fetchedAt: string }>(
        `/community/feed${query}`,
        { timeoutMs: 10_000 },
      );
      setRemote(data.items.map((item) => ({ ...item, source: 'server' as const })));
      setRemoteMessage(`Fetched ${data.items.length} verified report(s) from the reporting server at ${formatRelative(data.fetchedAt)}.`);
    } catch (error) {
      setRemoteMessage(
        `Could not reach the reporting server, so only device-local verified reports are shown. ${
          (error as Error).message
        }`,
      );
    }
  };

  const activeJourney = journeys?.find((journey) => journey.status === 'active');
  const nearbyCount = items.filter((item) => item.location && location.point && haversineMeters(location.point, item.location) <= 5000).length;

  return (
    <div className="space-y-4 pb-6">
      <SectionHeader
        title="Community safety"
        description="Verified reports from responders, with no reporter identities."
        action={
          <Button size="sm" variant="outline" onClick={() => void loadFeed()}>
            Refresh
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatusTile label="Verified reports" value={String(items.length)} hint="Filtered by your choices" />
        <StatusTile label="Nearby (5 km)" value={String(nearbyCount)} tone={nearbyCount ? 'warn' : 'ok'} hint="Verified incidents" />
        <StatusTile
          label="Your position"
          value={location.quality === 'none' ? 'unknown' : location.quality}
          hint={location.point ? `${location.point.lat.toFixed(3)}, ${location.point.lng.toFixed(3)}` : 'no GPS fix'}
        />
        <StatusTile
          label="Source"
          value={usable ? 'device + server' : 'device only'}
          tone={usable ? 'ok' : 'warn'}
          hint="Server items need a connection"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Filter className="size-4 text-teal-500" aria-hidden />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs font-medium">Category</span>
            <Select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              options={[{ value: 'all', label: 'All categories' }, ...REPORT_CATEGORIES.map((item) => ({ value: item.value, label: item.label }))]}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium">Distance from you</span>
            <Select value={radius} onChange={(event) => setRadius(event.target.value)} options={RADIUS_OPTIONS} />
          </label>
        </CardContent>
      </Card>

      {activeJourney ? (
        <InfoNote tone="info" title={`Route context: ${activeJourney.title}`}>
          <p>
            {activeJourney.originLabel} → {activeJourney.destinationLabel}. Community reports near this corridor are
            worth reading before you set off — they are historical context, not a live risk assessment.
          </p>
        </InfoNote>
      ) : null}

      {remoteMessage ? (
        <InfoNote tone={remoteMessage.startsWith('Could not') || remoteMessage.startsWith('Offline') ? 'warning' : 'muted'}>
          <p>{remoteMessage}</p>
        </InfoNote>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList>
          <TabsTrigger value="feed">Feed ({items.length})</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
        </TabsList>

        <TabsContent value="feed">
          {items.length === 0 ? (
            <EmptyState
              icon={<Users className="size-5" />}
              title="No verified reports yet"
              description="Reports appear here only after a responder verifies them and marks them community-visible. Nothing pending is published."
            />
          ) : (
            <ul className="space-y-2.5">
              {items.map((item) => (
                <li key={item.id}>
                  <Card className="border-border/70">
                    <CardContent className="space-y-2 pt-5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{item.title}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {REPORT_CATEGORIES.find((entry) => entry.value === item.category)?.label ?? item.category} ·{' '}
                            {item.severity} · occurred {formatDateTime(item.occurredAt)}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge variant="success">
                            <ShieldCheck aria-hidden />
                            verified
                          </Badge>
                          <Badge variant="muted">{item.source === 'server' ? 'server' : 'this device'}</Badge>
                        </div>
                      </div>

                      <p className="text-[11px] leading-relaxed text-muted-foreground">{item.summary}</p>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                        {item.locationLabel ? <span>{item.locationLabel}</span> : null}
                        {item.location && location.point ? (
                          <span className="flex items-center gap-1">
                            <MapPin className="size-3" aria-hidden />
                            {formatDistance(haversineMeters(location.point, item.location))} away
                          </span>
                        ) : null}
                        <span>reference {item.reference}</span>
                        <span>reporter identity removed</span>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="map">
          {items.filter((item) => item.location).length === 0 ? (
            <EmptyState
              icon={<WifiOff className="size-5" />}
              title="No mapped reports"
              description="Verified reports with a recorded position appear here. Some reports deliberately omit a precise location."
            />
          ) : (
            <MapView
              markers={items
                .filter((item) => item.location)
                .map((item, index) => ({
                  id: `community-${index}`,
                  point: item.location!,
                  label: item.title,
                  kind: item.severity === 'critical' || item.severity === 'high' ? 'checkpoint-missed' : 'checkpoint',
                }))}
              className="border-0"
            />
          )}
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500" aria-hidden />
            How this section is moderated
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            Reports are reviewed by a responder with the <strong>responder</strong> or <strong>admin</strong> role.
            Only verified, community-visible reports are published, always without the reporter’s identity and with
            contact details stripped from the text.
          </p>
          <p>
            Community reports are historical context. SURAKSHA does not use them to compute anyone’s risk score, and
            a quiet area is not a guarantee of safety.
          </p>
          <Disclaimer>{DISCLAIMERS.community}</Disclaimer>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void loadFeed()}>
          Fetch server reports
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setCategory('all')}>
          Clear category filter
        </Button>
      </div>

      <p className={cn('text-[10px] text-muted-foreground', !usable && 'text-amber-600 dark:text-amber-400')}>
        {items.some((item) => item.source === 'local')
          ? 'Some reports shown here were verified on this device while offline and will sync later.'
          : ''}
      </p>
    </div>
  );
}

export default CommunityScreen;
