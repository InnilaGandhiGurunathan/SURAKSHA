/**
 * Traveller Home — the "everything looks normal" dashboard.
 * Calm by default; the only loud element is Quick SOS.
 */

import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Clock,
  Compass,
  Info,
  LogIn,
  MapPin,
  PhoneCall,
  Plus,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  EmptyState,
  Stat,
} from '@/components/ui/primitives';
import { PageHeader, StateHero, TrustedCircleCard } from '@/components/domain/blocks';
import { EventTimeline } from '@/components/domain/EventTimeline';
import { RiskWhyPanel } from '@/components/domain/RiskWhyPanel';
import { MissedCheckInBanner } from '@/components/domain/CheckInPrompt';
import { useAppState, useCircle, store } from '@/store/hooks';
import { useAuth } from '@/store/authStore';
import { formatClock, formatDurationMinutes, formatRelative } from '@/lib/format';
import { formatLatLng } from '@/domain/geo';
import { linkQuality, remainingMinutes } from '@/domain/journey';
import { EMPTY_RISK_INPUTS, scoreRisk } from '@/domain/riskEngine';

export function TravellerHome() {
  const { journey, events, now, travellerProfile, places } = useAppState();
  const { primary, backup } = useCircle();
  const { signedIn } = useAuth();
  const navigate = useNavigate();

  const assessment = journey?.risk ?? scoreRisk(EMPTY_RISK_INPUTS);
  const active = Boolean(journey && journey.status !== 'ENDED');
  const quality = linkQuality(journey, now);

  return (
    <div className="space-y-5" key={`home-${journey?.id ?? 'none'}`}>
      <PageHeader
        eyebrow={`${travellerProfile.name} · Traveller`}
        title="Good evening"
        description="SURAKSHA watches the journey with you — it checks in, notices changes, and tells the people you chose. It is a tool, not a promise."
        actions={
          active ? (
            <Button variant="outline" size="sm" icon={<Compass size={15} />} onClick={() => navigate("/traveller/journey")}>
              Open journey
            </Button>
          ) : (
            <Button size="sm" icon={<Plus size={15} />} onClick={() => navigate('/traveller/start')}>
              Plan a journey
            </Button>
          )
        }
      />

      <StateHero
        assessment={assessment}
        journey={journey}
        now={now}
        subtitle={
          journey
            ? journey.risk.headline
            : 'Everything looks normal. No journey is running — start one when you set off.'
        }
        action={
          <div className="grid gap-2 sm:w-[190px]">
            {active ? (
              <>
                <Button
                  variant="secondary"
                  block
                  icon={<Compass size={17} />}
                  onClick={() => navigate('/traveller/journey')}
                >
                  Active Journey
                </Button>
                <Button
                  variant="outline"
                  block
                  icon={<PhoneCall size={17} />}
                  onClick={() => navigate('/traveller/exit')}
                >
                  Exit Mode
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" block icon={<Compass size={17} />} onClick={() => navigate('/traveller/start')}>
                  Start Journey
                </Button>
                <Button variant="outline" block icon={<PhoneCall size={17} />} onClick={() => navigate('/traveller/exit')}>
                  Exit Mode
                </Button>
              </>
            )}
            <button
              type="button"
              onClick={() => (signedIn ? store.toggleUi('sosPanelOpen', true) : navigate('/login'))}
              aria-label={signedIn ? 'Quick SOS — opens the emergency workflow' : 'Sign in to SURAKSHA'}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-critical-600 text-sm font-bold text-white transition-state hover:bg-critical-700 active:scale-[0.99]"
            >
              {signedIn ? <ShieldCheck size={17} /> : <LogIn size={17} />}
              {signedIn ? 'QUICK SOS' : 'SIGN IN'}
            </button>
          </div>
        }
      />

      {journey?.checkIn.state === 'MISSED' ? <MissedCheckInBanner /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Journey"
          value={active ? 'Active' : 'Idle'}
          hint={journey ? `${journey.originLabel} → ${journey.destinationLabel}` : 'No journey running'}
          tone={active ? 'brand' : 'neutral'}
          icon={<Compass size={16} />}
        />
        <Stat
          label="Current location"
          value={
            journey?.locationAvailable ? (
              <span className="text-[15px]">{formatLatLng(journey.position)}</span>
            ) : (
              <span className="text-[15px]">Unavailable</span>
            )
          }
          hint={
            journey
              ? journey.locationAvailable
                ? `Simulated · updated ${formatRelative(journey.lastPositionAt, now)}`
                : 'Using last known position'
              : 'Location starts with a journey'
          }
          icon={<MapPin size={16} />}
          tone={quality === 'connected' ? 'safe' : 'watch'}
        />
        <Stat
          label="Next check-in"
          value={journey?.checkIn.dueAt ? formatClock(journey.checkIn.dueAt) : '—'}
          hint={journey ? `Every ${journey.checkInIntervalMinutes} min · ${journey.gracePeriodMinutes} min grace` : 'Set when you start'}
          icon={<Clock size={16} />}
        />
        <Stat
          label="ETA"
          value={journey ? formatDurationMinutes(remainingMinutes(journey, now)) : '—'}
          hint={journey ? `Arriving ${formatClock(journey.expectedArrivalAt)}` : 'Planned arrival window'}
          icon={<Clock size={16} />}
          tone={journey && now > journey.expectedArrivalAt ? 'watch' : 'neutral'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader
              title="Recent activity"
              subtitle="Every signal SURAKSHA recorded, in order."
              icon={<Sparkles size={16} />}
              action={
                <Link to="/traveller/incidents" className="text-[12.5px] font-semibold text-brand-700 hover:underline">
                  Incidents
                </Link>
              }
            />
            <CardBody className="pt-2">
              {events.length ? (
                <EventTimeline events={events.slice(-40)} now={now} dense limit={8} />
              ) : (
                <EmptyState
                  icon={<Info size={20} />}
                  title="Nothing recorded yet"
                  description="Start a journey and SURAKSHA will log check-ins, location updates and any route changes here."
                  action={
                    <Button size="sm" onClick={() => navigate('/traveller/start')}>
                      Start a journey
                    </Button>
                  }
                  className="border-0 py-8"
                />
              )}
              {events.length > 8 ? (
                <Link
                  to="/traveller/journey"
                  className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-brand-700 hover:underline"
                >
                  Full timeline <ArrowRight size={13} />
                </Link>
              ) : null}
            </CardBody>
          </Card>

          <RiskWhyPanel assessment={assessment} />
        </div>

        <div className="space-y-4">
          <TrustedCircleCard primary={primary} backup={backup} to="/traveller/circle" />

          <Card>
            <CardHeader
              title="Verified safe places"
              subtitle="Nearby places you can walk into and wait."
              icon={<MapPin size={16} />}
              action={
                <Link to="/traveller/community" className="text-[12.5px] font-semibold text-brand-700 hover:underline">
                  All
                </Link>
              }
            />
            <CardBody className="space-y-2 pt-2">
              {places.slice(0, 3).map((place) => (
                <div key={place.id} className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold text-ink-800">{place.name}</p>
                    <p className="text-[11.5px] text-ink-500">
                      {place.distanceMeters} m · {place.hours}
                    </p>
                  </div>
                  <Chip tone={place.openNow ? 'safe' : 'watch'}>{place.openNow ? 'Open' : 'Closed'}</Chip>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card tone="brand" className="bg-brand-50">
            <CardBody className="flex items-start gap-3">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-brand-700">
                <Users size={16} />
              </span>
              <div>
                <p className="text-[13px] font-bold text-brand-900">Safety Risk Engine</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-brand-900/80">
                  Your current safety state is calculated from journey timing, route status and check-ins. Deterministic
                  rules only — no AI verdict about you.
                </p>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
