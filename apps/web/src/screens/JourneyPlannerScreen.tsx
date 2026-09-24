import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Cloud,
  Crosshair,
  Download,
  MapPin,
  Plus,
  Route,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import type { GeoPoint, JourneyCheckpoint, RouteInfo, TransportMode, TrustedContact, UserProfile } from '@suraksha/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input, Select } from '@/components/ui/field';
import { Progress, Switch } from '@/components/ui/misc';
import { InfoNote, SectionHeader, Disclaimer } from '@/components/StatusPieces';
import { MapView, mapMarkersForJourney } from '@/components/MapView';
import { useLocation } from '@/hooks/useLocation';
import { useOnline } from '@/hooks/useConnectivity';
import { DEFAULT_SAFETY_RULES, DISCLAIMERS } from '@/lib/constants';
import { formatDistance, formatDuration } from '@/lib/format';
import { fromDateTimeInputValue, toDateTimeInputValue } from '@/lib/time';
import { formatCoordinates } from '@suraksha/shared';
import { listContacts } from '@/services/contacts';
import { createJourney, makeCheckpoint, startJourney } from '@/services/journeys';
import { reverseGeocode, generateCheckpoints, planRoute, parseCoordinateInput, routeNote, transportLabel } from '@/services/routing';
import { downloadOfflineBundle } from '@/services/offline';
import { offlineTileNote } from '@/services/tiles';
import { setMonitoringPreference, startMonitoring } from '@/services/monitor';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * Journey planner.
 *
 * Everything here works offline except place search and road routing, and both
 * degrade explicitly:
 *  - with no network the user types coordinates or taps "use my location" and
 *    the journey is created with a straight-line corridor labelled approximate;
 *  - the offline corridor download is optional, quantifies what it stored, and
 *    never blocks saving the journey.
 */
export function JourneyPlannerScreen({ user }: { user: UserProfile }) {
  const navigate = useNavigate();
  const location = useLocation({ watch: false });
  const { usable } = useOnline();

  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<TransportMode>('drive');
  const [originLabel, setOriginLabel] = useState('');
  const [origin, setOrigin] = useState<GeoPoint | undefined>();
  const [destinationLabel, setDestinationLabel] = useState('');
  const [destination, setDestination] = useState<GeoPoint | undefined>();
  const [departAt, setDepartAt] = useState(toDateTimeInputValue(new Date(Date.now() + 30 * 60_000)));
  const [checkpointCount, setCheckpointCount] = useState(3);
  const [windowMinutes, setWindowMinutes] = useState(DEFAULT_SAFETY_RULES.checkInGraceMinutes);
  const [checkpoints, setCheckpoints] = useState<JourneyCheckpoint[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<{ id: string; detail: string; status: string }[]>([]);

  const [route, setRoute] = useState<RouteInfo | undefined>();
  const [routeNote_, setRouteNote] = useState<string | undefined>();
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState<'origin' | 'destination' | undefined>();
  const [results, setResults] = useState<Array<{ label: string; point: GeoPoint }>>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | undefined>();

  const contacts = useLiveQuery(async () => listContacts(user.id), [user.id], [] as TrustedContact[]);

  // Preselect the user's default contacts for a new journey.
  useEffect(() => {
    if ((contacts ?? []).length > 0 && selectedContacts.length === 0) {
      setSelectedContacts(
        (contacts ?? []).filter((contact) => contact.canReceiveAlerts).map((contact) => contact.id),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts?.length]);

  // Fetch the route whenever both ends are known.
  useEffect(() => {
    if (!origin || !destination) return;
    let cancelled = false;
    setRouting(true);
    void planRoute({ origin, destination, mode })
      .then((result) => {
        if (cancelled) return;
        setRoute(result.route);
        setRouteNote(result.note);
      })
      .finally(() => !cancelled && setRouting(false));
    return () => {
      cancelled = true;
    };
  }, [origin?.lat, origin?.lng, destination?.lat, destination?.lng, mode]);

  // Rebuild the suggested checkpoints whenever the route or the count changes.
  useEffect(() => {
    if (!route) return;
    const generated = generateCheckpoints({
      route: route.geometry,
      durationMinutes: route.durationMinutes,
      count: checkpointCount,
    });
    setCheckpoints(
      generated.map((item) =>
        makeCheckpoint({
          label: item.label,
          location: item.point,
          expectedOffsetMinutes: item.offsetMinutes,
          windowMinutes,
        }),
      ),
    );
  }, [route?.fetchedAt, checkpointCount, windowMinutes]);

  const markers = useMemo(
    () =>
      mapMarkersForJourney({
        origin: origin ?? location.point ?? { lat: 20.5937, lng: 78.9627 },
        destination: destination ?? origin ?? location.point ?? { lat: 20.5937, lng: 78.9627 },
        originLabel: originLabel || 'Start',
        destinationLabel: destinationLabel || 'Destination',
        checkpoints,
        userLocation: location.point,
      }),
    [origin, destination, originLabel, destinationLabel, checkpoints, location.point],
  );

  const runSearch = async (term: string, field: 'origin' | 'destination') => {
    setSearching(true);
    setSearchError(undefined);
    try {
      const { geocode } = await import('@/services/routing');
      const found = await geocode(term);
      setResults(found);
      if (found.length === 0) setSearchError('No places matched. Try a landmark, a street name, or coordinates.');
    } catch (caught) {
      setResults([]);
      setSearchError((caught as Error).message);
    } finally {
      setSearching(false);
      setSearch(field);
    }
  };

  const pickResult = (result: { label: string; point: GeoPoint }, field: 'origin' | 'destination') => {
    if (field === 'origin') {
      setOrigin(result.point);
      setOriginLabel(result.label.split(',').slice(0, 2).join(','));
    } else {
      setDestination(result.point);
      setDestinationLabel(result.label.split(',').slice(0, 2).join(','));
    }
    setResults([]);
    setSearch(undefined);
  };

  const useMyLocationFor = async (field: 'origin' | 'destination') => {
    if (!location.point) {
      setSearchError('No position available yet. You can type coordinates instead.');
      return;
    }
    const label = (await reverseGeocode(location.point)) ?? 'My current location';
    if (field === 'origin') {
      setOrigin(location.point);
      setOriginLabel(label.split(',').slice(0, 2).join(',') || 'My current location');
    } else {
      setDestination(location.point);
      setDestinationLabel(label.split(',').slice(0, 2).join(',') || 'My current location');
    }
  };

  const applyCoordinates = (field: 'origin' | 'destination', value: string) => {
    const parsed = parseCoordinateInput(value);
    if (!parsed) {
      setSearchError('That does not look like coordinates. Use “latitude, longitude”, for example 28.6139, 77.2090.');
      return;
    }
    setSearchError(undefined);
    if (field === 'origin') {
      setOrigin(parsed.point);
      setOriginLabel(parsed.label);
    } else {
      setDestination(parsed.point);
      setDestinationLabel(parsed.label);
    }
  };

  const download = async (journeyId: string, label: string) => {
    if (!origin || !destination) return undefined;
    setDownloading(true);
    setDownloadProgress([]);
    try {
      const result = await downloadOfflineBundle({
        ownerId: user.id,
        journeyId,
        label,
        origin,
        destination,
        paddingPoints: checkpoints.map((checkpoint) => checkpoint.location),
        onStep: (step) =>
          setDownloadProgress((prev) => [...prev.filter((entry) => entry.id !== step.id), step]),
      });
      return result;
    } finally {
      setDownloading(false);
    }
  };

  const save = async (alsoStart: boolean, alsoDownload: boolean) => {
    setError(undefined);
    if (!origin || !destination) {
      setError('Set both a start point and a destination. You can search, use your location, or type coordinates — offline included.');
      return;
    }
    if (originLabel.trim().length < 2 || destinationLabel.trim().length < 2) {
      setError('Give the start and destination short, recognisable names — you will read them in a hurry.');
      return;
    }

    setSaving(true);
    try {
      const journey = await createJourney({
        owner: user,
        title: title.trim() || `${originLabel} → ${destinationLabel}`,
        originLabel: originLabel.trim(),
        origin,
        destinationLabel: destinationLabel.trim(),
        destination,
        scheduledStartAt: fromDateTimeInputValue(departAt),
        transportMode: mode,
        checkpoints,
        guardianContactIds: selectedContacts,
        route,
        notes: undefined,
      });

      if (alsoDownload) {
        const result = await download(journey.id, journey.title);
        toast.message(
          result?.ok
            ? 'Journey saved and the map corridor is stored offline.'
            : 'Journey saved. The offline map corridor is only partly downloaded — see the journey screen.',
        );
      } else {
        toast.success('Journey saved on this device.');
      }

      if (alsoStart) {
        await startJourney(journey.id);
        await setMonitoringPreference(user.id, true);
        await startMonitoring(user.id);
        toast.success('Monitoring started on this device.');
      }

      navigate(`/app/journeys/${journey.id}`, { replace: true });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 pb-6">
      <SectionHeader title="Plan a journey" description="Everything except place search works with no connection." />

      <FormError message={error} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Route className="size-4 text-teal-500" aria-hidden />
            Route
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Journey name (optional)" htmlFor="plan-title" hint="Defaults to “start → destination”.">
            <Input
              id="plan-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Evening train home"
            />
          </Field>

          <PlaceField
            id="plan-origin"
            label="Start"
            value={originLabel}
            point={origin}
            onLabelChange={setOriginLabel}
            onSearch={(term) => void runSearch(term, 'origin')}
            onUseLocation={() => void useMyLocationFor('origin')}
            onCoordinates={(value) => applyCoordinates('origin', value)}
            searching={searching && search === 'origin'}
            hasGps={Boolean(location.point)}
            results={search === 'origin' ? results : []}
            onPick={(result) => pickResult(result, 'origin')}
          />

          <PlaceField
            id="plan-destination"
            label="Destination"
            value={destinationLabel}
            point={destination}
            onLabelChange={setDestinationLabel}
            onSearch={(term) => void runSearch(term, 'destination')}
            onUseLocation={() => void useMyLocationFor('destination')}
            onCoordinates={(value) => applyCoordinates('destination', value)}
            searching={searching && search === 'destination'}
            hasGps={Boolean(location.point)}
            results={search === 'destination' ? results : []}
            onPick={(result) => pickResult(result, 'destination')}
          />

          {searchError ? <FormError message={searchError} /> : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Departure" htmlFor="plan-depart" required>
              <Input
                id="plan-depart"
                type="datetime-local"
                value={departAt}
                onChange={(event) => setDepartAt(event.target.value)}
              />
            </Field>
            <Field label="Getting there by" htmlFor="plan-mode" required>
              <Select
                id="plan-mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as TransportMode)}
                options={[
                  { value: 'walk', label: transportLabel('walk') },
                  { value: 'cycle', label: transportLabel('cycle') },
                  { value: 'drive', label: transportLabel('drive') },
                  { value: 'transit', label: transportLabel('transit') },
                  { value: 'other', label: transportLabel('other') },
                ]}
              />
            </Field>
            <Field label="Corridor width (m)" htmlFor="plan-corridor" hint="Deviations beyond this count as off-route.">
              <Input id="plan-corridor" value={DEFAULT_SAFETY_RULES.deviationThresholdMeters} readOnly />
            </Field>
          </div>

          {routing ? (
            <p className="text-[11px] text-muted-foreground">Fetching a route{usable ? '' : ' — you are offline, so a straight-line corridor will be used'}…</p>
          ) : routeNote_ ? (
            <InfoNote tone={route?.approximate ? 'warning' : 'info'} title={route?.approximate ? 'Approximate route' : 'Route ready'}>
              <p>{routeNote_}</p>
              {route ? (
                <p className="mt-1">
                  {formatDistance(route.distanceMeters)} · about {formatDuration(route.durationMinutes)} ·{' '}
                  ETA {new Date(Date.now() + route.durationMinutes * 60_000).toLocaleTimeString()}
                </p>
              ) : null}
            </InfoNote>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <MapPin className="size-4 text-teal-500" aria-hidden />
            Checkpoints
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="How many" htmlFor="plan-count">
              <Input
                id="plan-count"
                type="number"
                min={0}
                max={6}
                value={checkpointCount}
                onChange={(event) => setCheckpointCount(Number(event.target.value))}
              />
            </Field>
            <Field label="Grace window (minutes)" htmlFor="plan-window" hint="How long past the expected time before it counts as missed.">
              <Input
                id="plan-window"
                type="number"
                min={2}
                max={60}
                value={windowMinutes}
                onChange={(event) => setWindowMinutes(Number(event.target.value))}
              />
            </Field>
            <div className="flex items-end">
              <Button
                variant="outline"
                full
                onClick={() => {
                  if (!route) {
                    toast.message('Set both ends first — checkpoints are spread along the route.');
                    return;
                  }
                  setCheckpoints((prev) => [
                    ...prev,
                    makeCheckpoint({
                      label: `Checkpoint ${prev.length + 1}`,
                      location: destination ?? route.geometry[Math.floor(route.geometry.length / 2)],
                      expectedOffsetMinutes: Math.round(route.durationMinutes * 0.75),
                      windowMinutes,
                    }),
                  ]);
                }}
              >
                <Plus className="size-4" />
                Add checkpoint
              </Button>
            </div>
          </div>

          {checkpoints.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No checkpoints yet. Checkpoints are what make timing meaningful: SURAKSHA compares your progress
              against them, and a missed one raises the heuristic score by{' '}
              {DEFAULT_SAFETY_RULES.missedCheckpointWeight} points — never an alert on its own.
            </p>
          ) : (
            <ul className="space-y-2">
              {checkpoints.map((checkpoint, index) => (
                <li key={checkpoint.id} className="rounded-xl border border-border bg-card/60 p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-1.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <Input
                        aria-label={`Checkpoint ${index + 1} name`}
                        value={checkpoint.label}
                        onChange={(event) =>
                          setCheckpoints((prev) =>
                            prev.map((item) => (item.id === checkpoint.id ? { ...item, label: event.target.value } : item)),
                          )
                        }
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          Expected after
                          <Input
                            type="number"
                            min={1}
                            className="h-8 w-20 px-2 py-0 text-xs"
                            value={checkpoint.expectedOffsetMinutes}
                            onChange={(event) =>
                              setCheckpoints((prev) =>
                                prev.map((item) =>
                                  item.id === checkpoint.id
                                    ? { ...item, expectedOffsetMinutes: Number(event.target.value) }
                                    : item,
                                ),
                              )
                            }
                          />
                          min
                        </label>
                        <span className="text-[11px] text-muted-foreground">
                          {formatCoordinates(checkpoint.location, 4)}
                        </span>
                      </div>
                    </div>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove checkpoint ${index + 1}`}
                      onClick={() => setCheckpoints((prev) => prev.filter((item) => item.id !== checkpoint.id))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4 text-teal-500" aria-hidden />
            Who should be told
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(contacts ?? []).length === 0 ? (
            <InfoNote tone="warning" title="No contacts yet">
              <p>
                You can still plan and monitor this journey, but escalation has nobody to notify.{' '}
                <a className="underline" href="/app/contacts">
                  Add a trusted contact
                </a>
                .
              </p>
            </InfoNote>
          ) : (
            <ul className="space-y-2">
              {(contacts ?? []).map((contact) => {
                const selected = selectedContacts.includes(contact.id);
                return (
                  <li key={contact.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setSelectedContacts((prev) =>
                          prev.includes(contact.id) ? prev.filter((id) => id !== contact.id) : [...prev, contact.id],
                        )
                      }
                      className={cn(
                        'flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                        selected ? 'border-accent bg-accent/10' : 'border-border hover:bg-muted/40',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border',
                          selected ? 'border-accent bg-accent text-accent-foreground' : 'border-border',
                        )}
                        aria-hidden
                      >
                        {selected ? <Check className="size-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-semibold">
                          {contact.name} · {contact.relationship}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-muted-foreground">
                          {contact.phone} · {contact.canReceiveAlerts ? 'can receive alerts' : 'alerts disabled'} ·{' '}
                          {contact.canSeeLiveLocation ? 'will see live location' : 'no live location'}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <Disclaimer>{DISCLAIMERS.shareDisclaimer}</Disclaimer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Cloud className="size-4 text-teal-500" aria-hidden />
            Offline map corridor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Downloads the tiles around your route (zooms 11–16, roughly 3.5 km each side) so the map works with
            no signal. The journey itself never waits for this.
          </p>
          <Button
            variant="outline"
            disabled={!origin || !destination || downloading}
            onClick={async () => {
              if (!origin || !destination) return;
              // Save first so the pack can be attached to a real journey.
              await save(false, true);
            }}
            loading={downloading}
          >
            <Download className="size-4" />
            Download now
          </Button>

          {downloadProgress.length > 0 ? (
            <ul className="space-y-1.5">
              {downloadProgress.map((entry) => (
                <li key={entry.id} className="flex items-start gap-2 text-[11px]">
                  <span
                    className={cn(
                      'mt-1 size-2 shrink-0 rounded-full',
                      entry.status === 'done' ? 'bg-emerald-500' : entry.status === 'failed' ? 'bg-amber-500' : 'bg-sky-500 animate-pulse',
                    )}
                    aria-hidden
                  />
                  <span>
                    <strong>{entry.id}:</strong> {entry.detail}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <Disclaimer>{offlineTileNote()}</Disclaimer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <MapView
            markers={markers}
            track={location.point ? [location.point] : []}
            route={route}
            approximate={route?.approximate}
            className="border-0"
          />
          {!route?.geometry.length ? (
            <p className="text-[11px] text-muted-foreground">
              Set both ends to see the corridor. Without a route, tracking still records your positions and shows
              them on the map.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <Button variant="accent" size="lg" full loading={saving} onClick={() => void save(false, false)}>
          <Check className="size-4" />
          Save journey
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={saving} onClick={() => void save(true, false)}>
            <Crosshair className="size-4" />
            Save &amp; start
          </Button>
          <Button variant="outline" disabled={saving || !origin || !destination} onClick={() => void save(false, true)}>
            <Download className="size-4" />
            Save &amp; download
          </Button>
        </div>
      </div>

      <InfoNote tone="warning" title="What monitoring can and cannot do">
        <p>{DISCLAIMERS.monitoring}</p>
        <p className="mt-1">{DISCLAIMERS.noRescueGuarantee}</p>
      </InfoNote>

      {routing ? <Progress value={60} className="opacity-60" /> : null}
    </div>
  );
}

function PlaceField({
  id,
  label,
  value,
  point,
  onLabelChange,
  onSearch,
  onUseLocation,
  onCoordinates,
  searching,
  hasGps,
  results,
  onPick,
}: {
  id: string;
  label: string;
  value: string;
  point?: GeoPoint;
  onLabelChange: (value: string) => void;
  onSearch: (term: string) => void;
  onUseLocation: () => void;
  onCoordinates: (value: string) => void;
  searching: boolean;
  hasGps: boolean;
  results: Array<{ label: string; point: GeoPoint }>;
  onPick: (result: { label: string; point: GeoPoint }) => void;
}) {
  const [coords, setCoords] = useState('');

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card/50 p-3">
      <Field label={label} htmlFor={id} hint={point ? `Coordinates: ${formatCoordinates(point, 4)}` : 'Search, use your location, or type coordinates.'}>
        <div className="flex gap-2">
          <Input
            id={id}
            value={value}
            onChange={(event) => onLabelChange(event.target.value)}
            placeholder={label === 'Start' ? 'Where you are leaving from' : 'Where you are going'}
          />
          <Button type="button" variant="outline" size="icon" aria-label="Search for place" loading={searching} onClick={() => onSearch(value)}>
            <Search className="size-4" />
          </Button>
        </div>
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onUseLocation} disabled={!hasGps}>
          <Crosshair className="size-3.5" />
          Use my location
        </Button>
        <div className="flex flex-1 items-center gap-2">
          <Input
            aria-label={`${label} coordinates`}
            value={coords}
            onChange={(event) => setCoords(event.target.value)}
            placeholder="28.6139, 77.2090"
            className="h-9 text-xs"
          />
          <Button type="button" size="sm" variant="outline" onClick={() => onCoordinates(coords)}>
            Set
          </Button>
        </div>
      </div>

      {results.length > 0 ? (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {results.map((result) => (
            <li key={`${result.label}-${result.point.lat}`}>
              <button
                type="button"
                onClick={() => onPick(result)}
                className="w-full rounded-lg border border-border bg-background/70 px-2.5 py-2 text-left text-[11px] leading-snug transition-colors hover:bg-muted/60"
              >
                {result.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!hasGps ? (
        <p className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
          No GPS fix yet, so “use my location” is unavailable. Typing coordinates works offline.
        </p>
      ) : null}
    </div>
  );
}

export default JourneyPlannerScreen;
