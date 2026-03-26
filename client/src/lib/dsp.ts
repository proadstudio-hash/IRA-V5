import type { IRData, ETCPoint, Peak } from "@shared/schema";

export function parseWavFile(buffer: ArrayBuffer, filename: string): IRData {
  const view = new DataView(buffer);
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== 'RIFF') throw new Error('Not a valid WAV file');

  const format = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (format !== 'WAVE') throw new Error('Not a valid WAV file');

  let offset = 12;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let numChannels = 1;
  let audioFormat = 1;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset < view.byteLength - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset++;
  }

  if (dataOffset === 0) throw new Error('No data chunk found in WAV file');

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataSize / (bytesPerSample * numChannels));
  const samples = new Float64Array(totalSamples);

  for (let i = 0; i < totalSamples; i++) {
    const sampleOffset = dataOffset + i * bytesPerSample * numChannels;
    if (sampleOffset + bytesPerSample > view.byteLength) break;

    let value: number;
    if (audioFormat === 3) {
      value = view.getFloat32(sampleOffset, true);
    } else if (bitsPerSample === 16) {
      value = view.getInt16(sampleOffset, true) / 32768;
    } else if (bitsPerSample === 24) {
      const b0 = view.getUint8(sampleOffset);
      const b1 = view.getUint8(sampleOffset + 1);
      const b2 = view.getUint8(sampleOffset + 2);
      let val = (b2 << 16) | (b1 << 8) | b0;
      if (val & 0x800000) val |= ~0xFFFFFF;
      value = val / 8388608;
    } else if (bitsPerSample === 32) {
      value = view.getInt32(sampleOffset, true) / 2147483648;
    } else {
      value = view.getUint8(sampleOffset) / 128 - 1;
    }
    samples[i] = value;
  }

  return { sampleRate, samples, filename };
}

interface REWMetadata {
  sampleRate: number | null;
  peakIndex: number | null;
  responseLength: number | null;
  startTime: number | null;
  dataStartLine: number | null;
}

function parseREWMetadata(lines: string[]): REWMetadata {
  const meta: REWMetadata = {
    sampleRate: null,
    peakIndex: null,
    responseLength: null,
    startTime: null,
    dataStartLine: null,
  };

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i].trim();

    if (/\*\s*Data\s*start/i.test(line)) {
      meta.dataStartLine = i + 1;
      break;
    }

    const commentMatch = line.match(/^([-+]?[\d.]+(?:E[+-]?\d+)?)\s*\/\/\s*(.+)/i);
    if (commentMatch) {
      const val = parseFloat(commentMatch[1]);
      const desc = commentMatch[2].toLowerCase();
      if (desc.includes('sample interval') || desc.includes('sample_interval')) {
        if (val > 0 && val < 1) {
          meta.sampleRate = Math.round(1 / val);
        }
      } else if (desc.includes('peak index') || desc.includes('peak_index')) {
        meta.peakIndex = Math.round(val);
      } else if (desc.includes('response length') || desc.includes('response_length')) {
        meta.responseLength = Math.round(val);
      } else if (desc.includes('start time') || desc.includes('start_time')) {
        meta.startTime = val;
      }
    }
  }

  return meta;
}

function extractSampleRateFromHeaders(headerLines: string[]): number | null {
  for (const line of headerLines) {
    const srMatch = line.match(/(?:sample\s*rate|samplerate|rate)\s*[=:]\s*([\d.]+)/i);
    if (srMatch) {
      const val = parseFloat(srMatch[1]);
      if (val >= 1000 && val <= 384000) return Math.round(val);
    }
    const hzMatch = line.match(/([\d.]+)\s*(?:Hz|hz|HZ)/);
    if (hzMatch) {
      const val = parseFloat(hzMatch[1]);
      if (val >= 1000 && val <= 384000) return Math.round(val);
    }
  }
  return null;
}

function inferSampleRateFromDt(dt: number): number {
  if (dt <= 0 || !isFinite(dt)) return 48000;

  const srAsSeconds = 1 / dt;
  if (srAsSeconds >= 4000 && srAsSeconds <= 384000) {
    return Math.round(srAsSeconds);
  }

  const srAsMs = 1000 / dt;
  if (srAsMs >= 4000 && srAsMs <= 384000) {
    return Math.round(srAsMs);
  }

  const srAsMicro = 1e6 / dt;
  if (srAsMicro >= 4000 && srAsMicro <= 384000) {
    return Math.round(srAsMicro);
  }

  if (dt >= 0.5 && dt <= 1.5) {
    return 48000;
  }

  return 48000;
}

export function parseTextFile(text: string, filename: string): IRData {
  const lines = text.split(/\r?\n/);

  const rewMeta = parseREWMetadata(lines);

  const headerLines: string[] = [];
  const dataValues: number[] = [];
  const twoColData: { time: number; value: number }[] = [];

  const startLine = rewMeta.dataStartLine || 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    if (/^[*#%;]/.test(trimmed)) {
      headerLines.push(trimmed);
      continue;
    }

    if (trimmed.includes('//')) {
      continue;
    }

    if (i < startLine) continue;

    const parts = trimmed.split(/[\s,;\t]+/).filter(p => p.length > 0);

    if (parts.length >= 2) {
      const col0 = parseFloat(parts[0]);
      const col1 = parseFloat(parts[1]);
      if (!isNaN(col0) && !isNaN(col1)) {
        twoColData.push({ time: col0, value: col1 });
        continue;
      }
    }

    if (parts.length >= 1) {
      const val = parseFloat(parts[0]);
      if (!isNaN(val)) {
        dataValues.push(val);
        continue;
      }
    }
  }

  if (twoColData.length >= 10) {
    const dts: number[] = [];
    for (let i = 1; i < Math.min(twoColData.length, 50); i++) {
      const d = twoColData[i].time - twoColData[i - 1].time;
      if (d > 0 && isFinite(d)) dts.push(d);
    }
    let sampleRate: number;
    if (rewMeta.sampleRate) {
      sampleRate = rewMeta.sampleRate;
    } else if (dts.length > 0) {
      dts.sort((a, b) => a - b);
      const medianDt = dts[Math.floor(dts.length / 2)];
      sampleRate = extractSampleRateFromHeaders(headerLines) || inferSampleRateFromDt(medianDt);
    } else {
      sampleRate = extractSampleRateFromHeaders(headerLines) || 48000;
    }
    const samples = new Float64Array(twoColData.map(d => d.value));
    console.log(`[IR Parser] Two-column format: ${twoColData.length} rows, SR=${sampleRate} Hz`);
    return { sampleRate, samples, filename };
  }

  if (dataValues.length >= 10) {
    const sampleRate = rewMeta.sampleRate
      || extractSampleRateFromHeaders(headerLines)
      || 48000;

    const samples = new Float64Array(dataValues);
    console.log(`[IR Parser] Single-column (REW) format: ${dataValues.length} samples, SR=${sampleRate} Hz` +
      (rewMeta.peakIndex ? `, peak index=${rewMeta.peakIndex}` : '') +
      (rewMeta.startTime !== null ? `, start time=${rewMeta.startTime}s` : ''));
    return { sampleRate, samples, filename };
  }

  throw new Error(
    'Could not parse data from this file. ' +
    'Supported: WAV, or REW text exports (single-column amplitude or two-column time+amplitude). ' +
    'Comment lines starting with *, #, %, or ; are skipped.'
  );
}

function isWavBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const view = new DataView(buffer);
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  return riff === 'RIFF' && wave === 'WAVE';
}

export function parseIRFile(file: File): Promise<IRData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const buffer = reader.result as ArrayBuffer;

        if (isWavBuffer(buffer)) {
          resolve(parseWavFile(buffer, file.name));
          return;
        }

        let text: string;
        try {
          const decoder = new TextDecoder('utf-8', { fatal: true });
          text = decoder.decode(buffer);
        } catch {
          const decoder = new TextDecoder('iso-8859-1');
          text = decoder.decode(buffer);
        }
        resolve(parseTextFile(text, file.name));
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

export function computeETC(
  irData: IRData,
  smoothingMs: number = 0.1,
  directArrivalIdx?: number
): ETCPoint[] {
  const { samples, sampleRate } = irData;
  const n = samples.length;
  
  const startIdx = directArrivalIdx ?? 0;
  const timeOffset = startIdx / sampleRate * 1000;

  const energy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    energy[i] = samples[i] * samples[i];
  }

  const smoothingSamples = Math.max(1, Math.round((smoothingMs / 1000) * sampleRate));
  
  let smoothed: Float64Array;
  if (smoothingSamples > 1) {
    smoothed = new Float64Array(n);
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      prefix[i + 1] = prefix[i] + energy[i];
    }
    const half = Math.floor(smoothingSamples / 2);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - half);
      const hi = Math.min(n, i + half + 1);
      smoothed[i] = (prefix[hi] - prefix[lo]) / (hi - lo);
    }
  } else {
    smoothed = energy;
  }

  let maxVal = 0;
  for (let i = 0; i < n; i++) {
    if (smoothed[i] > maxVal) maxVal = smoothed[i];
  }

  if (maxVal === 0) maxVal = 1;

  const etc: ETCPoint[] = [];
  const step = Math.max(1, Math.floor(n / 10000));
  for (let i = startIdx; i < n; i += step) {
    const level = smoothed[i] > 0 ? 10 * Math.log10(smoothed[i] / maxVal) : -120;
    etc.push({
      time: (i / sampleRate) * 1000 - timeOffset,
      level: Math.max(-120, level),
    });
  }

  return etc;
}

export function findDirectArrival(irData: IRData): number {
  const { samples, sampleRate } = irData;
  const n = samples.length;
  
  const maxSearchSamples = Math.min(n, Math.round(0.2 * sampleRate));
  
  let maxAbs = 0;
  let maxIdx = 0;
  for (let i = 0; i < maxSearchSamples; i++) {
    const a = Math.abs(samples[i]);
    if (a > maxAbs) {
      maxAbs = a;
      maxIdx = i;
    }
  }

  if (maxAbs === 0) return 0;

  console.log(`[IR Direct] Found direct arrival at sample ${maxIdx} (${(maxIdx / sampleRate * 1000).toFixed(2)} ms), amplitude=${maxAbs.toFixed(6)}`);
  return maxIdx;
}

export function detectPeaks(
  irData: IRData,
  directIndex: number,
  earlyWindowMs: number = 50,
  thresholdDb: number = -25,
  smoothingMs: number = 0.8,
  speedOfSound: number = 343,
  startMs: number = 0.3,
  minSepMs: number = 1.0,
  noiseFloorMarginDb: number = 6,
  directLength?: number
): Peak[] {
  const { samples, sampleRate } = irData;
  const n = samples.length;
  const K_SEVERITY = 6;

  console.log(`[Peak Detection] SR=${sampleRate}, directIdx=${directIndex}, window=${earlyWindowMs}ms, threshold=${thresholdDb}dB, startMs=${startMs}, minSep=${minSepMs}ms, n=${n}`);

  const energy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    energy[i] = samples[i] * samples[i];
  }

  const W = Math.max(1, Math.round((smoothingMs / 1000) / (1 / sampleRate)));
  let smoothed: Float64Array;
  if (W > 1) {
    smoothed = new Float64Array(n);
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      prefix[i + 1] = prefix[i] + energy[i];
    }
    const half = Math.floor(W / 2);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - half);
      const hi = Math.min(n, i + half + 1);
      smoothed[i] = (prefix[hi] - prefix[lo]) / (hi - lo);
    }
  } else {
    smoothed = energy;
  }

  let maxSmoothed = 0;
  for (let i = 0; i < n; i++) {
    if (smoothed[i] > maxSmoothed) maxSmoothed = smoothed[i];
  }
  if (maxSmoothed <= 0) {
    console.log('[Peak Detection] All energy is zero — no peaks possible');
    return [];
  }

  const etcDb = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    etcDb[i] = smoothed[i] > 0 ? 10 * Math.log10(smoothed[i] / maxSmoothed) : -120;
  }

  const last20pctStart = Math.floor(n * 0.8);
  const last200msSamples = Math.round(0.2 * sampleRate);
  const noiseStart = Math.max(last20pctStart, n - last200msSamples);
  const noiseValues: number[] = [];
  for (let i = noiseStart; i < n; i++) {
    noiseValues.push(etcDb[i]);
  }
  noiseValues.sort((a, b) => a - b);
  const noiseFloor = noiseValues.length > 0 ? noiseValues[Math.floor(noiseValues.length / 2)] : -120;

  console.log(`[Peak Detection] Noise floor: ${noiseFloor.toFixed(1)} dB`);

  const startSamples = Math.max(1, Math.round((startMs / 1000) * sampleRate));
  const windowSamples = Math.round((earlyWindowMs / 1000) * sampleRate);
  const searchStart = directIndex + startSamples;
  const endIdx = Math.min(directIndex + windowSamples, n);
  const minSepSamples = Math.max(1, Math.round((minSepMs / 1000) * sampleRate));

  console.log(`[Peak Detection] W=${W}, search range=[${searchStart}, ${endIdx}), minSep=${minSepSamples} samples`);

  const neighborhoodSize = Math.max(2, Math.round(minSepMs / 2 / 1000 * sampleRate));

  const rawPeaks: Peak[] = [];

  for (let i = searchStart; i < endIdx; i++) {
    if (smoothed[i] <= 0) continue;

    let isLocalMax = true;
    const lo = Math.max(0, i - neighborhoodSize);
    const hi = Math.min(n - 1, i + neighborhoodSize);
    for (let j = lo; j <= hi; j++) {
      if (j !== i && smoothed[j] > smoothed[i]) {
        isLocalMax = false;
        break;
      }
    }
    if (!isLocalMax) continue;

    const relDb = etcDb[i];
    const passesRelativeThreshold = relDb >= thresholdDb;
    const passesNoiseFloor = relDb >= (noiseFloor + noiseFloorMarginDb);

    if (passesRelativeThreshold && passesNoiseFloor) {
      const delay_ms = ((i - directIndex) / sampleRate) * 1000;
      const deltaL = (delay_ms / 1000) * speedOfSound;
      const equivalentDistance = deltaL / 2;
      const L_dir = directLength ?? 0;
      const targetReflectedLength = L_dir + deltaL;

      const severity = relDb - K_SEVERITY * Math.log10(1 + delay_ms);

      rawPeaks.push({
        index: i,
        delay_ms,
        rel_dB: relDb,
        severity,
        equivalentDistance,
        extraPathLength: deltaL,
        targetReflectedLength,
      });
    }
  }

  console.log(`[Peak Detection] Found ${rawPeaks.length} raw peaks before minSep filtering`);

  rawPeaks.sort((a, b) => b.severity - a.severity);

  const filtered: Peak[] = [];
  for (const p of rawPeaks) {
    const tooClose = filtered.some(
      f => Math.abs(f.delay_ms - p.delay_ms) < minSepMs
    );
    if (!tooClose) filtered.push(p);
  }

  filtered.sort((a, b) => b.severity - a.severity);

  console.log(`[Peak Detection] After filtering: ${filtered.length} peaks (minSep=${minSepMs}ms)`);
  if (filtered.length > 0) {
    console.log(`[Peak Detection] Top peaks: ${filtered.slice(0, 5).map(p => `${p.delay_ms.toFixed(2)}ms @ ${p.rel_dB.toFixed(1)}dB sev=${p.severity.toFixed(2)}`).join(', ')}`);
  }

  return filtered.slice(0, 30);
}

export function computeSpeedOfSound(temperature: number): number {
  return 331.3 + 0.606 * temperature;
}
