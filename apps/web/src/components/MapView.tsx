import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import type { GeoPoint, RouteInfo } from '@suraksha/shared';
import { appEnv } from '@/lib/env';
import { tileUrl } from '@/services/tiles';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';

/**
 * The map.
 *
 * Leaflet is used directly rather than through react-leaflet so that this
 * component can own two things a safety context needs:
 *  - **honest degradation**: when tiles cannot load (offline, blocked host), the
 *    map keeps drawing the route, checkpoints and position on a plain canvas and
 *    says "map imagery unavailable offline" instead of showing an empty grey box;
 *  - **custom DOM markers**: no image assets, so markers always render offline.
 */

export interface MapMarkerSpec {
  id: string;
  point: GeoPoint;
  label: string;
  kind: 'origin' | 'destination' | 'checkpoint' | 'checkpoint-reached' | 'checkpoint-missed' | 'user' | 'sos';
}

export interface MapViewProps {
  markers?: MapMarkerSpec[];
  track?: GeoPoint[];
  route?: RouteInfo;
  className?: string;
  /** Renders a warm tone and a notice when the route is only approximate. */
  approximate?: boolean;
  onMarkerClick?: (id: string) => void;
}

export function MapView({ markers = [], track = [], route, className, approximate, onMarkerClick }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const [tileFailure, setTileFailure] = useState(false);
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [zoom, setZoom] = useState(14);

  const allPoints = useMemo(
    () => [...(route?.geometry ?? []), ...track, ...markers.map((marker) => marker.point)],
    [route?.geometry, track, markers],
  );

  // Create the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      preferCanvas: true,
      center: allPoints[0] ? [allPoints[0].lat, allPoints[0].lng] : [20.5937, 78.9629],
      zoom: 13,
      zoomSnap: 0.5,
    });

    const layer = L.layerGroup().addTo(map);
    layerRef.current = layer;
    mapRef.current = map;

    map.on('zoomend', () => setZoom(map.getZoom()));

    setTimeout(() => map.invalidateSize(), 120);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Maintain tiles (re-created when the theme changes so dark mode styling applies).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;

    const tiles = L.tileLayer(appEnv.tileUrlTemplate, {
      attribution: appEnv.tileAttribution,
      maxZoom: 19,
      crossOrigin: true,
      errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    });

    let failures = 0;
    tiles.on('tileerror', () => {
      failures += 1;
      if (failures > 3) setTileFailure(true);
    });
    tiles.on('load', () => {
      setTilesLoaded(true);
      setTileFailure(false);
    });

    tiles.addTo(map);
    return () => {
      tiles.remove();
    };
  }, []);

  // Redraw overlays whenever the data or zoom changes.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();

    const routePoints = route?.geometry ?? [];
    if (routePoints.length > 1) {
      L.polyline(
        routePoints.map((point) => [point.lat, point.lng]),
        {
          color: route?.approximate ? '#f59e0b' : '#0d9488',
          weight: 4,
          opacity: 0.85,
          dashArray: route?.approximate ? '6 8' : undefined,
        },
      ).addTo(layer);
    }

    if (track.length > 1) {
      L.polyline(
        track.map((point) => [point.lat, point.lng]),
        { color: '#38bdf8', weight: 3, opacity: 0.9 },
      ).addTo(layer);
    }

    for (const marker of markers) {
      const html = `<span class="suraksha-marker suraksha-marker--${marker.kind === 'user' ? 'sos' : marker.kind}" aria-hidden="true"></span>`;
      const icon = L.divIcon({
        html,
        className: 'suraksha-divicon',
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });

      const leafletMarker = L.marker([marker.point.lat, marker.point.lng], {
        icon,
        title: marker.label,
        keyboard: Boolean(onMarkerClick),
      }).addTo(layer);

      leafletMarker.bindTooltip(marker.label, { direction: 'top', offset: [0, -8] });
      if (onMarkerClick) leafletMarker.on('click', () => onMarkerClick(marker.id));
    }

    // Fit the view to everything we know about.
    const focus = [
      ...routePoints,
      ...track,
      ...markers.map((marker) => marker.point),
    ].filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));

    if (focus.length === 1) {
      map.setView([focus[0].lat, focus[0].lng], Math.max(map.getZoom(), 15));
    } else if (focus.length > 1) {
      const bounds = L.latLngBounds(focus.map((point) => [point.lat, point.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.geometry, route?.approximate, track, markers, zoom]);

  const offline = !navigator.onLine;

  return (
    <div className={cn('relative overflow-hidden rounded-2xl border border-border', className)}>
      <div ref={containerRef} className="h-56 w-full sm:h-72" role="img" aria-label="Journey map" />

      {tileFailure || (offline && !tilesLoaded) ? (
        <div className="pointer-events-none absolute left-2 top-2 max-w-[85%]">
          <Badge variant="warning" className="shadow">
            Map imagery unavailable — route and positions still shown
          </Badge>
        </div>
      ) : null}

      {approximate ? (
        <div className="pointer-events-none absolute bottom-8 left-2 max-w-[85%]">
          <Badge variant="warning" className="shadow">
            Approximate straight-line corridor
          </Badge>
        </div>
      ) : null}

      {tileFailure ? (
        <div className="absolute inset-x-2 bottom-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
          <p className="text-[10px] leading-snug text-amber-900 dark:text-amber-100">
            Tiles could not be loaded. If you are offline, this is expected — the map corridor you downloaded
            earlier is used where available, and positions keep being recorded on the device.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function mapMarkersForJourney(input: {
  origin: GeoPoint;
  destination: GeoPoint;
  originLabel: string;
  destinationLabel: string;
  checkpoints?: Array<{ id: string; label: string; location: GeoPoint; status: string }>;
  userLocation?: GeoPoint;
  sos?: boolean;
}): MapMarkerSpec[] {
  const markers: MapMarkerSpec[] = [
    { id: 'origin', point: input.origin, label: `Start: ${input.originLabel}`, kind: 'origin' },
    { id: 'destination', point: input.destination, label: `Destination: ${input.destinationLabel}`, kind: 'destination' },
  ];

  for (const checkpoint of input.checkpoints ?? []) {
    const kind =
      checkpoint.status === 'reached'
        ? 'checkpoint-reached'
        : checkpoint.status === 'missed'
          ? 'checkpoint-missed'
          : 'checkpoint';
    markers.push({ id: checkpoint.id, point: checkpoint.location, label: checkpoint.label, kind });
  }

  if (input.userLocation) {
    markers.push({
      id: 'user',
      point: input.userLocation,
      label: input.sos ? 'SOS location' : 'Your last known position',
      kind: input.sos ? 'sos' : 'user',
    });
  }

  return markers;
}

export { tileUrl };
