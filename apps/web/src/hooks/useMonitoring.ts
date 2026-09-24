import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { RiskAssessment } from '@suraksha/shared';
import { db } from '@/lib/db';
import { useMonitor } from '@/store/monitor';
import {
  expireOverdueCheckIns,
  loadSafetyRules,
  monitoringPreference,
  monitoringStatus,
  respondToCheckIn,
  setMonitoringPreference,
  startMonitoring,
  stopMonitoring,
  tick,
  type CheckInResponse,
} from '@/services/monitor';
import { activeJourney } from '@/services/journeys';
import { listContacts } from '@/services/contacts';

/**
 * Monitoring for screens and the app shell.
 *
 * The loop itself lives in the service layer so it survives navigation; this hook
 * just exposes its state and the actions a screen may need.
 */
export function useMonitoring(ownerId: string | undefined) {
  const monitor = useMonitor();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const journey = useLiveQuery(async () => (ownerId ? activeJourney(ownerId) : undefined), [ownerId]);

  const contacts = useLiveQuery(async () => (ownerId ? listContacts(ownerId) : []), [ownerId]);

  useEffect(() => {
    if (journey) monitor.setJourney(journey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey?.id, journey?.status, journey?.riskScore, journey?.updatedAt]);

  useEffect(() => {
    if (!ownerId) return undefined;
    const status = monitoringStatus();
    if (status.running) return undefined;

    let cancelled = false;
    void (async () => {
      // Monitoring restarts automatically after a reload when the user asked for
      // it and there is an active journey — otherwise a phone restart would
      // silently end the protection the user believes is running.
      const preferred = await monitoringPreference(ownerId);
      const current = await activeJourney(ownerId);
      if (cancelled) return;
      if (preferred && current) await startMonitoring(ownerId);
      else monitor.setMonitoring(false, current ? 'Monitoring is paused.' : 'Monitoring is off.');
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerId]);

  const start = useCallback(async () => {
    if (!ownerId) return;
    setBusy(true);
    setError(undefined);
    try {
      await setMonitoringPreference(ownerId, true);
      await startMonitoring(ownerId);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }, [ownerId]);

  const stop = useCallback(async () => {
    if (!ownerId) return;
    setBusy(true);
    try {
      await setMonitoringPreference(ownerId, false);
      await stopMonitoring('Monitoring turned off by the traveller.');
    } finally {
      setBusy(false);
    }
  }, [ownerId]);

  const checkNow = useCallback(async () => {
    if (!ownerId) return undefined;
    return tick(ownerId, 'manual');
  }, [ownerId]);

  const respond = useCallback(
    async (response: CheckInResponse) => {
      if (!monitor.checkIn) return undefined;
      setBusy(true);
      try {
        return await respondToCheckIn(monitor.checkIn.id, response, monitor.journey?.lastKnownLocation);
      } finally {
        setBusy(false);
      }
    },
    [monitor.checkIn, monitor.journey?.lastKnownLocation],
  );

  const expireOverdue = useCallback(async () => {
    if (!ownerId) return 0;
    return expireOverdueCheckIns(ownerId);
  }, [ownerId]);

  const assessment: RiskAssessment | undefined = monitor.assessment;
  const rules = useLiveQuery(async () => (ownerId ? loadSafetyRules(ownerId) : undefined), [ownerId]);

  const [status, setStatus] = useState(monitoringStatus());
  useEffect(() => {
    const timer = setInterval(() => setStatus(monitoringStatus()), 5000);
    return () => clearInterval(timer);
  }, []);

  const upcomingShares = useLiveQuery(
    async () => (journey ? db.shares.where('journeyId').equals(journey.id).toArray() : []),
    [journey?.id],
    [],
  );

  return {
    journey,
    contacts: contacts ?? [],
    assessment,
    rules,
    checkIn: monitor.checkIn,
    monitoring: monitor.monitoring || status.running,
    status,
    deviationMeters: monitor.deviationMeters,
    progress: monitor.progress,
    delayMinutes: monitor.delayMinutes,
    offlineRoute: monitor.offlineRoute,
    activeShares: (upcomingShares ?? []).filter((share) => share.status === 'active'),
    start,
    stop,
    checkNow,
    respond,
    expireOverdue,
    busy,
    error,
    message: monitor.statusMessage,
  };
}
