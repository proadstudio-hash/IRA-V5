import type { MatchedPeak, RoomDimensions, Point3D, CeilingConfig } from "@shared/schema";
import { getCeilingHeightAt } from "./geometry";

export interface HeatmapCell {
  u: number;
  v: number;
  value: number;
}

export interface HeatmapHotspot {
  u: number;
  v: number;
  x: number;
  y: number;
  z: number;
  value: number;
}

export interface SurfaceHeatmap {
  surfaceLabel: string;
  grid: HeatmapCell[][];
  gridWidth: number;
  gridHeight: number;
  uRange: [number, number];
  vRange: [number, number];
  uAxis: 'x' | 'y' | 'z';
  vAxis: 'x' | 'y' | 'z';
  hLabel: string;
  vLabel: string;
  reverseH: boolean;
  reverseV: boolean;
  maxValue: number;
  hotspots: HeatmapHotspot[];
  reflectionPoints: { u: number; v: number; delay_ms: number; rel_dB: number }[];
  ceilingProfile?: { u: number; v: number }[];
}

interface SurfaceProjection {
  label: string;
  uAxis: 'x' | 'y' | 'z';
  vAxis: 'x' | 'y' | 'z';
  hLabel: string;
  vLabel: string;
  reverseH: boolean;
  reverseV: boolean;
  uRange: [number, number];
  vRange: [number, number];
  project: (p: Point3D) => { u: number; v: number };
  unproject: (u: number, v: number) => Point3D;
}

function getSurfaceProjections(room: RoomDimensions, ceiling?: CeilingConfig): SurfaceProjection[] {
  const maxH = ceiling && ceiling.type !== 'flat' ? ceiling.maxHeight : room.height;
  return [
    {
      label: 'Front Wall',
      uAxis: 'y', vAxis: 'z',
      hLabel: 'Width (Y)', vLabel: 'Height (Z)',
      reverseH: true, reverseV: false,
      uRange: [0, room.width], vRange: [0, maxH],
      project: (p) => ({ u: p.y, v: p.z }),
      unproject: (u, v) => ({ x: 0, y: u, z: v }),
    },
    {
      label: 'Rear Wall',
      uAxis: 'y', vAxis: 'z',
      hLabel: 'Width (Y)', vLabel: 'Height (Z)',
      reverseH: false, reverseV: false,
      uRange: [0, room.width], vRange: [0, maxH],
      project: (p) => ({ u: p.y, v: p.z }),
      unproject: (u, v) => ({ x: room.length, y: u, z: v }),
    },
    {
      label: 'Right Wall',
      uAxis: 'x', vAxis: 'z',
      hLabel: 'Length (X)', vLabel: 'Height (Z)',
      reverseH: false, reverseV: false,
      uRange: [0, room.length], vRange: [0, maxH],
      project: (p) => ({ u: p.x, v: p.z }),
      unproject: (u, v) => ({ x: u, y: 0, z: v }),
    },
    {
      label: 'Left Wall',
      uAxis: 'x', vAxis: 'z',
      hLabel: 'Length (X)', vLabel: 'Height (Z)',
      reverseH: true, reverseV: false,
      uRange: [0, room.length], vRange: [0, maxH],
      project: (p) => ({ u: p.x, v: p.z }),
      unproject: (u, v) => ({ x: u, y: room.width, z: v }),
    },
    {
      label: 'Floor',
      uAxis: 'y', vAxis: 'x',
      hLabel: 'Width (Y)', vLabel: 'Length (X)',
      reverseH: true, reverseV: true,
      uRange: [0, room.width], vRange: [0, room.length],
      project: (p) => ({ u: p.y, v: p.x }),
      unproject: (u, v) => ({ x: v, y: u, z: 0 }),
    },
    {
      label: 'Ceiling',
      uAxis: 'y', vAxis: 'x',
      hLabel: 'Width (Y)', vLabel: 'Length (X)',
      reverseH: true, reverseV: true,
      uRange: [0, room.width], vRange: [0, room.length],
      project: (p) => ({ u: p.y, v: p.x }),
      unproject: (u, v) => ({ x: v, y: u, z: ceiling ? getCeilingHeightAt(v, u, room, ceiling) : room.height }),
    },
  ];
}

export function computeSurfaceHeatmaps(
  matchedPeaks: MatchedPeak[],
  room: RoomDimensions,
  speedOfSound: number,
  toleranceMs: number,
  gridResolution: number = 30,
  ceiling?: CeilingConfig
): SurfaceHeatmap[] {
  const projections = getSurfaceProjections(room, ceiling);
  const sigma = (toleranceMs / 1000) * speedOfSound * 0.5;
  const alpha = 1.0;
  const beta = 0.02;

  const heatmaps: SurfaceHeatmap[] = [];

  for (const proj of projections) {
    const assignedPeaks = matchedPeaks.filter(mp => {
      if (!mp.assigned || !mp.reflection) return false;
      const label = mp.reflection.surfaceLabel;
      if (label === proj.label) return true;
      if (label.includes('→')) {
        const lastSurface = label.split('→').pop()!.trim();
        return lastSurface === proj.label;
      }
      return false;
    });

    const uLen = proj.uRange[1] - proj.uRange[0];
    const vLen = proj.vRange[1] - proj.vRange[0];
    const nx = Math.max(5, Math.min(gridResolution, Math.round(gridResolution * uLen / Math.max(uLen, vLen))));
    const ny = Math.max(5, Math.min(gridResolution, Math.round(gridResolution * vLen / Math.max(uLen, vLen))));
    const du = uLen / nx;
    const dv = vLen / ny;

    const grid: HeatmapCell[][] = [];
    let maxVal = 0;

    for (let j = 0; j < ny; j++) {
      const row: HeatmapCell[] = [];
      for (let i = 0; i < nx; i++) {
        const u = proj.uRange[0] + (i + 0.5) * du;
        const v = proj.vRange[0] + (j + 0.5) * dv;
        let heat = 0;

        for (const mp of assignedPeaks) {
          if (!mp.reflection) continue;
          const pStar = proj.project(mp.reflection.reflectionPoint);
          if (pStar.u < proj.uRange[0] - sigma * 3 || pStar.u > proj.uRange[1] + sigma * 3 ||
              pStar.v < proj.vRange[0] - sigma * 3 || pStar.v > proj.vRange[1] + sigma * 3) continue;
          const distU = u - pStar.u;
          const distV = v - pStar.v;

          const weight = Math.exp(alpha * (mp.peak.rel_dB / 20)) * Math.exp(-beta * mp.peak.delay_ms);
          const gaussian = Math.exp(-(distU * distU + distV * distV) / (2 * sigma * sigma));
          heat += weight * gaussian;
        }

        if (heat > maxVal) maxVal = heat;
        row.push({ u, v, value: heat });
      }
      grid.push(row);
    }

    if (maxVal > 0) {
      for (const row of grid) {
        for (const cell of row) {
          cell.value /= maxVal;
        }
      }
    }

    const hotspots: HeatmapHotspot[] = [];
    const flatCells = grid.flat().filter(c => c.value > 0.3);
    flatCells.sort((a, b) => b.value - a.value);

    const usedSpots: { u: number; v: number }[] = [];
    for (const cell of flatCells) {
      if (hotspots.length >= 3) break;
      const tooClose = usedSpots.some(s =>
        Math.abs(s.u - cell.u) < du * 2 && Math.abs(s.v - cell.v) < dv * 2
      );
      if (tooClose) continue;

      const xyz = proj.unproject(cell.u, cell.v);
      hotspots.push({
        u: cell.u,
        v: cell.v,
        x: xyz.x,
        y: xyz.y,
        z: xyz.z,
        value: cell.value,
      });
      usedSpots.push({ u: cell.u, v: cell.v });
    }

    const tol = 0.05;
    const reflectionPoints = assignedPeaks
      .filter(mp => mp.reflection)
      .map(mp => {
        const projected = proj.project(mp.reflection!.reflectionPoint);
        return {
          u: projected.u,
          v: projected.v,
          delay_ms: mp.peak.delay_ms,
          rel_dB: mp.peak.rel_dB,
        };
      })
      .filter(rp =>
        rp.u >= proj.uRange[0] - tol && rp.u <= proj.uRange[1] + tol &&
        rp.v >= proj.vRange[0] - tol && rp.v <= proj.vRange[1] + tol
      );

    let ceilingProfile: { u: number; v: number }[] | undefined;
    if (ceiling && ceiling.type !== 'flat' && proj.vAxis === 'z') {
      const wallSteps = 30;
      const pts: { u: number; v: number }[] = [];
      for (let si = 0; si <= wallSteps; si++) {
        const t = si / wallSteps;
        const uVal = proj.uRange[0] + t * uLen;
        let z: number;
        if (proj.label === 'Front Wall') {
          z = getCeilingHeightAt(0, uVal, room, ceiling);
        } else if (proj.label === 'Rear Wall') {
          z = getCeilingHeightAt(room.length, uVal, room, ceiling);
        } else if (proj.label === 'Right Wall') {
          z = getCeilingHeightAt(uVal, 0, room, ceiling);
        } else {
          z = getCeilingHeightAt(uVal, room.width, room, ceiling);
        }
        pts.push({ u: uVal, v: z });
      }
      ceilingProfile = pts;
    }

    heatmaps.push({
      surfaceLabel: proj.label,
      grid,
      gridWidth: nx,
      gridHeight: ny,
      uRange: proj.uRange as [number, number],
      vRange: proj.vRange as [number, number],
      uAxis: proj.uAxis,
      vAxis: proj.vAxis,
      hLabel: proj.hLabel,
      vLabel: proj.vLabel,
      reverseH: proj.reverseH,
      reverseV: proj.reverseV,
      maxValue: maxVal > 0 ? 1 : 0,
      hotspots,
      reflectionPoints,
      ceilingProfile,
    });
  }

  return heatmaps;
}
