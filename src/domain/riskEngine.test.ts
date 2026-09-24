import { describe, expect, it } from 'vitest';
import { EMPTY_RISK_INPUTS, RISK_WEIGHTS, bandForScore, explainScore, scoreRisk } from './riskEngine';

describe('Safety Risk Engine', () => {
  it('starts SAFE with no signals and no unexplained reasons', () => {
    const assessment = scoreRisk(EMPTY_RISK_INPUTS);
    expect(assessment.score).toBe(0);
    expect(assessment.band).toBe('SAFE');
    expect(assessment.reasons).toHaveLength(0);
    expect(assessment.headline).toBe('Everything looks normal.');
  });

  it('weights a single route deviation at +20 and lands in SAFE (0-29)', () => {
    const assessment = scoreRisk({ ...EMPTY_RISK_INPUTS, deviationCount: 1, deviationActive: true });
    expect(assessment.reasons.map((r) => r.delta)).toEqual([RISK_WEIGHTS.routeDeviation]);
    expect(assessment.score).toBe(20);
    expect(assessment.band).toBe('SAFE');
  });

  it('moves to WATCH at 30 with late arrival + deviation', () => {
    const assessment = scoreRisk({
      ...EMPTY_RISK_INPUTS,
      lateMinutes: 4,
      pastExpectedArrival: true,
      deviationCount: 1,
    });
    expect(assessment.score).toBe(30);
    expect(assessment.band).toBe('WATCH');
  });

  it('reproduces the documented killer-flow arithmetic (95 / CRITICAL)', () => {
    const assessment = scoreRisk({
      ...EMPTY_RISK_INPUTS,
      deviationCount: 1,
      missedCheckInCount: 1,
      sosActive: true,
    });
    expect(assessment.reasons.map((r) => `${r.delta}`)).toEqual(['20', '25', '50']);
    expect(assessment.score).toBe(95);
    expect(assessment.band).toBe('CRITICAL');
  });

  it('adds the repeated-deviation weight for a second deviation', () => {
    const assessment = scoreRisk({ ...EMPTY_RISK_INPUTS, deviationCount: 2, deviationActive: true });
    expect(assessment.score).toBe(
      RISK_WEIGHTS.routeDeviation + RISK_WEIGHTS.repeatedDeviation,
    );
  });

  it('caps repeated missed check-ins', () => {
    const assessment = scoreRisk({ ...EMPTY_RISK_INPUTS, missedCheckInCount: 9 });
    const extra = assessment.reasons.find((r) => r.code === 'repeated_missed_checkin');
    expect(extra?.delta).toBe(RISK_WEIGHTS.repeatedMissedCheckInCap);
  });

  it('never exceeds 100', () => {
    const assessment = scoreRisk({
      lateMinutes: 30,
      pastExpectedArrival: true,
      inRiskZone: true,
      deviationCount: 4,
      deviationActive: true,
      missedCheckInCount: 5,
      completedCheckInCount: 0,
      sosActive: true,
      safeConfirmationCount: 0,
    });
    expect(assessment.score).toBeLessThanOrEqual(100);
    expect(assessment.band).toBe('CRITICAL');
  });

  it('reduces the score when the traveller confirms safety, and explains why', () => {
    const withSignals = scoreRisk({ ...EMPTY_RISK_INPUTS, deviationCount: 1, missedCheckInCount: 1 });
    const afterSafe = scoreRisk({
      ...EMPTY_RISK_INPUTS,
      deviationCount: 1,
      missedCheckInCount: 1,
      safeConfirmationCount: 1,
    });
    expect(withSignals.score).toBe(45);
    expect(afterSafe.score).toBeLessThan(withSignals.score);
    expect(afterSafe.hasRecovery).toBe(true);
  });

  it('does not discount an explicit SOS with a recovery credit', () => {
    const assessment = scoreRisk({
      ...EMPTY_RISK_INPUTS,
      sosActive: true,
      safeConfirmationCount: 3,
    });
    expect(assessment.score).toBe(50);
  });

  it('maps every band boundary exactly', () => {
    expect(bandForScore(0)).toBe('SAFE');
    expect(bandForScore(29)).toBe('SAFE');
    expect(bandForScore(30)).toBe('WATCH');
    expect(bandForScore(49)).toBe('WATCH');
    expect(bandForScore(50)).toBe('ALERT');
    expect(bandForScore(74)).toBe('ALERT');
    expect(bandForScore(75)).toBe('CRITICAL');
    expect(bandForScore(100)).toBe('CRITICAL');
  });

  it('never claims the traveller is in danger or that anything was detected', () => {
    const assessment = scoreRisk({ ...EMPTY_RISK_INPUTS, deviationCount: 1, missedCheckInCount: 1 });
    const text = `${assessment.headline} ${explainScore(assessment)}`.toLowerCase();
    expect(text).toContain('does not determine that you are in danger');
    for (const forbidden of ['detected an attacker', 'predicted', 'assault', 'definitely', 'automatically knows']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('steps back down to SAFE after two confirmed-safe messages', () => {
    const once = scoreRisk({ ...EMPTY_RISK_INPUTS, deviationCount: 1, missedCheckInCount: 1, safeConfirmationCount: 1 });
    const twice = scoreRisk({ ...EMPTY_RISK_INPUTS, deviationCount: 1, missedCheckInCount: 1, safeConfirmationCount: 2 });
    expect(once.score).toBe(30);
    expect(once.band).toBe('WATCH');
    expect(twice.score).toBe(15);
    expect(twice.band).toBe('SAFE');
  });
});
