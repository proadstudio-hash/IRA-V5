import type { IRData } from "@shared/schema";

export interface ClarityResult {
  c50: number | null;
  c80: number | null;
  d50: number | null;
  ts_ms: number | null;
  interpretation: string;
}

export function computeClarityMetrics(irData: IRData, directIndex: number): ClarityResult {
  const { samples, sampleRate } = irData;
  const n = samples.length;

  const windowMs = 500;
  const windowSamples = Math.min(n - directIndex, Math.round((windowMs / 1000) * sampleRate));
  const end = directIndex + windowSamples;

  const ms50samples = Math.round(0.05 * sampleRate);
  const ms80samples = Math.round(0.08 * sampleRate);

  const idx50 = Math.min(directIndex + ms50samples, end);
  const idx80 = Math.min(directIndex + ms80samples, end);

  let eEarly50 = 0, eEarly80 = 0, eTotal = 0;
  let weightedTimeSum = 0;

  for (let i = directIndex; i < end; i++) {
    const e = samples[i] * samples[i];
    const t_sec = (i - directIndex) / sampleRate;

    eTotal += e;
    weightedTimeSum += t_sec * e;

    if (i < idx50) eEarly50 += e;
    if (i < idx80) eEarly80 += e;
  }

  if (eTotal <= 0) {
    return { c50: null, c80: null, d50: null, ts_ms: null, interpretation: 'No energy detected.' };
  }

  const eLate50 = eTotal - eEarly50;
  const eLate80 = eTotal - eEarly80;

  const c50 = eLate50 > 0 ? 10 * Math.log10(eEarly50 / eLate50) : null;
  const c80 = eLate80 > 0 ? 10 * Math.log10(eEarly80 / eLate80) : null;
  const d50 = 100 * (eEarly50 / eTotal);
  const ts_ms = (weightedTimeSum / eTotal) * 1000;

  let interpretation = '';
  if (c50 !== null) {
    if (c50 > 2) interpretation += 'C50 > 2 dB: Good speech clarity. ';
    else if (c50 > -2) interpretation += 'C50 near 0 dB: Marginal speech clarity. ';
    else interpretation += 'C50 < -2 dB: Poor speech clarity. ';
  }
  if (c80 !== null) {
    if (c80 > 2) interpretation += 'C80 > 2 dB: Good musical clarity. ';
    else if (c80 > -2) interpretation += 'C80 near 0 dB: Balanced — suitable for orchestral music. ';
    else interpretation += 'C80 < -2 dB: Reverberant, may reduce musical definition. ';
  }
  if (ts_ms !== null) {
    if (ts_ms < 50) interpretation += `Ts=${ts_ms.toFixed(1)} ms: Very intimate/close sound. `;
    else if (ts_ms < 100) interpretation += `Ts=${ts_ms.toFixed(1)} ms: Moderate perceived distance. `;
    else interpretation += `Ts=${ts_ms.toFixed(1)} ms: Diffuse/distant character. `;
  }

  return {
    c50: c50 !== null ? Math.round(c50 * 100) / 100 : null,
    c80: c80 !== null ? Math.round(c80 * 100) / 100 : null,
    d50: Math.round(d50 * 10) / 10,
    ts_ms: Math.round(ts_ms * 10) / 10,
    interpretation: interpretation.trim(),
  };
}
