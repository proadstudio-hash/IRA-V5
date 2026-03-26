import type { RoomDimensions, Point3D, CeilingConfig, IRData, RoomMode, ModalPeak, PressureMapData, SeatCandidate, ModalAnalysisResult, ModeType, FusionIRDataset } from "@shared/schema";
import { getCeilingHeightAt } from "./geometry";

function classifyMode(n: number, m: number, l: number): ModeType {
  const nonZero = (n > 0 ? 1 : 0) + (m > 0 ? 1 : 0) + (l > 0 ? 1 : 0);
  if (nonZero === 1) return 'axial';
  if (nonZero === 2) return 'tangential';
  return 'oblique';
}

interface ShapedCeilingGrid {
  nx: number;
  ny: number;
  nz: number;
  dx: number;
  dy: number;
  dz: number;
  nodeCoords: Float64Array[];
  insideNodes: number[];
  nodeIndex: Int32Array;
}

let _lastGrid: ShapedCeilingGrid | null = null;

function interpolateEigenvector(ev: Float64Array, x: number, y: number, z: number, grid: ShapedCeilingGrid): number {
  const fi = Math.max(0, Math.min(x / grid.dx, grid.nx));
  const fj = Math.max(0, Math.min(y / grid.dy, grid.ny));
  const fk = Math.max(0, Math.min(z / grid.dz, grid.nz));
  const i0 = Math.min(Math.floor(fi), grid.nx - 1);
  const j0 = Math.min(Math.floor(fj), grid.ny - 1);
  const k0 = Math.min(Math.floor(fk), grid.nz - 1);
  const i1 = Math.min(i0 + 1, grid.nx);
  const j1 = Math.min(j0 + 1, grid.ny);
  const k1 = Math.min(k0 + 1, grid.nz);
  const fx = fi - i0;
  const fy = fj - j0;
  const fz = fk - k0;
  const idx3 = (ii: number, jj: number, kk: number) => ii * (grid.ny + 1) * (grid.nz + 1) + jj * (grid.nz + 1) + kk;
  const getVal = (ii: number, jj: number, kk: number) => {
    const ni = grid.nodeIndex[idx3(ii, jj, kk)];
    return ni >= 0 ? ev[ni] : 0;
  };
  return (
    getVal(i0, j0, k0) * (1 - fx) * (1 - fy) * (1 - fz) +
    getVal(i1, j0, k0) * fx * (1 - fy) * (1 - fz) +
    getVal(i0, j1, k0) * (1 - fx) * fy * (1 - fz) +
    getVal(i1, j1, k0) * fx * fy * (1 - fz) +
    getVal(i0, j0, k1) * (1 - fx) * (1 - fy) * fz +
    getVal(i1, j0, k1) * fx * (1 - fy) * fz +
    getVal(i0, j1, k1) * (1 - fx) * fy * fz +
    getVal(i1, j1, k1) * fx * fy * fz
  );
}

export function computeCuboidModes(
  room: RoomDimensions,
  c: number,
  fMax: number
): RoomMode[] {
  const L = room.length;
  const W = room.width;
  const H = room.height;
  const modes: RoomMode[] = [];
  const nMax = Math.ceil(2 * fMax * L / c);
  const mMax = Math.ceil(2 * fMax * W / c);
  const lMax = Math.ceil(2 * fMax * H / c);

  for (let n = 0; n <= nMax; n++) {
    for (let m = 0; m <= mMax; m++) {
      for (let l = 0; l <= lMax; l++) {
        if (n === 0 && m === 0 && l === 0) continue;
        const freq = (c / 2) * Math.sqrt(
          (n / L) ** 2 + (m / W) ** 2 + (l / H) ** 2
        );
        if (freq > fMax) continue;
        modes.push({
          n, m, l,
          frequency: freq,
          type: classifyMode(n, m, l),
          Q: 10,
          T60: 6.91 * 10 / (Math.PI * freq),
          amplitude: 1,
          matched: false,
        });
      }
    }
  }

  modes.sort((a, b) => a.frequency - b.frequency);
  return modes;
}

function cuboidModeShape(n: number, m: number, l: number, room: RoomDimensions, x: number, y: number, z: number): number {
  return Math.cos(n * Math.PI * x / room.length) *
         Math.cos(m * Math.PI * y / room.width) *
         Math.cos(l * Math.PI * z / room.height);
}

export function computeShapedCeilingModes(
  room: RoomDimensions,
  ceiling: CeilingConfig,
  c: number,
  fMax: number,
  numModes: number = 30
): RoomMode[] {
  const lambdaMin = c / fMax;
  const h = Math.max(0.1, Math.min(lambdaMin / 6, 0.2));
  const nx = Math.max(4, Math.round(room.length / h));
  const ny = Math.max(4, Math.round(room.width / h));
  const maxH = ceiling.maxHeight;
  const nz = Math.max(4, Math.round(maxH / h));
  const dx = room.length / nx;
  const dy = room.width / ny;
  const dz = maxH / nz;

  const insideNodes: number[] = [];
  const nodeIndex = new Int32Array((nx + 1) * (ny + 1) * (nz + 1)).fill(-1);
  const idx3 = (i: number, j: number, k: number) => i * (ny + 1) * (nz + 1) + j * (nz + 1) + k;

  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const xv = i * dx;
      const yv = j * dy;
      const ceilH = getCeilingHeightAt(xv, yv, room, ceiling);
      for (let k = 0; k <= nz; k++) {
        const zv = k * dz;
        if (zv <= ceilH + dz * 0.01) {
          const flatIdx = idx3(i, j, k);
          nodeIndex[flatIdx] = insideNodes.length;
          insideNodes.push(flatIdx);
        }
      }
    }
  }

  const N = insideNodes.length;
  if (N < 10) return computeCuboidModes(room, c, fMax);

  const h2inv = 1 / (dx * dx);
  const h2yinv = 1 / (dy * dy);
  const h2zinv = 1 / (dz * dz);

  function applyNegLaplacian(phi: Float64Array, result: Float64Array) {
    for (let idx = 0; idx < N; idx++) {
      const flatIdx = insideNodes[idx];
      const i = Math.floor(flatIdx / ((ny + 1) * (nz + 1)));
      const rem = flatIdx % ((ny + 1) * (nz + 1));
      const j = Math.floor(rem / (nz + 1));
      const k = rem % (nz + 1);
      const phiC = phi[idx];
      let lapVal = 0;

      for (const [di, dj, dk, hinv] of [
        [i - 1, j, k, h2inv], [i + 1, j, k, h2inv],
        [i, j - 1, k, h2yinv], [i, j + 1, k, h2yinv],
        [i, j, k - 1, h2zinv], [i, j, k + 1, h2zinv],
      ] as [number, number, number, number][]) {
        if (di >= 0 && di <= nx && dj >= 0 && dj <= ny && dk >= 0 && dk <= nz) {
          const nbrIdx = nodeIndex[idx3(di, dj, dk)];
          lapVal += (nbrIdx >= 0 ? phi[nbrIdx] : phiC) * hinv;
        } else {
          lapVal += phiC * hinv;
        }
      }
      lapVal -= 2 * phiC * (h2inv + h2yinv + h2zinv);
      result[idx] = -lapVal;
    }
  }

  const sigma = -1.0;

  function applyShiftedOp(phi: Float64Array, result: Float64Array) {
    applyNegLaplacian(phi, result);
    for (let i = 0; i < N; i++) result[i] -= sigma * phi[i];
  }

  function solveCG(rhs: Float64Array, x: Float64Array, maxIter: number = 200, tol: number = 1e-8) {
    const Ax = new Float64Array(N);
    applyShiftedOp(x, Ax);
    const r = new Float64Array(N);
    for (let i = 0; i < N; i++) r[i] = rhs[i] - Ax[i];
    const p = new Float64Array(r);
    let rDot = 0;
    for (let i = 0; i < N; i++) rDot += r[i] * r[i];
    const rhsNorm = Math.sqrt(rhs.reduce((s, v) => s + v * v, 0));
    if (rhsNorm < 1e-20) return;

    const Ap = new Float64Array(N);
    for (let iter = 0; iter < maxIter; iter++) {
      if (Math.sqrt(rDot) < tol * rhsNorm) break;
      applyShiftedOp(p, Ap);
      let pAp = 0;
      for (let i = 0; i < N; i++) pAp += p[i] * Ap[i];
      if (Math.abs(pAp) < 1e-20) break;
      const alpha = rDot / pAp;
      for (let i = 0; i < N; i++) x[i] += alpha * p[i];
      for (let i = 0; i < N; i++) r[i] -= alpha * Ap[i];
      let rDotNew = 0;
      for (let i = 0; i < N; i++) rDotNew += r[i] * r[i];
      const beta = rDotNew / rDot;
      for (let i = 0; i < N; i++) p[i] = r[i] + beta * p[i];
      rDot = rDotNew;
    }
  }

  const wantedModes = Math.min(numModes, Math.floor(N / 2));
  const eigenvalues: number[] = [];
  const eigenvectors: Float64Array[] = [];
  const found: Float64Array[] = [];

  for (let modeIdx = 0; modeIdx < wantedModes; modeIdx++) {
    let v = new Float64Array(N);
    for (let i = 0; i < N; i++) v[i] = Math.random() - 0.5;

    for (const f of found) {
      let dot = 0;
      for (let i = 0; i < N; i++) dot += v[i] * f[i];
      for (let i = 0; i < N; i++) v[i] -= dot * f[i];
    }

    let norm = 0;
    for (let i = 0; i < N; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm < 1e-15) continue;
    for (let i = 0; i < N; i++) v[i] /= norm;

    let eigenvalue = 0;

    for (let iter = 0; iter < 50; iter++) {
      const w = new Float64Array(N);
      solveCG(v, w, 200, 1e-8);

      for (const f of found) {
        let dot = 0;
        for (let i = 0; i < N; i++) dot += w[i] * f[i];
        for (let i = 0; i < N; i++) w[i] -= dot * f[i];
      }

      norm = 0;
      for (let i = 0; i < N; i++) norm += w[i] * w[i];
      norm = Math.sqrt(norm);
      if (norm < 1e-15) break;
      for (let i = 0; i < N; i++) v[i] = w[i] / norm;

      const Av = new Float64Array(N);
      applyNegLaplacian(v, Av);
      eigenvalue = 0;
      for (let i = 0; i < N; i++) eigenvalue += v[i] * Av[i];
    }

    eigenvalues.push(eigenvalue);
    eigenvectors.push(new Float64Array(v));
    found.push(new Float64Array(v));
  }

  const sortedIndices = eigenvalues.map((_, i) => i).sort((a, b) => eigenvalues[a] - eigenvalues[b]);

  const modes: RoomMode[] = [];
  for (const si of sortedIndices) {
    const k2 = Math.abs(eigenvalues[si]);
    if (k2 < 1e-6) continue;
    const freq = (c / (2 * Math.PI)) * Math.sqrt(k2);
    if (freq > fMax || freq < 1) continue;

    let bestN = 0, bestM = 0, bestL = 0;
    const nMax = Math.ceil(2 * freq * room.length / c);
    const mMax = Math.ceil(2 * freq * room.width / c);
    const lMaxV = Math.ceil(2 * freq * maxH / c);
    let bestDiff = Infinity;
    for (let nn = 0; nn <= nMax; nn++) {
      for (let mm = 0; mm <= mMax; mm++) {
        for (let ll = 0; ll <= lMaxV; ll++) {
          if (nn === 0 && mm === 0 && ll === 0) continue;
          const fTest = (c / 2) * Math.sqrt((nn / room.length) ** 2 + (mm / room.width) ** 2 + (ll / maxH) ** 2);
          const diff = Math.abs(fTest - freq);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestN = nn; bestM = mm; bestL = ll;
          }
        }
      }
    }

    modes.push({
      n: bestN, m: bestM, l: bestL,
      frequency: freq,
      type: classifyMode(bestN, bestM, bestL),
      Q: 10,
      T60: 6.91 * 10 / (Math.PI * freq),
      amplitude: 1,
      matched: false,
      modeShape: eigenvectors[si],
    });
  }

  _lastGrid = { nx, ny, nz, dx, dy, dz, nodeCoords: [], insideNodes, nodeIndex };

  modes.sort((a, b) => a.frequency - b.frequency);
  return modes;
}

function fftReal(samples: Float64Array): { re: Float64Array; im: Float64Array } {
  const n = samples.length;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(samples);

  const bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i++) {
    let j = 0;
    for (let b = 0; b < bits; b++) {
      j = (j << 1) | ((i >> b) & 1);
    }
    if (j > i) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const angle = -2 * Math.PI / size;
    const wR = Math.cos(angle);
    const wI = Math.sin(angle);
    for (let i = 0; i < n; i += size) {
      let curR = 1, curI = 0;
      for (let j = 0; j < halfSize; j++) {
        const tR = curR * re[i + j + halfSize] - curI * im[i + j + halfSize];
        const tI = curR * im[i + j + halfSize] + curI * re[i + j + halfSize];
        re[i + j + halfSize] = re[i + j] - tR;
        im[i + j + halfSize] = im[i + j] - tI;
        re[i + j] += tR;
        im[i + j] += tI;
        const newR = curR * wR - curI * wI;
        curI = curR * wI + curI * wR;
        curR = newR;
      }
    }
  }

  return { re, im };
}

export function extractModalPeaksFromIR(
  irData: IRData,
  fMin: number,
  fMax: number,
  minSepHz: number = 5
): ModalPeak[] {
  const sr = irData.sampleRate;
  const samples = irData.samples;

  let maxIdx = 0;
  let maxVal = 0;
  for (let i = 0; i < Math.min(samples.length, sr * 0.2); i++) {
    if (Math.abs(samples[i]) > maxVal) {
      maxVal = Math.abs(samples[i]);
      maxIdx = i;
    }
  }

  const windowLenSec = 1.0;
  const windowLen = Math.min(Math.round(windowLenSec * sr), samples.length - maxIdx);
  let fftSize = 1;
  while (fftSize < windowLen * 2) fftSize *= 2;

  const windowed = new Float64Array(fftSize);
  for (let i = 0; i < windowLen; i++) {
    const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (windowLen - 1)));
    windowed[i] = samples[maxIdx + i] * w;
  }

  const { re, im } = fftReal(windowed);

  const freqRes = sr / fftSize;
  const iMin = Math.max(1, Math.floor(fMin / freqRes));
  const iMax = Math.min(fftSize / 2, Math.ceil(fMax / freqRes));

  const mag = new Float64Array(iMax + 1);
  let magMax = 0;
  for (let i = iMin; i <= iMax; i++) {
    mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    if (mag[i] > magMax) magMax = mag[i];
  }

  const magDB = new Float64Array(iMax + 1);
  for (let i = iMin; i <= iMax; i++) {
    magDB[i] = 20 * Math.log10(mag[i] / (magMax || 1) + 1e-12);
  }

  const peaks: { idx: number; freq: number; ampDB: number }[] = [];
  const minSepBins = Math.max(1, Math.round(minSepHz / freqRes));

  for (let i = iMin + 1; i < iMax; i++) {
    if (magDB[i] > magDB[i - 1] && magDB[i] > magDB[i + 1] && magDB[i] > -40) {
      let tooClose = false;
      for (const p of peaks) {
        if (Math.abs(p.idx - i) < minSepBins) {
          if (magDB[i] > p.ampDB) {
            peaks.splice(peaks.indexOf(p), 1);
          } else {
            tooClose = true;
          }
          break;
        }
      }
      if (!tooClose) {
        peaks.push({ idx: i, freq: i * freqRes, ampDB: magDB[i] });
      }
    }
  }

  peaks.sort((a, b) => b.ampDB - a.ampDB);
  const topPeaks = peaks.slice(0, 50);

  const modalPeaks: ModalPeak[] = topPeaks.map(p => {
    const Q = fitLorentzianQ(magDB, p.idx, freqRes, iMin, iMax);
    const tau = Q / (Math.PI * p.freq);
    const T60 = 6.91 * tau;
    return {
      frequency: p.freq,
      amplitude: p.ampDB,
      Q,
      T60,
      matchedModeIndex: -1,
    };
  });

  modalPeaks.sort((a, b) => a.frequency - b.frequency);
  return modalPeaks;
}

function fitLorentzianQ(magDB: Float64Array, peakIdx: number, freqRes: number, iMin: number, iMax: number): number {
  const peakVal = magDB[peakIdx];
  const target3dB = peakVal - 3;

  let leftIdx = peakIdx;
  for (let i = peakIdx - 1; i >= iMin; i--) {
    if (magDB[i] <= target3dB) { leftIdx = i; break; }
    if (magDB[i] > magDB[i + 1]) { leftIdx = i + 1; break; }
  }

  let rightIdx = peakIdx;
  for (let i = peakIdx + 1; i <= iMax; i++) {
    if (magDB[i] <= target3dB) { rightIdx = i; break; }
    if (magDB[i] > magDB[i - 1]) { rightIdx = i - 1; break; }
  }

  const bw = (rightIdx - leftIdx) * freqRes;
  if (bw < freqRes) return 5;
  const Q = (peakIdx * freqRes) / bw;
  return Math.max(2, Math.min(100, Q));
}

export function matchModesToPeaks(modes: RoomMode[], peaks: ModalPeak[], toleranceHz: number = 10): void {
  const usedPeaks = new Set<number>();
  for (let mi = 0; mi < modes.length; mi++) {
    let bestPi = -1;
    let bestDiff = Infinity;
    for (let pi = 0; pi < peaks.length; pi++) {
      if (usedPeaks.has(pi)) continue;
      const diff = Math.abs(modes[mi].frequency - peaks[pi].frequency);
      if (diff < bestDiff && diff < toleranceHz) {
        bestDiff = diff;
        bestPi = pi;
      }
    }
    if (bestPi >= 0) {
      modes[mi].matched = true;
      modes[mi].measuredFreq = peaks[bestPi].frequency;
      modes[mi].measuredQ = peaks[bestPi].Q;
      modes[mi].measuredAmplitude = peaks[bestPi].amplitude;
      modes[mi].amplitude = Math.pow(10, peaks[bestPi].amplitude / 20);
      modes[mi].Q = peaks[bestPi].Q;
      modes[mi].T60 = peaks[bestPi].T60;
      peaks[bestPi].matchedModeIndex = mi;
      usedPeaks.add(bestPi);
    }
  }
}

function evalModeShape(mode: RoomMode, room: RoomDimensions, x: number, y: number, z: number, useEigenvector: boolean): number {
  if (useEigenvector && mode.modeShape && _lastGrid) {
    return interpolateEigenvector(mode.modeShape, x, y, z, _lastGrid);
  }
  return cuboidModeShape(mode.n, mode.m, mode.l, room, x, y, z);
}

export function computeDrivenResponse(
  modes: RoomMode[],
  room: RoomDimensions,
  sourcePos: Point3D,
  receiverPos: Point3D,
  freqs: number[],
  ceiling?: CeilingConfig
): { freq: number; dB: number }[] {
  const useEV = !!(ceiling && ceiling.type !== 'flat' && _lastGrid);
  return freqs.map(f => {
    let pRe = 0, pIm = 0;
    for (const mode of modes) {
      const phiS = evalModeShape(mode, room, sourcePos.x, sourcePos.y, sourcePos.z, useEV);
      const phiR = evalModeShape(mode, room, receiverPos.x, receiverPos.y, receiverPos.z, useEV);

      const fi = mode.frequency;
      const Qi = mode.Q;
      const Ci = mode.amplitude * phiS;
      const denomRe = fi * fi - f * f;
      const denomIm = f * fi / Qi;
      const denomMag2 = denomRe * denomRe + denomIm * denomIm;
      if (denomMag2 < 1e-20) continue;

      const numRe = Ci * phiR;
      pRe += (numRe * denomRe) / denomMag2;
      pIm += (numRe * denomIm) / denomMag2;
    }
    const mag = Math.sqrt(pRe * pRe + pIm * pIm);
    return { freq: f, dB: 20 * Math.log10(mag + 1e-12) };
  });
}

export function computePressureMap(
  modes: RoomMode[],
  room: RoomDimensions,
  sourcePos: Point3D,
  freq: number,
  sliceType: 'top' | 'side',
  sliceValue: number,
  resolution: number = 40,
  ceiling?: CeilingConfig
): PressureMapData {
  const isFlat = !ceiling || ceiling.type === 'flat';
  let uRange: [number, number], vRange: [number, number];
  let uAxis: string, vAxis: string;
  let gridWidth: number, gridHeight: number;

  if (sliceType === 'top') {
    uRange = [0, room.length];
    vRange = [0, room.width];
    uAxis = 'Depth (X)';
    vAxis = 'Width (Y)';
    gridWidth = resolution;
    gridHeight = Math.max(4, Math.round(resolution * room.width / room.length));
  } else {
    uRange = [0, room.length];
    const maxH = ceiling && ceiling.type !== 'flat' ? ceiling.maxHeight : room.height;
    vRange = [0, maxH];
    uAxis = 'Depth (X)';
    vAxis = 'Height (Z)';
    gridWidth = resolution;
    gridHeight = Math.max(4, Math.round(resolution * maxH / room.length));
  }

  const du = (uRange[1] - uRange[0]) / gridWidth;
  const dv = (vRange[1] - vRange[0]) / gridHeight;
  const grid: number[][] = [];
  let minVal = Infinity, maxVal = -Infinity;

  for (let j = 0; j < gridHeight; j++) {
    const row: number[] = [];
    for (let i = 0; i < gridWidth; i++) {
      const u = uRange[0] + (i + 0.5) * du;
      const v = vRange[0] + (j + 0.5) * dv;

      let x: number, y: number, z: number;
      if (sliceType === 'top') {
        x = u; y = v; z = sliceValue;
      } else {
        x = u; y = sliceValue; z = v;
      }

      if (!isFlat && sliceType === 'side') {
        const ceilH = getCeilingHeightAt(x, y, room, ceiling!);
        if (z > ceilH) {
          row.push(-999);
          continue;
        }
      }

      const useEV = !!(ceiling && ceiling.type !== 'flat' && _lastGrid);
      let pRe = 0, pIm = 0;
      for (const mode of modes) {
        const phiS = evalModeShape(mode, room, sourcePos.x, sourcePos.y, sourcePos.z, useEV);
        const phiR = evalModeShape(mode, room, x, y, z, useEV);
        const fi = mode.frequency;
        const Qi = mode.Q;
        const Ci = mode.amplitude * phiS;
        const denomRe = fi * fi - freq * freq;
        const denomIm = freq * fi / Qi;
        const denomMag2 = denomRe * denomRe + denomIm * denomIm;
        if (denomMag2 < 1e-20) continue;
        pRe += (Ci * phiR * denomRe) / denomMag2;
        pIm += (Ci * phiR * denomIm) / denomMag2;
      }

      const mag = Math.sqrt(pRe * pRe + pIm * pIm);
      const dB = 20 * Math.log10(mag + 1e-12);
      row.push(dB);
      if (dB < minVal) minVal = dB;
      if (dB > maxVal) maxVal = dB;
    }
    grid.push(row);
  }

  return { grid, gridWidth, gridHeight, uRange, vRange, uAxis, vAxis, minVal, maxVal };
}

export function computeGlobalPressureMap(
  modes: RoomMode[],
  room: RoomDimensions,
  sourcePos: Point3D,
  fMin: number,
  fMax: number,
  sliceType: 'top' | 'side',
  sliceValue: number,
  resolution: number = 40,
  ceiling?: CeilingConfig
): PressureMapData {
  const numFreqs = 30;
  const freqs: number[] = [];
  for (let i = 0; i < numFreqs; i++) {
    freqs.push(fMin + (fMax - fMin) * i / (numFreqs - 1));
  }

  let uRange: [number, number], vRange: [number, number];
  let uAxis: string, vAxis: string;
  let gridWidth: number, gridHeight: number;

  if (sliceType === 'top') {
    uRange = [0, room.length];
    vRange = [0, room.width];
    uAxis = 'Depth (X)';
    vAxis = 'Width (Y)';
    gridWidth = resolution;
    gridHeight = Math.max(4, Math.round(resolution * room.width / room.length));
  } else {
    uRange = [0, room.length];
    const maxH = ceiling && ceiling.type !== 'flat' ? ceiling.maxHeight : room.height;
    vRange = [0, maxH];
    uAxis = 'Depth (X)';
    vAxis = 'Height (Z)';
    gridWidth = resolution;
    gridHeight = Math.max(4, Math.round(resolution * maxH / room.length));
  }

  const du = (uRange[1] - uRange[0]) / gridWidth;
  const dv = (vRange[1] - vRange[0]) / gridHeight;
  const grid: number[][] = [];
  let minVal = Infinity, maxVal = -Infinity;

  for (let j = 0; j < gridHeight; j++) {
    const row: number[] = [];
    for (let i = 0; i < gridWidth; i++) {
      const u = uRange[0] + (i + 0.5) * du;
      const v = vRange[0] + (j + 0.5) * dv;

      let x: number, y: number, z: number;
      if (sliceType === 'top') {
        x = u; y = v; z = sliceValue;
      } else {
        x = u; y = sliceValue; z = v;
      }

      if (ceiling && ceiling.type !== 'flat' && sliceType === 'side') {
        const ceilH = getCeilingHeightAt(x, y, room, ceiling);
        if (z > ceilH) { row.push(-999); continue; }
      }

      const response = computeDrivenResponse(modes, room, sourcePos, { x, y, z }, freqs, ceiling);
      const avgDB = response.reduce((s, r) => s + r.dB, 0) / response.length;
      row.push(avgDB);
      if (avgDB < minVal) minVal = avgDB;
      if (avgDB > maxVal) maxVal = avgDB;
    }
    grid.push(row);
  }

  return { grid, gridWidth, gridHeight, uRange, vRange, uAxis, vAxis, minVal, maxVal };
}

function evaluatePosition(
  modes: RoomMode[],
  room: RoomDimensions,
  sourcePoses: Point3D[],
  pos: Point3D,
  freqs: number[],
  ceiling?: CeilingConfig
): { score: number; Jvar: number; Jnull: number; Jpeak: number; Jspatial: number; Jsymmetry: number; responseCurve: { freq: number; dB: number }[] } {
  const allResponses = sourcePoses.map(sp => computeDrivenResponse(modes, room, sp, pos, freqs, ceiling));

  const avgResponse = allResponses[0].map((r, fi) => {
    const avgDB = allResponses.reduce((s, resp) => s + resp[fi].dB, 0) / allResponses.length;
    return { freq: r.freq, dB: avgDB };
  });

  const dBvals = avgResponse.map(r => r.dB);

  const mean = dBvals.reduce((a, b) => a + b, 0) / dBvals.length;
  const variance = Math.sqrt(dBvals.reduce((a, b) => a + (b - mean) ** 2, 0) / dBvals.length);

  const sorted = [...dBvals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];

  let Jnull = 0;
  let Jpeak = 0;
  for (const v of dBvals) {
    Jnull += Math.max(0, (median - 10) - v);
    Jpeak += Math.max(0, v - (median + 6));
  }
  Jnull /= dBvals.length;
  Jpeak /= dBvals.length;

  const spatialOffsets = [
    { dx: -0.1, dy: 0, dz: 0 }, { dx: 0.1, dy: 0, dz: 0 },
    { dx: 0, dy: -0.1, dz: 0 }, { dx: 0, dy: 0.1, dz: 0 },
  ];
  const spatialFreqs = freqs.filter((_, i) => i % 3 === 0);
  let spatialSum = 0;
  for (const freq of spatialFreqs) {
    const vals: number[] = [];
    for (const off of spatialOffsets) {
      const offPos = { x: pos.x + off.dx, y: pos.y + off.dy, z: pos.z + off.dz };
      if (offPos.x < 0 || offPos.x > room.length || offPos.y < 0 || offPos.y > room.width || offPos.z < 0) continue;
      const offResponses = sourcePoses.map(sp => computeDrivenResponse(modes, room, sp, offPos, [freq], ceiling));
      const avgDB = offResponses.reduce((s, r) => s + r[0].dB, 0) / offResponses.length;
      vals.push(avgDB);
    }
    if (vals.length > 1) {
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length);
      spatialSum += sd;
    }
  }
  const Jspatial = spatialSum / Math.max(1, spatialFreqs.length);

  let Jsymmetry = 0;
  if (sourcePoses.length >= 2) {
    const avgY = sourcePoses.reduce((s, sp) => s + sp.y, 0) / sourcePoses.length;
    const yOffset = Math.abs(pos.y - avgY);
    Jsymmetry = yOffset * 5;

    if (allResponses.length >= 2) {
      let responseDiffSum = 0;
      for (let fi = 0; fi < freqs.length; fi++) {
        const diffs = allResponses.map(r => r[fi].dB);
        const maxDiff = Math.max(...diffs) - Math.min(...diffs);
        responseDiffSum += maxDiff;
      }
      Jsymmetry += (responseDiffSum / freqs.length) * 0.5;
    }
  }

  const w1 = 1, w2 = 2, w3 = 1, w4 = 1, w5 = sourcePoses.length >= 2 ? 1.5 : 0;
  const score = w1 * variance + w2 * Jnull + w3 * Jpeak + w4 * Jspatial + w5 * Jsymmetry;

  return { score, Jvar: variance, Jnull, Jpeak, Jspatial, Jsymmetry, responseCurve: avgResponse };
}

export function findOptimalListeningPosition(
  modes: RoomMode[],
  room: RoomDimensions,
  sourcePoses: Point3D[],
  zEar: number,
  fMin: number,
  fMax: number,
  ceiling?: CeilingConfig
): SeatCandidate[] {
  const numFreqs = 80;
  const freqs: number[] = [];
  for (let i = 0; i < numFreqs; i++) {
    freqs.push(fMin + (fMax - fMin) * i / (numFreqs - 1));
  }

  const xMin = 0.2 * room.length;
  const xMax = 0.9 * room.length;
  const xStep = 0.1;
  const yMin = Math.max(0.3, room.width * 0.2);
  const yMax = Math.min(room.width - 0.3, room.width * 0.8);
  const yStep = 0.15;
  const zMin = Math.max(0.5, zEar - 0.25);
  const zMax = Math.min(room.height - 0.3, zEar + 0.25);
  const zStep = 0.1;

  const candidates: SeatCandidate[] = [];

  for (let x = xMin; x <= xMax; x += xStep) {
    for (let y = yMin; y <= yMax; y += yStep) {
      for (let z = zMin; z <= zMax; z += zStep) {
        if (ceiling && ceiling.type !== 'flat') {
          const localCeilH = getCeilingHeightAt(x, y, room, ceiling);
          if (z > localCeilH - 0.1) continue;
        }
        const pos: Point3D = { x, y, z };
        const eval_ = evaluatePosition(modes, room, sourcePoses, pos, freqs, ceiling);
        candidates.push({ x, y, z, ...eval_ });
      }
    }
  }

  candidates.sort((a, b) => a.score - b.score);

  const top: SeatCandidate[] = [];
  for (const c of candidates) {
    const tooClose = top.some(t =>
      Math.abs(t.x - c.x) < 0.15 && Math.abs(t.y - c.y) < 0.2 && Math.abs(t.z - c.z) < 0.15
    );
    if (!tooClose) top.push(c);
    if (top.length >= 5) break;
  }

  return top;
}

export function computeEffectiveVolume(room: RoomDimensions, ceiling?: CeilingConfig): number {
  if (!ceiling || ceiling.type === 'flat') {
    return room.length * room.width * room.height;
  }

  const baseArea = room.length * room.width;
  const hMin = ceiling.minHeight;
  const hMax = ceiling.maxHeight;

  if (ceiling.type === 'slope-x' || ceiling.type === 'slope-y') {
    return baseArea * (hMin + hMax) / 2;
  }

  if (ceiling.type === 'v-x' || ceiling.type === 'v-y') {
    return baseArea * (hMin + hMax) / 2;
  }

  if (ceiling.type === 'vflat-x' || ceiling.type === 'vflat-y') {
    const flatW = ceiling.flatWidth ?? 0;
    const slopeAxis = ceiling.type === 'vflat-x' ? room.length : room.width;
    const slopeWidth = (slopeAxis - flatW) / 2;
    const flatFraction = flatW / slopeAxis;
    const slopeFraction = slopeWidth / slopeAxis;
    const avgHeight = flatFraction * hMax + 2 * slopeFraction * ((hMin + hMax) / 2);
    return baseArea * avgHeight;
  }

  return baseArea * (hMin + hMax) / 2;
}

export function computeSchroederFrequency(room: RoomDimensions, T60: number, ceiling?: CeilingConfig): number {
  const V = computeEffectiveVolume(room, ceiling);
  return 2000 * Math.sqrt(T60 / V);
}

export function runModalAnalysis(
  room: RoomDimensions,
  ceiling: CeilingConfig | undefined,
  sourcePos: Point3D,
  micPos: Point3D,
  irData: IRData,
  speedOfSound: number,
  fMin: number = 20,
  fMax: number = 200,
  earHeight: number = 1.2,
  extraIRs?: FusionIRDataset[],
  allSpeakerPositions?: Point3D[]
): ModalAnalysisResult {
  const isFlat = !ceiling || ceiling.type === 'flat';
  const modes = isFlat
    ? computeCuboidModes(room, speedOfSound, fMax)
    : computeShapedCeilingModes(room, ceiling!, speedOfSound, fMax);

  const mainPeaks = extractModalPeaksFromIR(irData, fMin, fMax, 5);
  let measuredPeaks = mainPeaks;

  if (extraIRs && extraIRs.length > 0) {
    interface PeakCluster { freqSum: number; QSum: number; T60Sum: number; ampMax: number; count: number; }
    const clusters: PeakCluster[] = mainPeaks.map(p => ({
      freqSum: p.frequency, QSum: p.Q, T60Sum: p.T60, ampMax: p.amplitude, count: 1,
    }));
    for (const ds of extraIRs) {
      const extraPeaks = extractModalPeaksFromIR(ds.irData, fMin, fMax, 5);
      for (const ep of extraPeaks) {
        const existing = clusters.find(c => Math.abs(c.freqSum / c.count - ep.frequency) < 3);
        if (existing) {
          existing.freqSum += ep.frequency;
          existing.QSum += ep.Q;
          existing.T60Sum += ep.T60;
          existing.ampMax = Math.max(existing.ampMax, ep.amplitude);
          existing.count++;
        } else {
          clusters.push({ freqSum: ep.frequency, QSum: ep.Q, T60Sum: ep.T60, ampMax: ep.amplitude, count: 1 });
        }
      }
    }
    measuredPeaks = clusters.map(c => ({
      frequency: c.freqSum / c.count,
      Q: c.QSum / c.count,
      T60: c.T60Sum / c.count,
      amplitude: c.ampMax,
    }));
    measuredPeaks.sort((a, b) => a.frequency - b.frequency);
  }

  matchModesToPeaks(modes, measuredPeaks, 10);

  const avgT60 = modes.filter(m => m.matched).reduce((s, m) => s + m.T60, 0) /
    Math.max(1, modes.filter(m => m.matched).length) || 0.5;
  const schroederFreq = computeSchroederFrequency(room, avgT60, ceiling);

  const selectedModeIndex = modes.length > 0 ? 0 : -1;
  const selectedFreq = selectedModeIndex >= 0 ? modes[selectedModeIndex].frequency : fMin;

  const pressureMapTop = computePressureMap(modes, room, sourcePos, selectedFreq, 'top', earHeight, 40, ceiling);
  const pressureMapSide = computePressureMap(modes, room, sourcePos, selectedFreq, 'side', room.width / 2, 40, ceiling);

  const globalPressureMapTop = computeGlobalPressureMap(modes, room, sourcePos, fMin, fMax, 'top', earHeight, 40, ceiling);
  const globalPressureMapSide = computeGlobalPressureMap(modes, room, sourcePos, fMin, fMax, 'side', room.width / 2, 40, ceiling);

  const seatSourcePoses = allSpeakerPositions && allSpeakerPositions.length > 0
    ? allSpeakerPositions : [sourcePos];
  const seatCandidates = findOptimalListeningPosition(modes, room, seatSourcePoses, earHeight, fMin, fMax, ceiling);
  const bestSeat = seatCandidates.length > 0 ? seatCandidates[0] : undefined;

  const freqs: number[] = [];
  for (let i = 0; i < 100; i++) freqs.push(fMin + (fMax - fMin) * i / 99);
  const currentSeatResponse = computeDrivenResponse(modes, room, sourcePos, micPos, freqs, ceiling);

  return {
    modes,
    measuredPeaks,
    schroederFreq,
    pressureMapTop,
    pressureMapSide,
    globalPressureMapTop,
    globalPressureMapSide,
    seatCandidates,
    bestSeat,
    currentSeatResponse,
    selectedModeIndex,
    fMin,
    fMax,
  };
}
