/**
 * GoogleMapLayer — the live basemap surface.
 *
 * Draws the *same* geometry the simulated SVG draws (expected corridor,
 * travelled trail, deviation branch, demo zone, origin/destination, traveller)
 * on real Google tiles, by projecting the fictional map units through
 * `toLatLng()`. That one projection is what lets both surfaces share a data
 * path.
 *
 * Two deliberate choices:
 *
 *  - Classic `google.maps.Marker`, not `AdvancedMarkerElement`. Advanced
 *    markers require a Map ID, which would turn "add your key" into "add your
 *    key *and* create a Map ID in Cloud Console".
 *  - `gestureHandling: 'cooperative'`, so a one-finger swipe scrolls the page
 *    instead of being eaten by the map — the same reasoning as the SVG
 *    surface's `touch-action` rule.
 */

import { useEffect, useRef } from 'react';
import type { Journey, Point } from '@/domain/types';
import { RISK_ZONE, toLatLng } from '@/domain/geo';
import { MAP_LANDMARKS } from '@/domain/seed';
import type {
  GoogleMapsApi,
  GoogleMapsBounds,
  GoogleMapsLatLng,
  GoogleMapsMarker,
  GoogleMapsPath,
} from '@/services/googleMapsApi';

type GoogleMapsMapInstance = InstanceType<GoogleMapsApi['Map']>;

interface GoogleMapLayerProps {
  api: GoogleMapsApi;
  journey: Journey | null;
  /** Planned route without an active journey (setup preview). */
  previewRoute?: Point[] | null;
  position?: Point | null;
  /** Whole-map zoom level, driven by the shared +/- controls. */
  zoom: number;
  follow: boolean;
  showLabels: boolean;
  /** Increment to ask the camera to fit the journey again. */
  recentreNonce: number;
  /**
   * The map is exposed as a single labelled image, exactly like the SVG
   * surface. Google's own DOM is a wall of unlabelled tiles and buttons, so the
   * text summary has to come from us or the live basemap is a regression.
   */
  ariaLabel?: string;
  className?: string;
}

/** Centre of the fictional map, used before any journey exists. */
const FALLBACK_CENTRE: Point = { x: 500, y: 340 };
const LANDMARK_POINTS = MAP_LANDMARKS.filter((landmark) => landmark.kind === 'poi');

function toLatLngPath(points: Point[]): GoogleMapsLatLng[] {
  return points.map((point) => toLatLng(point));
}

/** Google's dashed-line idiom: a 1px tick repeated along the path. */
const DASH_ICON = { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 4 };

export function GoogleMapLayer({
  api,
  journey,
  previewRoute,
  position,
  zoom,
  follow,
  showLabels,
  recentreNonce,
  ariaLabel,
  className,
}: GoogleMapLayerProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GoogleMapsMapInstance | null>(null);
  const overlaysRef = useRef<OverlayBag | null>(null);

  // Keep the latest props readable from the mount-only effect.
  const latest = useRef({ journey, previewRoute, position, zoom });
  latest.current = { journey, previewRoute, position, zoom };
  /* ------------------------------------------------------------------ *
   * Create the map once per api instance.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const element = hostRef.current;
    if (!element) return;

    const current = latest.current;
    const centre = current.position ?? current.journey?.position ?? current.journey?.route.expected[0] ?? FALLBACK_CENTRE;
    const map = new api.Map(element, {
      center: toLatLng(centre),
      zoom: current.zoom,
      disableDefaultUI: true,
      zoomControl: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
      gestureHandling: 'cooperative',
      backgroundColor: '#EEF1F5',
      isFractionalZoomEnabled: true,
    });

    mapRef.current = map;
    const bag = createOverlays(api, map);
    overlaysRef.current = bag;
    fitToJourney(api, map, current.journey, current.previewRoute);

    return () => {
      destroyOverlays(bag);
      mapRef.current = null;
      overlaysRef.current = null;
      // The Maps API has no `map.destroy()`; clearing the host is what keeps
      // React StrictMode's double-mount from leaving two canvases behind.
      element.replaceChildren();
    };
  }, [api]);

  /* ------------------------------------------------------------------ *
   * Geometry: routes, markers, demo zone.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    const bag = overlaysRef.current;
    if (!bag) return;
    const expected = journey?.route.expected ?? previewRoute ?? null;

    if (expected && expected.length > 1) {
      const path = toLatLngPath(expected);
      const corridorWidth = Math.max(10, ((journey?.route.corridorWidth ?? 34) * 2) / 3.2);
      bag.corridor.setPath(path);
      bag.corridor.setOptions({ strokeWeight: corridorWidth, strokeOpacity: 0.16, visible: true });
      bag.expected.setPath(path);
      bag.expected.setOptions({ visible: true });
    } else {
      bag.corridor.setOptions({ visible: false });
      bag.expected.setOptions({ visible: false });
    }

    const trail = journey && journey.route.travelled.length > 1 ? toLatLngPath(journey.route.travelled) : [];
    bag.trail.setPath(trail);
    bag.trail.setOptions({
      strokeColor: journey?.deviationActive ? '#FB6514' : '#4468F0',
      visible: trail.length > 1,
    });

    const branch =
      journey && journey.deviationCount > 0 && journey.route.deviationBranch.length > 1
        ? toLatLngPath(journey.route.deviationBranch)
        : [];
    bag.branch.setPath(branch);
    bag.branch.setOptions({ visible: branch.length > 1 });

    bag.zone.setPath(toLatLngPath(RISK_ZONE.polygon));

    const origin = expected?.[0] ?? null;
    const destination = expected ? expected[expected.length - 1] : null;
    if (origin) {
      bag.origin.setPosition(toLatLng(origin));
      bag.origin.setOptions({
        title: journey?.originLabel ?? 'Start',
        label: showLabels ? { text: 'A', color: '#FFFFFF', className: LABEL_CLASS } : undefined,
      });
    }
    if (destination) {
      bag.destination.setPosition(toLatLng(destination));
      bag.destination.setOptions({
        title: journey?.destinationLabel ?? 'Destination',
        label: showLabels ? { text: 'B', color: '#FFFFFF', className: LABEL_CLASS } : undefined,
      });
    }

    const markerPoint = position ?? journey?.position ?? null;
    if (markerPoint) {
      bag.traveller.setPosition(toLatLng(markerPoint));
      bag.traveller.setOptions({
        icon: markerIcon(api, journey?.deviationActive ? '#FB6514' : '#4468F0'),
        title: journey?.travellerName ?? 'Traveller',
      });
    }

    for (const [index, marker] of bag.landmarks.entries()) {
      const landmark = LANDMARK_POINTS[index];
      if (!landmark) continue;
      marker.setMap(showLabels ? bag.map : null);
      marker.setPosition(toLatLng(landmark.point));
      marker.setOptions({
        title: landmark.label,
        label: showLabels ? { text: landmark.label, className: LABEL_CLASS } : undefined,
      });
    }
  }, [api, journey, previewRoute, position, showLabels]);

  /* ------------------------------------------------------------------ *
   * Camera: shared +/- controls, follow-cam, recentre, resize.
   * ------------------------------------------------------------------ */
  useEffect(() => {
    mapRef.current?.setZoom(zoom);
  }, [zoom]);

  const followToken = followKey(position, journey);
  useEffect(() => {
    const map = mapRef.current;
    const point = position ?? journey?.position ?? null;
    if (!map || !follow || !point) return;
    map.panTo(toLatLng(point));
  }, [follow, followToken]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || recentreNonce === 0) return;
    fitToJourney(api, map, journey, previewRoute);
  }, [api, recentreNonce, journey, previewRoute]);

  // Tiles repaint against the container, which changes at breakpoints.
  useEffect(() => {
    const element = hostRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => mapRef.current?.resize?.());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={hostRef}
      className={className ?? 'h-full w-full'}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      data-suraksha-live-map="true"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Overlay bag                                                         */
/* ------------------------------------------------------------------ */

const LABEL_CLASS = 'sr-map-label';

interface OverlayBag {
  map: GoogleMapsMapInstance;
  corridor: GoogleMapsPath;
  expected: GoogleMapsPath;
  trail: GoogleMapsPath;
  branch: GoogleMapsPath;
  zone: GoogleMapsPath;
  origin: GoogleMapsMarker;
  destination: GoogleMapsMarker;
  traveller: GoogleMapsMarker;
  landmarks: GoogleMapsMarker[];
}

function createOverlays(api: GoogleMapsApi, map: GoogleMapsMapInstance): OverlayBag {
  const line = (options: Parameters<GoogleMapsPath['setOptions']>[0]) => new api.Polyline({ ...options, map });
  return {
    map,
    corridor: line({ strokeColor: '#12B76A', strokeOpacity: 0.16, strokeWeight: 26, zIndex: 1, clickable: false }),
    expected: line({
      strokeColor: '#039855',
      strokeOpacity: 0,
      strokeWeight: 4,
      zIndex: 2,
      clickable: false,
      icons: [{ icon: DASH_ICON, offset: '0', repeat: '14px' }],
    }),
    branch: line({ strokeColor: '#98A2B3', strokeOpacity: 0.8, strokeWeight: 3, zIndex: 2, clickable: false }),
    trail: line({ strokeColor: '#4468F0', strokeOpacity: 0.95, strokeWeight: 5, zIndex: 3, clickable: false }),
    zone: new api.Polygon({
      map,
      strokeColor: '#FDB022',
      strokeOpacity: 0.9,
      strokeWeight: 2,
      fillColor: '#FDB022',
      fillOpacity: 0.14,
      clickable: false,
      zIndex: 0,
    }),
    origin: new api.Marker({ map, icon: pinIcon('#6B7688'), zIndex: 4, clickable: false }),
    destination: new api.Marker({ map, icon: pinIcon('#111827'), zIndex: 4, clickable: false }),
    traveller: new api.Marker({ map, icon: markerIcon(api, '#4468F0'), zIndex: 6, clickable: false }),
    landmarks: LANDMARK_POINTS.map(
      (landmark) =>
        new api.Marker({
          map,
          position: toLatLng(landmark.point),
          title: landmark.label,
          icon: {
            path: api.SymbolPath.CIRCLE,
            scale: 4,
            fillColor: '#FFFFFF',
            strokeColor: '#98A2B3',
            fillOpacity: 1,
            strokeWeight: 2,
          },
          clickable: false,
          zIndex: 3,
        }),
    ),
  };
}

function destroyOverlays(bag: OverlayBag): void {
  for (const path of [bag.corridor, bag.expected, bag.trail, bag.branch, bag.zone]) path.setMap(null);
  for (const marker of [bag.origin, bag.destination, bag.traveller, ...bag.landmarks]) marker.setMap(null);
}

function markerIcon(api: GoogleMapsApi, colour: string): Record<string, unknown> {
  return {
    path: api.SymbolPath.CIRCLE ?? 'M -7 0 A 7 7 0 1 0 7 0 A 7 7 0 1 0 -7 0 Z',
    scale: 9,
    fillColor: colour,
    fillOpacity: 1,
    strokeColor: '#FFFFFF',
    strokeWeight: 3,
  };
}

function pinIcon(colour: string): Record<string, unknown> {
  return {
    path: 'M0,0 C-4,-6 -8,-9 -8,-13 A8 8 0 1 1 8,-13 C8,-9 4,-6 0,0 Z',
    fillColor: colour,
    fillOpacity: 1,
    strokeColor: '#FFFFFF',
    strokeWeight: 2,
    anchor: { x: 0, y: 0 },
    labelOrigin: { x: 0, y: -13 },
  };
}

/** Quantised like the SVG follow-cam, so the camera is not retargeted per metre. */
function followKey(position: Point | null | undefined, journey: Journey | null): number {
  const point = position ?? journey?.position ?? null;
  if (!point) return 0;
  return Math.round(point.x / 12) * 1000 + Math.round(point.y / 12);
}

function fitToJourney(
  api: GoogleMapsApi,
  map: GoogleMapsMapInstance,
  journey: Journey | null,
  previewRoute: Point[] | null | undefined,
): void {
  const points = journey?.route.expected ?? previewRoute ?? [];
  if (points.length === 0) return;
  const bounds: GoogleMapsBounds = new api.LatLngBounds();
  for (const point of points) bounds.extend(toLatLng(point));
  if (journey?.position) bounds.extend(toLatLng(journey.position));
  map.fitBounds(bounds, { top: 56, bottom: 56, left: 32, right: 32 });
}
