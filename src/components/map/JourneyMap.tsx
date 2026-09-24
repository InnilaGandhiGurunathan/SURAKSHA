/**
 * JourneyMap — the interactive map surface.
 *
 * Rendered as an SVG so it works offline, stays crisp on every screen and lets
 * us draw the expected corridor, the travelled trail, the simulated traveller
 * marker and the fictional higher-risk zone without any external tile service.
 * It pans/zooms (drag + wheel + keyboard) and is readable by screen readers as
 * a text summary.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Compass, Loader2, LocateFixed, Minus, Plus, TriangleAlert } from 'lucide-react';
import type { Journey, Point } from '@/domain/types';
import { cn } from '@/lib/cn';
import { formatLatLng, MAP_HEIGHT, MAP_WIDTH, polygonCentroid, toSvgPath } from '@/domain/geo';
import { RISK_ZONE } from '@/domain/geo';
import { MAP_LANDMARKS } from '@/domain/seed';
import { formatRelative } from '@/lib/format';
import { useAppState } from '@/store/hooks';

export type MapMode = 'traveller' | 'guardian';

interface JourneyMapProps {
  journey: Journey | null;
  mode?: MapMode;
  /** Force the traveller marker position (used by previews). */
  position?: Point | null;
  className?: string;
  height?: string;
  overlay?: ReactNode;
  loading?: boolean;
  onRecentre?: () => void;
  /** Draw a planned route without an active journey (used on the setup screen). */
  previewRoute?: Point[] | null;
}

const ZOOM_STEPS = [1, 1.35, 1.75, 2.3] as const;

export function JourneyMap({
  journey,
  mode = 'traveller',
  position,
  className,
  height = 'h-[320px] sm:h-[420px]',
  overlay,
  loading,
  onRecentre,
  previewRoute,
}: JourneyMapProps) {
  const [zoomIndex, setZoomIndex] = useState(0);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [follow, setFollow] = useState(true);
  const dragStart = useRef<{ x: number; y: number; offset: Point } | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const uid = useId().replace(/:/g, '');
  const gridId = `grid-${uid}`;
  const shadowId = `marker-shadow-${uid}`;
  const { now } = useAppState();

  const zoom = ZOOM_STEPS[zoomIndex];
  const travellerPoint = position ?? journey?.position ?? null;

  // Reset the camera when a new journey starts (the journey object itself is
  // replaced every tick, so only its id may be a dependency).
  useEffect(() => {
    setZoomIndex(0);
    setOffset({ x: 0, y: 0 });
    setFollow(true);
  }, [journey?.id]);

  // Quantised so the follow-cam does not re-render on every simulated metre.
  const followX = travellerPoint ? Math.round(travellerPoint.x / 6) * 6 : 0;
  const followY = travellerPoint ? Math.round(travellerPoint.y / 6) * 6 : 0;

  // Keep the traveller roughly centred while zoomed in, until the user pans.
  useEffect(() => {
    if (!follow) return;
    if (zoom === 1) {
      setOffset({ x: 0, y: 0 });
      return;
    }
    setOffset({
      x: (MAP_WIDTH / 2 - followX) * (zoom - 1),
      y: (MAP_HEIGHT / 2 - followY) * (zoom - 1),
    });
  }, [follow, followX, followY, zoom]);

  const viewBox = useMemo(() => {
    const w = MAP_WIDTH / zoom;
    const h = MAP_HEIGHT / zoom;
    const cx = MAP_WIDTH / 2 - offset.x / zoom;
    const cy = MAP_HEIGHT / 2 - offset.y / zoom;
    return `${cx - w / 2} ${cy - h / 2} ${w} ${h}`;
  }, [zoom, offset.x, offset.y]);

  const corridorPoints = journey?.route.expected ?? previewRoute ?? null;
  const expectedPath = corridorPoints ? toSvgPath(corridorPoints) : '';
  const trailPath = journey ? toSvgPath(journey.route.travelled) : '';
  const branchPath = journey && journey.deviationCount > 0 ? toSvgPath(journey.route.deviationBranch) : '';
  const zoneCentre = polygonCentroid(RISK_ZONE.polygon);
  const lastUpdate = journey ? formatRelative(journey.lastPositionAt, now) : '';

  const markerColour = journey?.deviationActive ? '#FB6514' : '#4468F0';

  return (
    <div className={cn('relative overflow-hidden rounded-card border border-ink-200 bg-white', height, className)}>
      <svg
        viewBox={viewBox}
        className={cn('h-full w-full touch-none select-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
        role="img"
        aria-label={describeMap(journey)}
        onPointerDown={(event) => {
          if (zoom === 1) return;
          (event.target as Element).setPointerCapture?.(event.pointerId);
          dragStart.current = { x: event.clientX, y: event.clientY, offset };
          setDragging(true);
          setFollow(false);
        }}
        onPointerMove={(event) => {
          if (!dragStart.current) return;
          const dx = event.clientX - dragStart.current.x;
          const dy = event.clientY - dragStart.current.y;
          setOffset({
            x: Math.max(-420, Math.min(420, dragStart.current.offset.x + dx * 1.6)),
            y: Math.max(-300, Math.min(300, dragStart.current.offset.y + dy * 1.6)),
          });
        }}
        onPointerUp={() => {
          dragStart.current = null;
          setDragging(false);
        }}
        onPointerLeave={() => {
          dragStart.current = null;
          setDragging(false);
        }}
        onWheel={(event) => {
          if (Math.abs(event.deltaY) < 8) return;
          setZoomIndex((current) =>
            Math.max(0, Math.min(ZOOM_STEPS.length - 1, current + (event.deltaY > 0 ? -1 : 1))),
          );
        }}
      >
        <defs>
          <pattern id={gridId} width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="#DFE4EC" strokeWidth="1" />
          </pattern>
          <linearGradient id="waterGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#DCE7FF" />
            <stop offset="100%" stopColor="#C7D7FB" />
          </linearGradient>
          <filter id={shadowId} x="-60%" y="-60%" width="220%" height="220%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#111827" floodOpacity="0.22" />
          </filter>
        </defs>

        {/* Base surface */}
        <rect x={-400} y={-400} width={MAP_WIDTH + 800} height={MAP_HEIGHT + 800} fill="#EEF1F5" />
        <rect x={-400} y={-400} width={MAP_WIDTH + 800} height={MAP_HEIGHT + 800} fill={`url(#${gridId})`} opacity={0.55} />

        {/* Park + water shapes for a believable city read */}
        <path
          d="M40 88 C120 60 210 74 268 118 C320 158 300 226 236 250 C160 278 66 252 34 196 Z"
          fill="#E3F2E7"
          stroke="#CFE4D6"
        />
        <path
          d="M620 470 C700 430 820 442 900 494 C960 534 940 610 850 630 C760 650 660 618 622 560 Z"
          fill="url(#waterGradient)"
          stroke="#B9CCF7"
        />

        {/* Roads: a block grid plus the two arterials */}
        {ROADS.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="#FFFFFF" strokeWidth={12} strokeLinecap="round" opacity={0.95} />
        ))}
        {ROADS.map((d, i) => (
          <path key={`edge-${i}`} d={d} fill="none" stroke="#E2E7EF" strokeWidth={14} strokeLinecap="round" opacity={0.6} />
        ))}
        <path
          d="M120 600 C300 560 420 470 560 400 C660 350 760 300 900 210"
          fill="none"
          stroke="#F6D6A8"
          strokeWidth={20}
          strokeLinecap="round"
        />
        <path
          d="M120 600 C300 560 420 470 560 400 C660 350 760 300 900 210"
          fill="none"
          stroke="#FDF2E0"
          strokeWidth={13}
          strokeLinecap="round"
        />

        {/* Higher-risk demo zone */}
        <g opacity={journey?.inRiskZone ? 1 : 0.65}>
          <polygon
            points={RISK_ZONE.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="#FEF0C7"
            stroke="#FDB022"
            strokeWidth={2}
            strokeDasharray="8 6"
          />
          <text x={zoneCentre.x} y={zoneCentre.y - 6} textAnchor="middle" className="fill-watch-800 text-[13px] font-semibold">
            Higher-risk zone
          </text>
          <text x={zoneCentre.x} y={zoneCentre.y + 12} textAnchor="middle" className="fill-watch-700 text-[11px]">
            fictional · demo only
          </text>
        </g>

        {/* Landmarks */}
        {showLabels
          ? MAP_LANDMARKS.filter((l) => l.kind === 'poi').map((landmark) => (
              <g key={landmark.id} transform={`translate(${landmark.point.x}, ${landmark.point.y})`}>
                <circle r={7} fill="#FFFFFF" stroke="#98A2B3" strokeWidth={2} />
                <circle r={2.6} fill="#6B7688" />
                <text y={-13} textAnchor="middle" className="fill-ink-600 text-[11px] font-medium">
                  {landmark.label}
                </text>
              </g>
            ))
          : null}

        {/* Expected corridor + travelled trail */}
        {corridorPoints ? (
          <>
            <path
              d={expectedPath}
              fill="none"
              stroke="#12B76A"
              strokeOpacity={0.16}
              strokeWidth={(journey?.route.corridorWidth ?? 34) * 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={expectedPath}
              fill="none"
              stroke="#039855"
              strokeWidth={4}
              strokeDasharray="10 8"
              strokeLinecap="round"
              className="animate-dash-flow"
            />
            {branchPath ? (
              <path d={branchPath} fill="none" stroke="#C6CDD9" strokeWidth={3} strokeDasharray="4 6" strokeLinecap="round" />
            ) : null}
            {trailPath ? (
              <path
                d={trailPath}
                fill="none"
                stroke={journey?.deviationActive ? '#FB6514' : '#4468F0'}
                strokeWidth={5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
          </>
        ) : null}

        {/* Origin + destination pins */}
        {journey && corridorPoints ? (
          <>
            <Pin
              point={journey.route.expected[0]}
              label={journey.originLabel}
              fill="#FFFFFF"
              stroke="#6B7688"
              textTone="#333D4D"
            />
            <Pin
              point={journey.route.expected[journey.route.expected.length - 1]}
              label={journey.destinationLabel}
              fill="#111827"
              stroke="#111827"
              textTone="#111827"
              icon="flag"
            />
          </>
        ) : null}

        {/* Traveller marker */}
        {travellerPoint ? (
          <g
            transform={`translate(${travellerPoint.x}, ${travellerPoint.y})`}
            filter={`url(#${shadowId})`}
            style={{ transition: 'transform 900ms linear' }}
          >
            <circle r={18} fill={markerColour} opacity={0.18} className="animate-pulse-ring" />
            <circle r={11} fill="#FFFFFF" />
            <circle r={8} fill={markerColour} />
            <path d="M0 -4.5 L3.6 3 L0 1.4 L-3.6 3 Z" fill="#FFFFFF" />
          </g>
        ) : null}
      </svg>

      {/* Controls */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3">
        <div className="pointer-events-auto flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {journey ? (
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border bg-white/95 px-2.5 py-1 text-[11.5px] font-semibold shadow-sm backdrop-blur',
                  journey.deviationActive
                    ? 'border-alert-200 text-alert-700'
                    : journey.inRiskZone
                      ? 'border-watch-200 text-watch-700'
                      : 'border-safe-200 text-safe-700',
                )}
              >
                {journey.deviationActive ? <TriangleAlert size={13} /> : <Compass size={13} />}
                {journey.deviationActive
                  ? 'Off the expected route'
                  : journey.inRiskZone
                    ? 'In a demo risk zone'
                    : 'On the expected route'}
              </span>
            ) : null}
            {journey ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white/95 px-2.5 py-1 text-[11.5px] font-medium text-ink-600 shadow-sm backdrop-blur">
                <LocateFixed size={12} />
                {journey.locationAvailable ? formatLatLng(travellerPoint ?? journey.position) : 'Location unavailable'}
              </span>
            ) : null}
          </div>

          <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-ink-200 bg-white/95 p-1 shadow-sm backdrop-blur">
            <MapButton
              label="Zoom out"
              onClick={() => setZoomIndex((z) => Math.max(0, z - 1))}
              disabled={zoomIndex === 0}
            >
              <Minus size={15} />
            </MapButton>
            <MapButton
              label="Zoom in"
              onClick={() => setZoomIndex((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
              disabled={zoomIndex === ZOOM_STEPS.length - 1}
            >
              <Plus size={15} />
            </MapButton>
            <MapButton
              label={showLabels ? 'Hide labels' : 'Show labels'}
              onClick={() => setShowLabels((v) => !v)}
            >
              <span className="text-[10.5px] font-bold">Aa</span>
            </MapButton>
            <MapButton
              label="Recentre on traveller"
              onClick={() => {
                setFollow(true);
                onRecentre?.();
              }}
            >
              <LocateFixed size={15} />
            </MapButton>
          </div>
        </div>

        {overlay ? <div className="pointer-events-auto">{overlay}</div> : null}
      </div>

      {/* Status strip */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 flex justify-center">
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-xl border border-ink-200 bg-white/95 px-3 py-1.5 text-[11px] font-medium text-ink-600 shadow-sm backdrop-blur">
          <LegendDot colour="#039855" label="Expected route" dashed />
          <LegendDot colour="#4468F0" label="Actual route" />
          {journey?.inRiskZone ? <LegendDot colour="#FDB022" label="Risk zone" dashed /> : null}
          <span className="hidden text-ink-400 sm:inline">Simulated GPS{mode === 'guardian' ? ' · guardian view' : ''}</span>
        </div>
      </div>

      {loading ? (
        <div className="absolute inset-0 grid place-items-center bg-white/70 backdrop-blur-sm">
          <span className="flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3.5 py-2 text-[13px] font-semibold text-ink-600 shadow-card">
            <Loader2 size={15} className="animate-spin" />
            Loading journey…
          </span>
        </div>
      ) : null}

      {!journey && !previewRoute && !loading ? (
        <div className="absolute inset-0 grid place-items-center bg-white/60 backdrop-blur-[1px]">
          <span className="rounded-2xl border border-ink-200 bg-white px-5 py-4 text-center shadow-card">
            <span className="block text-[13.5px] font-semibold text-ink-800">No active journey</span>
            <span className="mt-1 block text-[12px] text-ink-500">
              Location sharing starts when a journey starts.
            </span>
          </span>
        </div>
      ) : null}

      {journey && !journey.locationAvailable ? (
        <div className="absolute inset-x-3 top-16 rounded-xl border border-watch-200 bg-watch-50/95 px-3 py-2 text-[12px] font-semibold text-watch-800 shadow-sm">
          Location unavailable — using last known position ({lastUpdate}).
        </div>
      ) : null}
    </div>
  );
}

function MapButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-8 w-8 place-items-center rounded-lg text-ink-600 transition-state hover:bg-ink-100 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function LegendDot({ colour, label, dashed }: { colour: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden>
        <line
          x1="0"
          y1="3"
          x2="18"
          y2="3"
          stroke={colour}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={dashed ? '4 3' : undefined}
        />
      </svg>
      {label}
    </span>
  );
}

function Pin({
  point,
  label,
  fill,
  stroke,
  textTone,
  icon,
}: {
  point: Point;
  label: string;
  fill: string;
  stroke: string;
  textTone: string;
  icon?: 'flag';
}) {
  return (
    <g transform={`translate(${point.x}, ${point.y})`}>
      <path
        d="M0 0 C-9 -12 -14 -19 -14 -25 A14 14 0 1 1 14 -25 C14 -19 9 -12 0 0 Z"
        fill={fill}
        stroke={stroke}
        strokeWidth={2.5}
      />
      {icon === 'flag' ? <circle r={4} fill="#FFFFFF" cy={-25} /> : <circle r={4.5} fill="#6B7688" cy={-25} />}
      <text y={22} textAnchor="middle" className="text-[12px] font-bold" fill={textTone}>
        {label}
      </text>
    </g>
  );
}

function describeMap(journey: Journey | null): string {
  if (!journey) return 'Map with no active journey.';
  const status = journey.deviationActive
    ? 'The traveller is currently outside the expected route corridor.'
    : 'The traveller is inside the expected route corridor.';
  return `Simulated map of the journey from ${journey.originLabel} to ${journey.destinationLabel}. ${status} Location ${formatLatLng(
    journey.position,
  )}.`;
}

const ROADS = [
  'M0 220 H1000',
  'M0 420 H1000',
  'M180 0 V680',
  'M420 0 V680',
  'M700 0 V680',
  'M860 0 V680',
  'M0 560 H1000',
  'M0 100 H1000',
  'M540 0 V680',
];
