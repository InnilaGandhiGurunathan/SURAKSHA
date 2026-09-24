import { create } from 'zustand';
import type { Journey, RiskAssessment } from '@suraksha/shared';
import type { CheckInRecord } from '@/lib/db';

/**
 * Live monitoring state for the UI: current journey, latest assessment, and the
 * open safety check-in. Kept in a store rather than component state because the
 * check-in sheet is rendered by the app shell while the monitoring loop lives in
 * a service.
 */

export interface MonitorState {
  journey?: Journey;
  assessment?: RiskAssessment;
  checkIn?: CheckInRecord;
  monitoring: boolean;
  lastTickAt?: string;
  statusMessage: string;
  deviationMeters?: number;
  progress: number;
  delayMinutes: number;
  offlineRoute: boolean;

  setJourney: (journey?: Journey) => void;
  setAssessment: (assessment?: RiskAssessment, extras?: Partial<MonitorState>) => void;
  setCheckIn: (checkIn?: CheckInRecord) => void;
  setMonitoring: (running: boolean, message?: string) => void;
  clear: () => void;
}

export const useMonitor = create<MonitorState>((set) => ({
  monitoring: false,
  progress: 0,
  delayMinutes: 0,
  offlineRoute: true,
  statusMessage: 'Monitoring is off.',

  setJourney: (journey) =>
    set({
      journey,
      offlineRoute: journey?.route?.approximate ?? true,
      progress: journey ? (journey.status === 'completed' ? 1 : 0) : 0,
    }),
  setAssessment: (assessment, extras) =>
    set((state) => ({
      assessment,
      delayMinutes: extras?.delayMinutes ?? state.delayMinutes,
      deviationMeters: extras?.deviationMeters ?? state.deviationMeters,
      progress: extras?.progress ?? state.progress,
      lastTickAt: assessment?.evaluatedAt ?? state.lastTickAt,
    })),
  setCheckIn: (checkIn) => set({ checkIn }),
  setMonitoring: (running, message) =>
    set({ monitoring: running, statusMessage: message ?? (running ? 'Monitoring on this device.' : 'Monitoring is off.') }),
  clear: () => set({ journey: undefined, assessment: undefined, checkIn: undefined, progress: 0, deviationMeters: undefined }),
}));