import type { IRData, MatchedPeak } from "@shared/schema";

export interface FrequencyPoint {
  frequency: number;
  magnitude_dB: number;
}

export interface CombSignature {
  peakIndex: number;
  delay_ms: number;
  rel_dB: number;
  surface: string;
  combSpacing_Hz: number;
  notchFrequencies: number[];
}

export interface FrequencyAnalysisResult {
  spectrum: FrequencyPoint[];
  smoothedSpectrum: FrequencyPoint[];
  combSignatures: CombSignature[];
  sampleRate: number;
}

function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
  }
  return w;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function fftReal(signal: Float64Array): { re: Float64Array; im: Float64Array } {
  const N = signal.length;
  const re = new Float64Array(N);
  const im = new Float64Array(N);

  for (let i = 0; i < N; i++) re[i] = signal[i];

  const bits = Math.log2(N);
  for (let i = 0; i < N; i++) {
    let j = 0;
    for (let b = 0; b < bits; b++) {
      j = (j << 1) | ((i >> b) & 1);
    }
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let size = 2; size <= N; size *= 2) {
    const halfSize = size / 2;
    const angle = -2 * Math.PI / size;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);

    for (let i = 0; i < N; i += size) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < halfSize; j++) {
        const tRe = curRe * re[i + j + halfSize] - curIm * im[i + j + halfSize];
        const tIm = curRe * im[i + j + halfSize] + curIm * re[i + j + halfSize];

        re[i + j + halfSize] = re[i + j] - tRe;
        im[i + j + halfSize] = im[i + j] - tIm;
        re[i + j] += tRe;
        im[i + j] += tIm;

        const newCurRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = newCurRe;
      }
    }
  }

  return { re, im };
}

function smoothSpectrum(spectrum: FrequencyPoint[], octaveFraction: number): FrequencyPoint[] {
  if (spectrum.length === 0) return [];

  const smoothed: FrequencyPoint[] = [];
  const factor = Math.pow(2, 1 / (2 * octaveFraction));

  for (const point of spectrum) {
    if (point.frequency <= 0) {
      smoothed.push({ ...point });
      continue;
    }

    const fLow = point.frequency / factor;
    const fHigh = point.frequency * factor;

    let sum = 0;
    let count = 0;
    for (const p of spectrum) {
      if (p.frequency >= fLow && p.frequency <= fHigh) {
        sum += Math.pow(10, p.magnitude_dB / 10);
        count++;
      }
    }

    if (count > 0) {
      smoothed.push({
        frequency: point.frequency,
        magnitude_dB: 10 * Math.log10(sum / count),
      });
    } else {
      smoothed.push({ ...point });
    }
  }

  return smoothed;
}

export function computeFrequencyResponse(
  irData: IRData,
  directIndex: number,
  windowMs: number = 300,
  smoothingOctave: number = 12
): FrequencyAnalysisResult {
  const { samples, sampleRate } = irData;
  const windowSamples = Math.min(
    samples.length - directIndex,
    Math.round((windowMs / 1000) * sampleRate)
  );

  const fftSize = nextPow2(windowSamples);
  const window = hannWindow(windowSamples);

  const windowed = new Float64Array(fftSize);
  for (let i = 0; i < windowSamples; i++) {
    windowed[i] = samples[directIndex + i] * window[i];
  }

  const { re, im } = fftReal(windowed);

  const spectrum: FrequencyPoint[] = [];
  const halfN = fftSize / 2;
  const freqResolution = sampleRate / fftSize;

  let maxMag = 0;
  const magnitudes = new Float64Array(halfN);
  for (let i = 1; i < halfN; i++) {
    magnitudes[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    if (magnitudes[i] > maxMag) maxMag = magnitudes[i];
  }

  if (maxMag <= 0) maxMag = 1;

  for (let i = 1; i < halfN; i++) {
    const freq = i * freqResolution;
    if (freq > 20000) break;
    if (freq < 20) continue;

    const mag_dB = 20 * Math.log10(magnitudes[i] / maxMag);
    spectrum.push({ frequency: freq, magnitude_dB: Math.max(-80, mag_dB) });
  }

  const smoothedSpectrum = smoothSpectrum(spectrum, smoothingOctave);

  return {
    spectrum,
    smoothedSpectrum,
    combSignatures: [],
    sampleRate,
  };
}

export function computeCombSignatures(
  matchedPeaks: MatchedPeak[],
  topN: number = 5
): CombSignature[] {
  const sorted = [...matchedPeaks].sort((a, b) => b.peak.severity - a.peak.severity);
  const topPeaks = sorted.slice(0, topN);

  return topPeaks.map((mp, idx) => {
    const delay_s = mp.peak.delay_ms / 1000;
    const combSpacing = delay_s > 0 ? 1 / delay_s : 0;

    const notches: number[] = [];
    if (delay_s > 0) {
      for (let n = 0; n < 5; n++) {
        const freq = (2 * n + 1) / (2 * delay_s);
        if (freq <= 20000) notches.push(Math.round(freq));
      }
    }

    return {
      peakIndex: idx,
      delay_ms: mp.peak.delay_ms,
      rel_dB: mp.peak.rel_dB,
      surface: mp.assigned && mp.reflection ? mp.reflection.surfaceLabel : 'Unassigned',
      combSpacing_Hz: Math.round(combSpacing),
      notchFrequencies: notches,
    };
  });
}
