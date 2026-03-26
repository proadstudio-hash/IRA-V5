import type { MatchedPeak } from "@shared/schema";

export type Verdict = 'PASS' | 'WARN' | 'FAIL';

export interface ITDGResult {
  value_ms: number;
  verdict: Verdict;
  firstSignificantPeak: MatchedPeak | null;
}

export interface RFZResult {
  verdict: Verdict;
  worstPeak: MatchedPeak | null;
  worstDb: number;
}

export interface CriticalEarlyResult {
  verdict: Verdict;
  worstPeak: MatchedPeak | null;
  worstDb: number;
}

export interface TimeBinCounts {
  bin_0_10: number;
  bin_10_20: number;
  bin_20_50: number;
}

export interface WorstOffender {
  delay_ms: number;
  rel_dB: number;
  assignedSurface: string;
  confidence: number;
  severity: number;
}

export type ScorecardPreset = 'Mix' | 'Vocal' | 'Podcast';

export interface ScorecardThresholds {
  itdg_pass: number;
  itdg_warn: number;
  significant_dB: number;
}

export interface TrimSettings {
  excludeWorst: number;
  excludeBest: number;
}

export interface ScorecardResult {
  itdg: ITDGResult;
  rfz: RFZResult;
  criticalEarly: CriticalEarlyResult;
  timeBins: TimeBinCounts;
  worstOffenders: WorstOffender[];
  preset: ScorecardPreset;
  totalPeaks: number;
  activePeaks: number;
  trimSettings: TrimSettings;
}

const PRESET_THRESHOLDS: Record<ScorecardPreset, ScorecardThresholds> = {
  Mix: { itdg_pass: 10, itdg_warn: 6, significant_dB: -20 },
  Vocal: { itdg_pass: 15, itdg_warn: 10, significant_dB: -15 },
  Podcast: { itdg_pass: 20, itdg_warn: 12, significant_dB: -10 },
};

export function getThresholds(preset: ScorecardPreset): ScorecardThresholds {
  return PRESET_THRESHOLDS[preset];
}

export function applyTrim(peaks: MatchedPeak[], trim: TrimSettings): MatchedPeak[] {
  if (trim.excludeWorst === 0 && trim.excludeBest === 0) return peaks;
  if (peaks.length === 0) return peaks;

  const sorted = [...peaks].sort((a, b) => b.peak.severity - a.peak.severity);

  const startIdx = trim.excludeWorst;
  const endIdx = sorted.length - trim.excludeBest;

  if (startIdx >= endIdx) return [];
  return sorted.slice(startIdx, endIdx);
}

export function computeITDG(
  matchedPeaks: MatchedPeak[],
  thresholds: ScorecardThresholds
): ITDGResult {
  const sorted = [...matchedPeaks].sort((a, b) => a.peak.delay_ms - b.peak.delay_ms);
  const firstSignificant = sorted.find(mp => mp.peak.rel_dB >= thresholds.significant_dB);

  if (!firstSignificant) {
    return { value_ms: Infinity, verdict: 'PASS', firstSignificantPeak: null };
  }

  const itdg = firstSignificant.peak.delay_ms;
  let verdict: Verdict = 'FAIL';
  if (itdg >= thresholds.itdg_pass) verdict = 'PASS';
  else if (itdg >= thresholds.itdg_warn) verdict = 'WARN';

  return { value_ms: itdg, verdict, firstSignificantPeak: firstSignificant };
}

export function computeRFZ(matchedPeaks: MatchedPeak[]): RFZResult {
  const earlyPeaks = matchedPeaks.filter(mp => mp.peak.delay_ms >= 0 && mp.peak.delay_ms <= 20);
  const violators = earlyPeaks.filter(mp => mp.peak.rel_dB >= -15);

  if (violators.length === 0) {
    return { verdict: 'PASS', worstPeak: null, worstDb: -Infinity };
  }

  const worst = violators.reduce((a, b) => a.peak.rel_dB > b.peak.rel_dB ? a : b);
  const verdict: Verdict = worst.peak.rel_dB >= -10 ? 'FAIL' : 'WARN';

  return { verdict, worstPeak: worst, worstDb: worst.peak.rel_dB };
}

export function computeCriticalEarly(matchedPeaks: MatchedPeak[]): CriticalEarlyResult {
  const earlyPeaks = matchedPeaks.filter(mp => mp.peak.delay_ms >= 0 && mp.peak.delay_ms <= 10);
  const violators = earlyPeaks.filter(mp => mp.peak.rel_dB >= -12);

  if (violators.length === 0) {
    return { verdict: 'PASS', worstPeak: null, worstDb: -Infinity };
  }

  const worst = violators.reduce((a, b) => a.peak.rel_dB > b.peak.rel_dB ? a : b);
  const verdict: Verdict = worst.peak.rel_dB >= -6 ? 'FAIL' : 'WARN';

  return { verdict, worstPeak: worst, worstDb: worst.peak.rel_dB };
}

export function computeTimeBins(matchedPeaks: MatchedPeak[]): TimeBinCounts {
  return {
    bin_0_10: matchedPeaks.filter(mp => mp.peak.delay_ms >= 0 && mp.peak.delay_ms < 10).length,
    bin_10_20: matchedPeaks.filter(mp => mp.peak.delay_ms >= 10 && mp.peak.delay_ms < 20).length,
    bin_20_50: matchedPeaks.filter(mp => mp.peak.delay_ms >= 20 && mp.peak.delay_ms < 50).length,
  };
}

export function computeWorstOffenders(matchedPeaks: MatchedPeak[], count: number = 3): WorstOffender[] {
  const sorted = [...matchedPeaks].sort((a, b) => b.peak.severity - a.peak.severity);
  return sorted.slice(0, count).map(mp => ({
    delay_ms: mp.peak.delay_ms,
    rel_dB: mp.peak.rel_dB,
    assignedSurface: mp.assigned && mp.reflection ? mp.reflection.surfaceLabel : 'Unassigned',
    confidence: mp.confidence,
    severity: mp.peak.severity,
  }));
}

export function computeScorecard(
  matchedPeaks: MatchedPeak[],
  preset: ScorecardPreset = 'Mix',
  trim: TrimSettings = { excludeWorst: 0, excludeBest: 0 }
): ScorecardResult {
  const thresholds = getThresholds(preset);
  const totalPeaks = matchedPeaks.length;
  const trimmed = applyTrim(matchedPeaks, trim);

  return {
    itdg: computeITDG(trimmed, thresholds),
    rfz: computeRFZ(trimmed),
    criticalEarly: computeCriticalEarly(trimmed),
    timeBins: computeTimeBins(trimmed),
    worstOffenders: computeWorstOffenders(trimmed),
    preset,
    totalPeaks,
    activePeaks: trimmed.length,
    trimSettings: trim,
  };
}
