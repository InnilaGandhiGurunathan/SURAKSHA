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

  it('charges a single route deviation at +20 and reads as WATCH, not SAFE', () => {
    const assessment = scoreRisk({ ...EMPTY_RISK_INPUTS, deviationCount: 1, deviationActive: true });
    // The signal itself is +20; the band is floored to WATCH while it is open,
    // and the difference is emitted as its own reason so the ledger reconciles.
    expect(assessment.reasons.map((r) => r.code)).toEqual(['route_deviation', 'band_floor']);
    expect(assessment.reasons[0].delta).toBe(RISK_WEIGHTS.routeDeviation);
    expect(assessment.score).toBe(30);
    expect(assessment.band).toBe('WATCH');
    expect(assessment.headline).toMatch(/route deviation/i);
  });

  it('never reads SAFE with an open signal, and WATCH is not an emergency', () => {
    // Every single low-level signal used to leave the traveller in SAFE, so the
    // heaviest one (+25) still showed "everything looks normal" on screen.
    const singles: Array<[string, Partial<typeof EMPTY_RISK_INPUTS>]> = [
      ['late arrival', { pastExpectedArrival: true, lateMinutes: 10 }],
      ['risk zone', { inRiskZone: true }],
      ['route deviation', { deviationCount: 1 }],
      ['missed check-in', { missedCheckInCount: 1 }],
      ['location lost', { locationLost: true }],
      ['location stale', { locationStale: true }],
    ];
    for (const [label, inputs] of singles) {
      const assessment = scoreRisk({ ...EMPTY_RISK_INPUTS, ...inputs });
      expect(assessment.band, `${label} should be WATCH`).toBe('WATCH');
      expect(assessment.score).toBe(30);
      expect(assessment.headline, label).not.toMatch(/looks normal/i);
    }
  });

  it('adds compounding when unrelated families stack up (+6 per extra family)', () => {
    const assessment = scoreRisk({
      ...EMPTY_RISK_INPUTS,
      lateMinutes: 4,
      pastExpectedArrival: true,
      deviationCount: 1,
    });
    // late (one family) + deviation (a second) = +6 on top of 10 + 20.
    expect(assessment.score).toBe(RISK_WEIGHTS.lateArrival + RISK_WEIGHTS.routeDeviation + RISK_WEIGHTS.compoundingPerFamily);
    expect(assessment.band).toBe('WATCH');
    expect(assessment.reasons.some((r) => r.code === 'compounding')).toBe(true);
  });

  it('reproduces the documented compound scenarios (zone+missed 56, +late 72)', () => {
    const zoneMissed = scoreRisk({ ...EMPTY_RISK_INPUTS, inRiskZone: true, missedCheckInCount: 1 });
    expect(zoneMissed.score).toBe(56);
    expect(zoneMissed.band).toBe('ALERT');

    const plusLate = scoreRisk({
      ...EMPTY_RISK_INPUTS,
      inRiskZone: true,
      missedCheckInCount: 1,
      pastExpectedArrival: true,
      lateMinutes: 3,
    });
    expect(plusLate.score).toBe(72);
    expect(plusLate.band).toBe('ALERT');
  });

  it('pins an explicit SOS to CRITICAL and never compounds it', () => {
    const assessment = scoreRisk({ ...EMPTY_RISK_INPUTS, sosActive: true });
    // +50 alone would be ALERT, so the score is floored to the CRITICAL minimum
    // and the floor is explained rather than applied silently.
    expect(assessment.score).toBe(75);
    expect(assessment.band).toBe('CRITICAL');
    expect(assessment.reasons.map((r) => r.code)).toEqual(['explicit_sos', 'sos_floor']);
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
      locationLost: true,
      locationStale: false,
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
    // 20 + 25 + 6 compounding = 51; one confirmation credits 15.
    expect(withSignals.score).toBe(51);
    expect(afterSafe.score).toBe(36);
    expect(afterSafe.hasRecovery).toBe(true);
    expect(afterSafe.reasons.some((r) => r.code === 'safe_confirmation' && r.delta === -15)).toBe(true);
  });

  it('keeps recovery working after a confirmed-safe message (no band re-floor)', () => {
    // The floor must be gated on worries that are still *open*. Two deviations
    // are one worry, so a single confirmation clears it and the score must fall
    // instead of being dragged back up to the WATCH floor.
    const before = scoreRisk({ ...EMPTY_RISK_INPUTS, deviationCount: 2 });
    const after = scoreRisk({ ...EMPTY_RISK_INPUTS, deviationCount: 2, safeConfirmationCount: 1 });
    expect(before.score).toBe(30);
    expect(after.score).toBeLessThan(before.score);
    expect(after.band).toBe('SAFE');
    expect(after.reasons.some((r) => r.code === 'band_floor')).toBe(false);

    // A single deviation plus one confirmation stays SAFE too.
    const single = scoreRisk({ ...EMPTY_RISK_INPUTS, deviationCount: 1, safeConfirmationCount: 1 });
    expect(single.score).toBe(5);
    expect(single.band).toBe('SAFE');
  });

  it('does not discount an explicit SOS with a recovery credit', () => {
    const assessment = scoreRisk({
      ...EMPTY_RISK_INPUTS,
      sosActive: true,
      safeConfirmationCount: 3,
    });
    expect(assessment.score).toBe(75);
    expect(assessment.band).toBe('CRITICAL');
    expect(assessment.reasons.some((r) => r.code === 'safe_confirmation')).toBe(false);
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
    // 51 − 15 = 36 (WATCH); 51 − 30 = 21 (SAFE). Two confirmations clear both worries.
    expect(once.score).toBe(36);
    expect(once.band).toBe('WATCH');
    expect(twice.score).toBe(21);
    expect(twice.band).toBe('SAFE');
  });

  it('charges location lost at +25 and stale at +10, without double-counting', () => {
    const lost = scoreRisk({ ...EMPTY_RISK_INPUTS, locationLost: true });
    expect(lost.reasons.find((r) => r.code === 'location_lost')?.delta).toBe(RISK_WEIGHTS.locationLost);
    expect(lost.band).toBe('WATCH');

    const stale = scoreRisk({ ...EMPTY_RISK_INPUTS, locationStale: true });
    expect(stale.reasons.find((r) => r.code === 'location_stale')?.delta).toBe(RISK_WEIGHTS.locationStale);
    // Lost supersedes stale: they are the same worry at two strengths.
    const both = scoreRisk({ ...EMPTY_RISK_INPUTS, locationLost: true, locationStale: true });
    expect(both.reasons.some((r) => r.code === 'location_stale')).toBe(false);
  });

  it('holds passively detected signals below CRITICAL and explains the clamp', () => {
    const everything = scoreRisk({
      lateMinutes: 30,
      pastExpectedArrival: true,
      inRiskZone: true,
      deviationCount: 3,
      deviationActive: true,
      missedCheckInCount: 3,
      completedCheckInCount: 0,
      locationLost: true,
      locationStale: false,
      sosActive: false,
      safeConfirmationCount: 0,
    });
    expect(everything.score).toBe(RISK_WEIGHTS.passiveScoreCeiling);
    expect(everything.band).toBe('ALERT');
    // The clamp is its own reason line — never applied silently.
    expect(everything.reasons.some((r) => r.code === 'passive_ceiling')).toBe(true);
  });

  it('always reconciles: reason deltas sum to the displayed score', () => {
    const scenarios: Array<Partial<typeof EMPTY_RISK_INPUTS>> = [
      {},
      { deviationCount: 2 },
      { inRiskZone: true, missedCheckInCount: 2 },
      { locationLost: true, missedCheckInCount: 1 },
      { sosActive: true },
      { sosActive: true, deviationCount: 2, missedCheckInCount: 2, inRiskZone: true },
      { deviationCount: 2, missedCheckInCount: 1, safeConfirmationCount: 1 },
      { lateMinutes: 40, pastExpectedArrival: true, deviationCount: 4, missedCheckInCount: 4, locationLost: true },
    ];
    for (const inputs of scenarios) {
      const assessment = scoreRisk({ ...EMPTY_RISK_INPUTS, ...inputs });
      const total = assessment.reasons.reduce((sum, r) => sum + r.delta, 0);
      expect(total, `ledger for ${JSON.stringify(inputs)}`).toBe(assessment.score);
      // The band is never out of step with the number.
      expect(bandForScore(assessment.score)).toBe(assessment.band);
    }
  });
});
