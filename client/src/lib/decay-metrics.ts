import type { IRData } from "@shared/schema";

export interface DecayCurvePoint {
  time_ms: number;
  level_dB: number;
}

export interface RegressionResult {
  slope: number;
  intercept: number;
  r_squared: number;
  startDb: number;
  endDb: number;
  startIdx: number;
  endIdx: number;
}

export interface DecayMetricsResult {
  curve: DecayCurvePoint[];
  edt: number | null;
  t20: number | null;
  t30: number | null;
  rt60: number | null;
  edtRegression: RegressionResult | null;
  t20Regression: RegressionResult | null;
  t30Regression: RegressionResult | null;
  earlySlope: number | null;
  lateSlope: number | null;
  slopeInterpretation: string;
}

function linearRegression(x: number[], y: number[]): { slope: number; intercept: number; r_squared: number } {
  const n = x.length;
  if (n < 2) return { slope: 0, intercept: 0, r_squared: 0 };

  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sx += x[i];
    sy += y[i];
    sxx += x[i] * x[i];
    sxy += x[i] * y[i];
    syy += y[i] * y[i];
  }

  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-30) return { slope: 0, intercept: sy / n, r_squared: 0 };

  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;

  const yMean = sy / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (y[i] - yMean) ** 2;
    ssRes += (y[i] - (slope * x[i] + intercept)) ** 2;
  }
  const r_squared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  return { slope, intercept, r_squared };
}

function fitDecayRange(
  curve: DecayCurvePoint[],
  startDb: number,
  endDb: number
): RegressionResult | null {
  const startIdx = curve.findIndex(p => p.level_dB <= startDb);
  const endIdx = curve.findIndex(p => p.level_dB <= endDb);

  if (startIdx < 0 || endIdx < 0 || endIdx <= startIdx) return null;
  if (endIdx - startIdx < 3) return null;

  const x: number[] = [];
  const y: number[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    x.push(curve[i].time_ms);
    y.push(curve[i].level_dB);
  }

  const reg = linearRegression(x, y);
  return {
    slope: reg.slope,
    intercept: reg.intercept,
    r_squared: reg.r_squared,
    startDb,
    endDb,
    startIdx,
    endIdx,
  };
}

export function computeSchroederCurve(irData: IRData, directIndex: number): DecayCurvePoint[] {
  const { samples, sampleRate } = irData;
  const n = samples.length;

  const energy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    energy[i] = samples[i] * samples[i];
  }

  const revCumSum = new Float64Array(n);
  revCumSum[n - 1] = energy[n - 1];
  for (let i = n - 2; i >= 0; i--) {
    revCumSum[i] = revCumSum[i + 1] + energy[i];
  }

  const maxE = revCumSum[directIndex] || revCumSum[0];
  if (maxE <= 0) return [];

  const curve: DecayCurvePoint[] = [];
  const step = Math.max(1, Math.floor((n - directIndex) / 5000));

  for (let i = directIndex; i < n; i += step) {
    const normalized = revCumSum[i] / maxE;
    if (normalized <= 0) break;
    const dB = 10 * Math.log10(normalized);
    if (dB < -80) break;
    curve.push({
      time_ms: ((i - directIndex) / sampleRate) * 1000,
      level_dB: dB,
    });
  }

  return curve;
}

export function computeDecayMetrics(irData: IRData, directIndex: number): DecayMetricsResult {
  const curve = computeSchroederCurve(irData, directIndex);

  if (curve.length < 10) {
    return {
      curve,
      edt: null, t20: null, t30: null, rt60: null,
      edtRegression: null, t20Regression: null, t30Regression: null,
      earlySlope: null, lateSlope: null,
      slopeInterpretation: 'Insufficient data for decay analysis.',
    };
  }

  const edtReg = fitDecayRange(curve, 0, -10);
  const t20Reg = fitDecayRange(curve, -5, -25);
  const t30Reg = fitDecayRange(curve, -5, -35);

  const extrapolateRT = (reg: RegressionResult | null, rangeDb: number): number | null => {
    if (!reg || reg.slope >= 0) return null;
    const t60 = -60 / reg.slope;
    return t60 > 0 ? t60 / 1000 : null;
  };

  const edt = edtReg ? extrapolateRT(edtReg, 10) : null;
  const t20 = t20Reg ? extrapolateRT(t20Reg, 20) : null;
  const t30 = t30Reg ? extrapolateRT(t30Reg, 30) : null;
  const rt60 = t30 ?? t20 ?? null;

  const earlyReg = fitDecayRange(curve, 0, -10);
  const lateReg = fitDecayRange(curve, -15, -35);

  const earlySlope = earlyReg ? earlyReg.slope : null;
  const lateSlope = lateReg ? lateReg.slope : null;

  let slopeInterpretation = '';
  if (earlySlope !== null && lateSlope !== null) {
    const ratio = Math.abs(earlySlope / lateSlope);
    if (ratio > 1.5) {
      slopeInterpretation = 'Fast early decay with slower late decay — possible flutter echo or strong early reflections dominating initial energy loss.';
    } else if (ratio < 0.67) {
      slopeInterpretation = 'Slow early decay with faster late decay — early reflections sustain energy, but late field dissipates quickly.';
    } else {
      slopeInterpretation = 'Relatively uniform decay — early and late slopes are consistent, indicating smooth energy dissipation.';
    }
  } else {
    slopeInterpretation = 'Could not compute early/late slope comparison — insufficient decay range available.';
  }

  return {
    curve,
    edt: edt !== null ? Math.round(edt * 1000) / 1000 : null,
    t20: t20 !== null ? Math.round(t20 * 1000) / 1000 : null,
    t30: t30 !== null ? Math.round(t30 * 1000) / 1000 : null,
    rt60: rt60 !== null ? Math.round(rt60 * 1000) / 1000 : null,
    edtRegression: edtReg,
    t20Regression: t20Reg,
    t30Regression: t30Reg,
    earlySlope,
    lateSlope,
    slopeInterpretation,
  };
}
