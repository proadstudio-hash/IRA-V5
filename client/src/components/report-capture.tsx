import { forwardRef, useImperativeHandle, useRef, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ReferenceLine, ReferenceArea, ResponsiveContainer, Legend
} from "recharts";
import type { ETCPoint, MatchedPeak, SurfaceSummary, RoomDimensions, SpeakerConfig, Point3D, IRData, FusionIRDataset, Peak, CeilingConfig, RoomObject, ModalAnalysisResult, PressureMapData } from "@shared/schema";
import { computeDecayMetrics } from "@/lib/decay-metrics";
import { computeClarityMetrics } from "@/lib/clarity-metrics";
import { computeFrequencyResponse, computeCombSignatures } from "@/lib/frequency-analysis";
import { computeScorecard } from "@/lib/scorecard";
import { analyzeUnassignedPeaks } from "@/lib/unassigned-diagnostics";
import { computeSurfaceHeatmaps } from "@/lib/surface-heatmaps";
import { getCeilingHeightAt } from "@/lib/geometry";
import { findDirectArrival, computeETC } from "@/lib/dsp";
import { mergeAndDeduplicatePeaks } from "@/components/results-tables";
import { computeSurfaceSummaries } from "@/lib/matching";
import { computePressureMap, computeDrivenResponse } from "@/lib/modal-analysis";

interface ReportCaptureProps {
  etcData: ETCPoint[];
  matchedPeaks: MatchedPeak[];
  surfaceSummaries: SurfaceSummary[];
  earlyWindowMs: number;
  thresholdDb: number;
  room: RoomDimensions;
  speakers: SpeakerConfig[];
  micPosition: Point3D;
  mic2Position?: Point3D | null;
  speedOfSound: number;
  mode: 'ir-only' | 'geometry';
  peakMatchTolerance: number;
  irData: IRData | null;
  surfaceWeights?: Record<string, number>;
  surfaceMaterials?: Record<string, string>;
  fusionDatasets?: FusionIRDataset[];
  fusionOverlayPeaks?: MatchedPeak[];
  fusionMatchedPeaks?: MatchedPeak[];
  fusionPerIRPeaks?: { label: string; peaks: Peak[] }[];
  ceiling?: CeilingConfig;
  roomObjects?: RoomObject[];
  modalResult?: ModalAnalysisResult | null;
}

export interface ReportCaptureHandle {
  getEtcElement: () => HTMLElement | null;
  getRoomTopElement: () => HTMLElement | null;
  getRoomSideElement: () => HTMLElement | null;
  getRoomSurfaceElement: () => HTMLElement | null;
  getPeakTableElement: () => HTMLElement | null;
  getSurfaceTableElement: () => HTMLElement | null;
  getDecayChartElement: () => HTMLElement | null;
  getFrequencyChartElement: () => HTMLElement | null;
  getScorecardElement: () => HTMLElement | null;
  getClarityElement: () => HTMLElement | null;
  getUnassignedElement: () => HTMLElement | null;
  getHeatmapElement: () => HTMLElement | null;
  getCriticalZoneElement: () => HTMLElement | null;
  getModalElement: () => HTMLElement | null;
  getModalFreqResponseElement: () => HTMLElement | null;
  getModalMapsElement: () => HTMLElement | null;
  getModalCriticalMapsElement: () => HTMLElement | null;
  getModalGlobalElement: () => HTMLElement | null;
  getModalSeatElement: () => HTMLElement | null;
}

const FUSION_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981'];

const SURFACE_COLORS: Record<string, string> = {
  'Front Wall': '#e74c3c',
  'Rear Wall': '#3498db',
  'Left Wall': '#2ecc71',
  'Right Wall': '#9b59b6',
  'Floor': '#f39c12',
  'Ceiling': '#e74c3c',
};

function getSurfaceColor(label: string): string {
  for (const key of Object.keys(SURFACE_COLORS)) {
    if (label.includes(key)) return SURFACE_COLORS[key];
  }
  return '#999999';
}

function genTicks(length: number, step: number): number[] {
  const ticks: number[] = [];
  for (let v = 0; v <= length + 0.001; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

const thStyle: React.CSSProperties = { border: '1px solid #ddd', padding: '4px', textAlign: 'left' as const, fontSize: '10px', background: '#f0f0f0' };
const tdStyle: React.CSSProperties = { border: '1px solid #ddd', padding: '3px', fontSize: '10px' };

function getReportObjectPolygon(obj: RoomObject, viewMode: 'top' | 'side'): Point3D[] {
  const rad = (obj.angle * Math.PI) / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const pos = obj.position;
  const dxDir = { x: cosA, y: sinA };
  const dyDir = { x: -sinA, y: cosA };
  const hd = obj.depth / 2;
  const hw = obj.width / 2;
  const hh = obj.height / 2;

  if (viewMode === 'top') {
    if (obj.type === 'monitor') {
      return [
        { x: pos.x + hw * dyDir.x, y: pos.y + hw * dyDir.y, z: pos.z },
        { x: pos.x - hw * dyDir.x, y: pos.y - hw * dyDir.y, z: pos.z },
      ];
    }
    return [
      { x: pos.x + hd * dxDir.x + hw * dyDir.x, y: pos.y + hd * dxDir.y + hw * dyDir.y, z: pos.z },
      { x: pos.x + hd * dxDir.x - hw * dyDir.x, y: pos.y + hd * dxDir.y - hw * dyDir.y, z: pos.z },
      { x: pos.x - hd * dxDir.x - hw * dyDir.x, y: pos.y - hd * dxDir.y - hw * dyDir.y, z: pos.z },
      { x: pos.x - hd * dxDir.x + hw * dyDir.x, y: pos.y - hd * dxDir.y + hw * dyDir.y, z: pos.z },
    ];
  } else {
    const corners: { x: number; z: number }[] = [];
    if (obj.type === 'desk') {
      for (const sd of [-1, 1]) {
        for (const sw of [-1, 1]) {
          corners.push({ x: pos.x + sd * hd * dxDir.x + sw * hw * dyDir.x, z: pos.z });
        }
      }
    } else if (obj.type === 'monitor') {
      for (const sw of [-1, 1]) {
        for (const sh of [-1, 1]) {
          corners.push({ x: pos.x + sw * hw * dyDir.x, z: pos.z + sh * hh });
        }
      }
    } else {
      for (const sd of [-1, 1]) {
        for (const sw of [-1, 1]) {
          for (const sh of [-1, 1]) {
            corners.push({ x: pos.x + sd * hd * dxDir.x + sw * hw * dyDir.x, z: pos.z + sh * hh });
          }
        }
      }
    }
    const xs = corners.map(c => c.x);
    const zs = corners.map(c => c.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    return [
      { x: minX, y: pos.y, z: maxZ },
      { x: maxX, y: pos.y, z: maxZ },
      { x: maxX, y: pos.y, z: minZ },
      { x: minX, y: pos.y, z: minZ },
    ];
  }
}

function RoomSVG({ room, speakers, micPosition, mic2Position, matchedPeaks, fusionOverlayPeaks, viewMode, ceiling, roomObjects }: {
  room: RoomDimensions;
  speakers: SpeakerConfig[];
  micPosition: Point3D;
  mic2Position?: Point3D | null;
  matchedPeaks: MatchedPeak[];
  fusionOverlayPeaks?: MatchedPeak[];
  viewMode: 'top' | 'side';
  ceiling?: CeilingConfig;
  roomObjects?: RoomObject[];
}) {
  const padding = 70;
  const svgWidth = 640;
  const svgHeight = 460;

  const maxCeilingH = ceiling && ceiling.type !== 'flat' ? ceiling.maxHeight : room.height;
  const roomW = viewMode === 'top' ? room.width : room.length;
  const roomH = viewMode === 'top' ? room.length : maxCeilingH;
  const availW = svgWidth - padding * 2;
  const availH = svgHeight - padding * 2;
  const scaleX = availW / roomW;
  const scaleY = availH / roomH;
  const s = Math.min(scaleX, scaleY);
  const offsetX = padding + (availW - roomW * s) / 2;
  const offsetY = padding + (availH - roomH * s) / 2;

  const clampToRoom = (p: Point3D): Point3D => ({
    x: Math.max(0, Math.min(p.x, room.length)),
    y: Math.max(0, Math.min(p.y, room.width)),
    z: Math.max(0, Math.min(p.z, maxCeilingH)),
  });

  const toSVG = (p: Point3D, clamp: boolean = false): { x: number; y: number } => {
    const pt = clamp ? clampToRoom(p) : p;
    if (viewMode === 'top') {
      return { x: offsetX + (room.width - pt.y) * s, y: offsetY + pt.x * s };
    }
    return { x: offsetX + pt.x * s, y: offsetY + (roomH - pt.z) * s };
  };

  const surfaceLabels = viewMode === 'side'
    ? ['Front Wall', 'Rear Wall', 'Floor', 'Ceiling']
    : ['Front Wall', 'Rear Wall', 'Left Wall', 'Right Wall'];

  const assignedPeaks = matchedPeaks.filter(mp => mp.assigned && mp.reflection).slice(0, 10);

  return (
    <svg width={svgWidth} height={svgHeight} xmlns="http://www.w3.org/2000/svg" style={{ background: '#fff' }}>
      {viewMode === 'side' && ceiling && ceiling.type !== 'flat' ? (
        <g>
          <polygon
            points={(() => {
              const pts: string[] = [];
              pts.push(`${offsetX},${offsetY + roomH * s}`);
              pts.push(`${offsetX + roomW * s},${offsetY + roomH * s}`);
              const steps = 40;
              for (let i = steps; i >= 0; i--) {
                const x = (i / steps) * room.length;
                const z = getCeilingHeightAt(x, room.width / 2, room, ceiling);
                const svgX = offsetX + x * s;
                const svgY = offsetY + (roomH - z) * s;
                pts.push(`${svgX},${svgY}`);
              }
              return pts.join(' ');
            })()}
            fill="none" stroke="#333" strokeWidth="2"
          />
          {(ceiling.type === 'slope-y' || ceiling.type === 'v-x' || ceiling.type === 'vflat-x') && (() => {
            const pts: string[] = [];
            const steps = 40;
            for (let i = 0; i <= steps; i++) {
              const x = (i / steps) * room.length;
              const zEdge = getCeilingHeightAt(x, 0, room, ceiling);
              const svgX = offsetX + x * s;
              const svgY = offsetY + (roomH - zEdge) * s;
              pts.push(`${svgX},${svgY}`);
            }
            return (
              <polyline points={pts.join(' ')} fill="none" stroke="#999" strokeWidth="1" strokeDasharray="4 3" />
            );
          })()}
        </g>
      ) : (
        <rect x={offsetX} y={offsetY} width={roomW * s} height={roomH * s}
          fill="none" stroke="#333" strokeWidth="2" />
      )}

      {genTicks(roomW, 0.5).map((t) => {
        const px = offsetX + t * s;
        if (px < offsetX - 0.5 || px > offsetX + roomW * s + 0.5) return null;
        const isMajor = Math.abs(t - Math.round(t)) < 0.01;
        const hLabel = viewMode === 'top' ? (roomW - t) : t;
        return (
          <g key={`hr-${t}`}>
            <line x1={px} y1={offsetY + roomH * s} x2={px} y2={offsetY + roomH * s + (isMajor ? 7 : 4)} stroke="#999" strokeWidth="0.8" />
            {isMajor && (
              <text x={px} y={offsetY + roomH * s + 16} textAnchor="middle" fill="#999" fontSize="8">{hLabel.toFixed(0)}m</text>
            )}
          </g>
        );
      })}

      {genTicks(roomH, 0.5).map((t) => {
        const py = offsetY + t * s;
        if (py < offsetY - 0.5 || py > offsetY + roomH * s + 0.5) return null;
        const isMajor = Math.abs(t - Math.round(t)) < 0.01;
        const vLabel = viewMode === 'side' ? (roomH - t) : t;
        return (
          <g key={`vr-${t}`}>
            <line x1={offsetX - (isMajor ? 7 : 4)} y1={py} x2={offsetX} y2={py} stroke="#999" strokeWidth="0.8" />
            {isMajor && (
              <text x={offsetX - 9} y={py + 3} textAnchor="end" fill="#999" fontSize="8">{vLabel.toFixed(0)}m</text>
            )}
          </g>
        );
      })}

      {surfaceLabels.map((label) => {
        let x: number, y: number;
        let anchor = 'middle';
        let dx = 0, dy = 0;
        if (viewMode === 'top') {
          switch (label) {
            case 'Front Wall': x = offsetX + roomW * s / 2; y = offsetY; dy = -8; break;
            case 'Rear Wall': x = offsetX + roomW * s / 2; y = offsetY + roomH * s; dy = 16; break;
            case 'Left Wall': x = offsetX; y = offsetY + roomH * s / 2; anchor = 'end'; dx = -8; break;
            case 'Right Wall': x = offsetX + roomW * s; y = offsetY + roomH * s / 2; anchor = 'start'; dx = 8; break;
            default: return null;
          }
        } else {
          switch (label) {
            case 'Front Wall': x = offsetX; y = offsetY + roomH * s / 2; anchor = 'end'; dx = -8; break;
            case 'Rear Wall': x = offsetX + roomW * s; y = offsetY + roomH * s / 2; anchor = 'start'; dx = 8; break;
            case 'Ceiling': x = offsetX + roomW * s / 2; y = offsetY; dy = -8; break;
            case 'Floor': x = offsetX + roomW * s / 2; y = offsetY + roomH * s; dy = 16; break;
            default: return null;
          }
        }
        return (
          <text key={label} x={x! + dx} y={y! + dy} textAnchor={anchor} fill="#666" fontSize="11">{label}</text>
        );
      })}

      {assignedPeaks.map((mp, i) => {
        if (!mp.reflection) return null;
        const spkPos = toSVG(mp.reflection.speakerPosition, true);
        const refPos = toSVG(mp.reflection.reflectionPoint, true);
        const micPos = toSVG(micPosition, true);
        const color = getSurfaceColor(mp.reflection.surfaceLabel);
        return (
          <g key={i}>
            <line x1={spkPos.x} y1={spkPos.y} x2={refPos.x} y2={refPos.y}
              stroke={color} strokeWidth="1.5" opacity="0.6" />
            <line x1={refPos.x} y1={refPos.y} x2={micPos.x} y2={micPos.y}
              stroke={color} strokeWidth="1.5" opacity="0.6" />
            <circle cx={refPos.x} cy={refPos.y} r="4" fill={color} opacity="0.7" />
          </g>
        );
      })}

      {speakers.map((spk) => {
        const pos = toSVG(spk.position);
        return (
          <g key={spk.id}>
            <polygon points={`${pos.x},${pos.y + 8} ${pos.x - 6},${pos.y - 6} ${pos.x + 6},${pos.y - 6}`}
              fill="#9b59b6" stroke="#9b59b6" strokeWidth="1.5" />
            <text x={pos.x} y={pos.y - 12} textAnchor="middle" fill="#9b59b6" fontSize="10" fontWeight="600">
              {spk.label}
            </text>
          </g>
        );
      })}

      {(() => {
        const mPos = toSVG(micPosition);
        return (
          <g>
            <circle cx={mPos.x} cy={mPos.y} r="6" fill="#f39c12" stroke="#fff" strokeWidth="1.5" />
            <text x={mPos.x} y={mPos.y + 18} textAnchor="middle" fill="#f39c12" fontSize="10" fontWeight="600">
              {mic2Position ? 'Mic 1' : 'Mic'}
            </text>
          </g>
        );
      })()}

      {mic2Position && (() => {
        const m2Pos = toSVG(mic2Position);
        return (
          <g>
            <circle cx={m2Pos.x} cy={m2Pos.y} r="6" fill="#2ecc71" stroke="#fff" strokeWidth="1.5" />
            <text x={m2Pos.x} y={m2Pos.y + 18} textAnchor="middle" fill="#2ecc71" fontSize="10" fontWeight="600">
              Mic 2
            </text>
          </g>
        );
      })()}

      {fusionOverlayPeaks && fusionOverlayPeaks.filter(mp => mp.assigned && mp.reflection).map((mp, i) => {
        if (!mp.reflection) return null;
        const spkPos = toSVG(mp.reflection.speakerPosition, true);
        const refPos = toSVG(mp.reflection.reflectionPoint, true);
        const targetMic = (mp.targetMicIndex === 1 && mic2Position) ? mic2Position : micPosition;
        const micPos = toSVG(targetMic, true);
        const color = getSurfaceColor(mp.reflection.surfaceLabel);
        const opacity = 0.25 + mp.confidence * 0.35;
        const sz = 4;
        return (
          <g key={`fusion-${i}`}>
            <line x1={spkPos.x} y1={spkPos.y} x2={refPos.x} y2={refPos.y}
              stroke={color} strokeWidth="0.8" opacity={opacity * 0.6} strokeDasharray="4 2" />
            <line x1={refPos.x} y1={refPos.y} x2={micPos.x} y2={micPos.y}
              stroke={color} strokeWidth="0.8" opacity={opacity * 0.6} strokeDasharray="4 2" />
            <polygon
              points={`${refPos.x},${refPos.y - sz} ${refPos.x + sz},${refPos.y} ${refPos.x},${refPos.y + sz} ${refPos.x - sz},${refPos.y}`}
              fill={color} fillOpacity={opacity} stroke={color} strokeWidth="0.8" strokeOpacity={opacity * 0.8} />
          </g>
        );
      })}

      {roomObjects && roomObjects.length > 0 && roomObjects.map((obj, i) => {
        const pts = getReportObjectPolygon(obj, viewMode);
        const svgPts = pts.map(p => toSVG(p));
        const isLine = pts.length === 2 || (obj.type === 'desk' && viewMode === 'side');
        const center = toSVG(obj.position);
        if (isLine && pts.length === 2) {
          return (
            <g key={`obj-${i}`}>
              <line x1={svgPts[0].x} y1={svgPts[0].y} x2={svgPts[1].x} y2={svgPts[1].y}
                stroke="#e67e22" strokeWidth="2.5" strokeOpacity="0.8" />
              <text x={center.x} y={center.y - 8} textAnchor="middle" fill="#e67e22" fontSize="8" fontWeight="600">{obj.label}</text>
            </g>
          );
        }
        const pointsStr = svgPts.map(p => `${p.x},${p.y}`).join(' ');
        return (
          <g key={`obj-${i}`}>
            <polygon points={pointsStr} fill="#e67e22" fillOpacity="0.15" stroke="#e67e22" strokeWidth="1.5" strokeOpacity="0.7" />
            <text x={center.x} y={center.y + 3} textAnchor="middle" fill="#e67e22" fontSize="8" fontWeight="600">{obj.label}</text>
          </g>
        );
      })}

      <text
        x={viewMode === 'top' ? offsetX + roomW * s + 2 : offsetX - 2}
        y={viewMode === 'top' ? offsetY - 2 : offsetY + roomH * s + 12}
        textAnchor="start" fill="#999" fontSize="9"
      >
        (0,0)
      </text>

      <text x={svgWidth / 2} y={svgHeight - 8} textAnchor="middle" fill="#666" fontSize="11">
        {viewMode === 'top' ? 'Top View (XY) — looking down, Front Wall at top' : 'Side View (XZ) — Front Wall at left, Ceiling at top'}
      </text>

      <rect x="0" y="0" width={svgWidth} height={svgHeight} fill="none" stroke="#ddd" strokeWidth="1" />
    </svg>
  );
}

interface SurfacePanelConfig {
  label: string;
  surfaceWidth: number;
  surfaceHeight: number;
  reverseH: boolean;
  reverseV: boolean;
  project: (p: Point3D) => { u: number; v: number };
  ceilingProfile?: { u: number; v: number }[];
}

function getSurfacePanels(room: RoomDimensions, ceiling?: CeilingConfig): SurfacePanelConfig[] {
  const maxH = ceiling && ceiling.type !== 'flat' ? ceiling.maxHeight : room.height;
  const steps = 30;

  function wallCeilingProfile(wallLabel: string): { u: number; v: number }[] | undefined {
    if (!ceiling || ceiling.type === 'flat') return undefined;
    const pts: { u: number; v: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      let u: number, z: number;
      if (wallLabel === 'Front Wall') {
        const y = t * room.width;
        z = getCeilingHeightAt(0, y, room, ceiling);
        u = room.width - y;
      } else if (wallLabel === 'Rear Wall') {
        const y = t * room.width;
        z = getCeilingHeightAt(room.length, y, room, ceiling);
        u = y;
      } else if (wallLabel === 'Left Wall') {
        const x = t * room.length;
        z = getCeilingHeightAt(x, room.width, room, ceiling);
        u = room.length - x;
      } else {
        const x = t * room.length;
        z = getCeilingHeightAt(x, 0, room, ceiling);
        u = x;
      }
      pts.push({ u, v: z });
    }
    return pts;
  }

  return [
    {
      label: 'Front Wall',
      surfaceWidth: room.width,
      surfaceHeight: maxH,
      reverseH: true,
      reverseV: false,
      project: (p) => ({ u: room.width - p.y, v: p.z }),
      ceilingProfile: wallCeilingProfile('Front Wall'),
    },
    {
      label: 'Rear Wall',
      surfaceWidth: room.width,
      surfaceHeight: maxH,
      reverseH: false,
      reverseV: false,
      project: (p) => ({ u: p.y, v: p.z }),
      ceilingProfile: wallCeilingProfile('Rear Wall'),
    },
    {
      label: 'Left Wall',
      surfaceWidth: room.length,
      surfaceHeight: maxH,
      reverseH: true,
      reverseV: false,
      project: (p) => ({ u: room.length - p.x, v: p.z }),
      ceilingProfile: wallCeilingProfile('Left Wall'),
    },
    {
      label: 'Right Wall',
      surfaceWidth: room.length,
      surfaceHeight: maxH,
      reverseH: false,
      reverseV: false,
      project: (p) => ({ u: p.x, v: p.z }),
      ceilingProfile: wallCeilingProfile('Right Wall'),
    },
    {
      label: 'Ceiling',
      surfaceWidth: room.width,
      surfaceHeight: room.length,
      reverseH: true,
      reverseV: true,
      project: (p) => ({ u: room.width - p.y, v: room.length - p.x }),
    },
    {
      label: 'Floor',
      surfaceWidth: room.width,
      surfaceHeight: room.length,
      reverseH: true,
      reverseV: true,
      project: (p) => ({ u: room.width - p.y, v: room.length - p.x }),
    },
  ];
}

function RoomSurfaceSVG({ room, matchedPeaks, fusionOverlayPeaks, peakMatchTolerance, speedOfSound, ceiling }: {
  room: RoomDimensions;
  matchedPeaks: MatchedPeak[];
  fusionOverlayPeaks?: MatchedPeak[];
  peakMatchTolerance: number;
  speedOfSound: number;
  ceiling?: CeilingConfig;
}) {
  const panels = getSurfacePanels(room, ceiling);
  const cols = 3;
  const rows = 2;
  const cellW = 240;
  const cellH = 200;
  const pad = 6;
  const totalW = cols * cellW + (cols + 1) * pad;
  const totalH = rows * cellH + (rows + 1) * pad + 20;

  const errorRadiusMeters = (peakMatchTolerance / 1000) * speedOfSound;

  return (
    <svg width={totalW} height={totalH} xmlns="http://www.w3.org/2000/svg" style={{ background: '#fff' }}>
      {panels.map((panel, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const ox = pad + col * (cellW + pad);
        const oy = pad + row * (cellH + pad);
        const innerW = cellW - 20;
        const innerH = cellH - 30;
        const sX = innerW / panel.surfaceWidth;
        const sY = innerH / panel.surfaceHeight;
        const sc = Math.min(sX, sY);
        const drawW = panel.surfaceWidth * sc;
        const drawH = panel.surfaceHeight * sc;
        const dx = ox + 10 + (innerW - drawW) / 2;
        const dy = oy + 20 + (innerH - drawH) / 2;

        const surfacePeaks = matchedPeaks.filter(mp => {
          if (!mp.assigned || !mp.reflection) return false;
          const label = mp.reflection.surfaceLabel;
          if (label === panel.label) return true;
          if (label.includes('→')) {
            const lastSurface = label.split('→').pop()!.trim();
            return lastSurface === panel.label;
          }
          return false;
        });

        return (
          <g key={panel.label}>
            <rect x={ox} y={oy} width={cellW} height={cellH} fill="#fafafa" stroke="#ddd" strokeWidth="1" rx="3" />
            <text x={ox + cellW / 2} y={oy + 14} textAnchor="middle" fill="#333" fontSize="10" fontWeight="600">
              {panel.label}
            </text>
            {panel.ceilingProfile ? (
              (() => {
                const sorted = [...panel.ceilingProfile].sort((a, b) => a.u - b.u);
                const firstPt = sorted[0];
                const lastPt = sorted[sorted.length - 1];
                return (
                  <g>
                    <line x1={dx} y1={dy + drawH} x2={dx + drawW} y2={dy + drawH} stroke="#999" strokeWidth="1" />
                    <line x1={dx} y1={dy + drawH} x2={dx} y2={dy + drawH - (firstPt?.v ?? panel.surfaceHeight) / panel.surfaceHeight * drawH} stroke="#999" strokeWidth="1" />
                    <line x1={dx + drawW} y1={dy + drawH} x2={dx + drawW} y2={dy + drawH - (lastPt?.v ?? panel.surfaceHeight) / panel.surfaceHeight * drawH} stroke="#999" strokeWidth="1" />
                    <polyline
                      points={sorted.map(pt => {
                        const px = dx + pt.u / panel.surfaceWidth * drawW;
                        const py = dy + drawH - pt.v / panel.surfaceHeight * drawH;
                        return `${px},${py}`;
                      }).join(' ')}
                      fill="none" stroke="#999" strokeWidth="1"
                    />
                  </g>
                );
              })()
            ) : (
              <rect x={dx} y={dy} width={drawW} height={drawH} fill="none" stroke="#999" strokeWidth="1" />
            )}

            {genTicks(panel.surfaceWidth, 0.5).map((t) => {
              const px = dx + t * sc;
              if (px < dx - 0.5 || px > dx + drawW + 0.5) return null;
              const isMajor = Math.abs(t - Math.round(t)) < 0.01;
              const label = panel.reverseH ? (panel.surfaceWidth - t) : t;
              return (
                <g key={`h-${panel.label}-${t}`}>
                  <line x1={px} y1={dy + drawH} x2={px} y2={dy + drawH + (isMajor ? 5 : 3)} stroke="#999" strokeWidth="0.5" />
                  {isMajor && <text x={px} y={dy + drawH + 12} textAnchor="middle" fill="#999" fontSize="6">{label.toFixed(0)}m</text>}
                </g>
              );
            })}

            {genTicks(panel.surfaceHeight, 0.5).map((t) => {
              const py = dy + (panel.surfaceHeight - t) * sc;
              if (py < dy - 0.5 || py > dy + drawH + 0.5) return null;
              const isMajor = Math.abs(t - Math.round(t)) < 0.01;
              const label = panel.reverseV ? (panel.surfaceHeight - t) : t;
              return (
                <g key={`v-${panel.label}-${t}`}>
                  <line x1={dx - (isMajor ? 5 : 3)} y1={py} x2={dx} y2={py} stroke="#999" strokeWidth="0.5" />
                  {isMajor && <text x={dx - 7} y={py + 3} textAnchor="end" fill="#999" fontSize="6">{label.toFixed(0)}m</text>}
                </g>
              );
            })}

            {surfacePeaks.map((mp, pi) => {
              if (!mp.reflection) return null;
              const proj = panel.project(mp.reflection.reflectionPoint);
              const clampU = Math.max(0, Math.min(proj.u, panel.surfaceWidth));
              const clampV = Math.max(0, Math.min(proj.v, panel.surfaceHeight));
              const px = dx + clampU * sc;
              const py = dy + (panel.surfaceHeight - clampV) * sc;
              const color = getSurfaceColor(mp.reflection.surfaceLabel);
              const zoneR = errorRadiusMeters * sc;

              return (
                <g key={pi}>
                  <circle cx={px} cy={py} r={zoneR} fill={color} fillOpacity="0.12" stroke={color} strokeWidth="0.5" strokeOpacity="0.3" />
                  <circle cx={px} cy={py} r="3" fill={color} fillOpacity="0.8" />
                </g>
              );
            })}

            {fusionOverlayPeaks && fusionOverlayPeaks
              .filter(mp => {
                if (!mp.assigned || !mp.reflection) return false;
                const label = mp.reflection.surfaceLabel;
                if (label === panel.label) return true;
                if (label.includes('→')) return label.split('→').pop()!.trim() === panel.label;
                return false;
              })
              .map((mp, fi) => {
                if (!mp.reflection) return null;
                const proj = panel.project(mp.reflection.reflectionPoint);
                const fClampU = Math.max(0, Math.min(proj.u, panel.surfaceWidth));
                const fClampV = Math.max(0, Math.min(proj.v, panel.surfaceHeight));
                const px = dx + fClampU * sc;
                const py = dy + (panel.surfaceHeight - fClampV) * sc;
                const color = getSurfaceColor(mp.reflection.surfaceLabel);
                const zoneR = errorRadiusMeters * sc;
                const opacity = 0.2 + mp.confidence * 0.35;
                const sz = 3.5;
                return (
                  <g key={`fp-${fi}`}>
                    <circle cx={px} cy={py} r={zoneR} fill={color} fillOpacity={opacity * 0.15} stroke={color} strokeWidth="0.5" strokeOpacity={opacity * 0.2} strokeDasharray="2 1" />
                    <polygon
                      points={`${px},${py - sz} ${px + sz},${py} ${px},${py + sz} ${px - sz},${py}`}
                      fill={color} fillOpacity={opacity * 0.6} stroke={color} strokeWidth="0.6" strokeOpacity={opacity * 0.5} />
                  </g>
                );
              })}
          </g>
        );
      })}
      <text x={totalW / 2} y={totalH - 6} textAnchor="middle" fill="#666" fontSize="10">
        {`Surfaces viewed from inside the room — error zone: ${(errorRadiusMeters * 100).toFixed(1)} cm (${peakMatchTolerance} ms tolerance)`}
      </text>
      <rect x="0" y="0" width={totalW} height={totalH} fill="none" stroke="#ddd" strokeWidth="1" />
    </svg>
  );
}

function reportHeatColor(value: number): string {
  if (value < 0.01) return 'rgb(240,240,255)';
  const r = Math.round(255 * Math.min(1, value * 2));
  const g = Math.round(255 * Math.max(0, 1 - value * 2));
  const b = Math.round(80 * (1 - value));
  return `rgb(${r},${g},${b})`;
}

function reportCriticalZoneColor(value: number): string {
  if (value < 0.01) return 'rgb(235,245,235)';
  let r: number, g: number, b: number;
  if (value < 0.5) {
    const t = value / 0.5;
    r = Math.round(80 + 175 * t);
    g = Math.round(200 - 10 * t);
    b = Math.round(80 * (1 - t));
  } else {
    const t = (value - 0.5) / 0.5;
    r = 255;
    g = Math.round(190 * (1 - t));
    b = 0;
  }
  return `rgb(${r},${g},${b})`;
}

function ReportHeatmapGrid({ room, matchedPeaks, speedOfSound, peakMatchTolerance, ceiling, colorFn = reportHeatColor, idPrefix = 'rpt' }: {
  room: RoomDimensions;
  matchedPeaks: MatchedPeak[];
  speedOfSound: number;
  peakMatchTolerance: number;
  ceiling?: CeilingConfig;
  colorFn?: (v: number) => string;
  idPrefix?: string;
}) {
  const heatmaps = computeSurfaceHeatmaps(matchedPeaks, room, speedOfSound, peakMatchTolerance, 30, ceiling);
  const hmWithData = heatmaps.filter(h => h.reflectionPoints.length > 0);
  if (hmWithData.length === 0) return null;

  const cols = 3;
  const panelW = 230;
  const panelH = 200;
  const pad = 6;
  const rows = Math.ceil(hmWithData.length / cols);
  const totalW = cols * panelW + (cols + 1) * pad + 26;
  const totalH = rows * panelH + (rows + 1) * pad + 20;

  const maxInnerW = panelW - 40;
  const maxInnerH = panelH - 44;

  function panelDrawDims(hm: typeof hmWithData[0]) {
    const uLen = hm.uRange[1] - hm.uRange[0];
    const vLen = hm.vRange[1] - hm.vRange[0];
    const aspect = uLen / vLen;
    let dw: number, dh: number;
    if (aspect >= 1) {
      dw = maxInnerW;
      dh = maxInnerW / aspect;
      if (dh > maxInnerH) { dh = maxInnerH; dw = maxInnerH * aspect; }
    } else {
      dh = maxInnerH;
      dw = maxInnerH * aspect;
      if (dw > maxInnerW) { dw = maxInnerW; dh = maxInnerW / aspect; }
    }
    return { dw, dh };
  }

  return (
    <svg width={totalW} height={totalH} xmlns="http://www.w3.org/2000/svg" style={{ background: '#fff' }}>
      <defs>
        {hmWithData.map((hm, idx) => {
          const { dw, dh } = panelDrawDims(hm);
          const gcW = dw / hm.gridWidth;
          const gcH = dh / hm.gridHeight;
          const filterId = `${idPrefix}-blur-${idx}`;
          const clipId = `${idPrefix}-clip-${idx}`;
          const col = idx % cols;
          const row = Math.floor(idx / cols);
          const ox = pad + col * (panelW + pad);
          const oy = pad + row * (panelH + pad);
          const dxC = ox + (panelW - dw) / 2;
          const dyC = oy + 22;
          return (
            <g key={`def-${idx}`}>
              <filter id={filterId}>
                <feGaussianBlur stdDeviation={`${gcW * 0.6} ${gcH * 0.6}`} />
              </filter>
              <clipPath id={clipId}>
                {hm.ceilingProfile ? (
                  <polygon points={(() => {
                    const hmULen = hm.uRange[1] - hm.uRange[0];
                    const hmVLen = hm.vRange[1] - hm.vRange[0];
                    const cMapU = (u: number) => {
                      const frac = (u - hm.uRange[0]) / hmULen;
                      return hm.reverseH ? dxC + (1 - frac) * dw : dxC + frac * dw;
                    };
                    const cMapV = (v: number) => {
                      const frac = (v - hm.vRange[0]) / hmVLen;
                      return hm.reverseV ? dyC + frac * dh : dyC + (1 - frac) * dh;
                    };
                    const mapped = hm.ceilingProfile!.map(pt => ({
                      px: cMapU(pt.u),
                      py: cMapV(pt.v),
                    }));
                    mapped.sort((a, b) => b.px - a.px);
                    return [
                      `${dxC},${dyC + dh}`,
                      `${dxC + dw},${dyC + dh}`,
                      ...mapped.map(p => `${p.px},${p.py}`),
                    ].join(' ');
                  })()} />
                ) : (
                  <rect x={dxC} y={dyC} width={dw} height={dh} />
                )}
              </clipPath>
            </g>
          );
        })}
      </defs>
      {hmWithData.map((hm, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const ox = pad + col * (panelW + pad);
        const oy = pad + row * (panelH + pad);
        const { dw, dh } = panelDrawDims(hm);
        const uLen = hm.uRange[1] - hm.uRange[0];
        const vLen = hm.vRange[1] - hm.vRange[0];
        const gridCellW = dw / hm.gridWidth;
        const gridCellH = dh / hm.gridHeight;
        const dx = ox + (panelW - dw) / 2;
        const dy = oy + 22;

        const rMapU = (u: number) => {
          const frac = (u - hm.uRange[0]) / uLen;
          return hm.reverseH ? dx + (1 - frac) * dw : dx + frac * dw;
        };
        const rMapV = (v: number) => {
          const frac = (v - hm.vRange[0]) / vLen;
          return hm.reverseV ? dy + frac * dh : dy + (1 - frac) * dh;
        };
        const rMapCellI = (i: number) => {
          return hm.reverseH ? dx + (hm.gridWidth - 1 - i) * gridCellW : dx + i * gridCellW;
        };
        const rMapCellJ = (j: number) => {
          return hm.reverseV ? dy + j * gridCellH : dy + (hm.gridHeight - 1 - j) * gridCellH;
        };

        return (
          <g key={hm.surfaceLabel}>
            <rect x={ox} y={oy} width={panelW} height={panelH} fill="#fafafa" stroke="#ddd" strokeWidth="1" rx="3" />
            <text x={ox + panelW / 2} y={oy + 14} textAnchor="middle" fill="#333" fontSize="10" fontWeight="600">
              {hm.surfaceLabel} ({hm.reflectionPoints.length} pts)
            </text>

            <g filter={`url(#${idPrefix}-blur-${idx})`} clipPath={`url(#${idPrefix}-clip-${idx})`}>
              {hm.grid.map((gridRow, j) =>
                gridRow.map((cell, i) => (
                  <rect
                    key={`g-${j}-${i}`}
                    x={rMapCellI(i)}
                    y={rMapCellJ(j)}
                    width={gridCellW + 0.5}
                    height={gridCellH + 0.5}
                    fill={colorFn(cell.value)}
                  />
                ))
              )}
            </g>

            {hm.ceilingProfile ? (
              <g>
                <line x1={dx} y1={dy + dh} x2={dx + dw} y2={dy + dh} stroke="#666" strokeWidth="1" />
                {(() => {
                  const mapped = hm.ceilingProfile.map(pt => ({
                    px: rMapU(pt.u),
                    py: rMapV(pt.v),
                  }));
                  mapped.sort((a, b) => a.px - b.px);
                  const leftPt = mapped[0];
                  const rightPt = mapped[mapped.length - 1];
                  return (
                    <>
                      <line x1={leftPt.px} y1={dy + dh} x2={leftPt.px} y2={leftPt.py} stroke="#666" strokeWidth="1" />
                      <line x1={rightPt.px} y1={dy + dh} x2={rightPt.px} y2={rightPt.py} stroke="#666" strokeWidth="1" />
                      <polyline
                        points={mapped.map(p => `${p.px},${p.py}`).join(' ')}
                        fill="none" stroke="#666" strokeWidth="1"
                      />
                    </>
                  );
                })()}
              </g>
            ) : (
              <rect x={dx} y={dy} width={dw} height={dh} fill="none" stroke="#666" strokeWidth="1" />
            )}

            {hm.reflectionPoints.map((rp, ri) => {
              const px = rMapU(rp.u);
              const py = rMapV(rp.v);
              return (
                <g key={ri}>
                  <circle cx={px} cy={py} r="4" fill="none" stroke="#000" strokeWidth="1.5" />
                  <circle cx={px} cy={py} r="1.5" fill="#000" />
                </g>
              );
            })}

            {hm.hotspots.map((hs, hi) => {
              const px = rMapU(hs.u);
              const py = rMapV(hs.v);
              return (
                <g key={`hs-${hi}`}>
                  <circle cx={px} cy={py} r="8" fill="none" stroke="#ff0000" strokeWidth="2" strokeDasharray="3 2" />
                  <text x={px + 10} y={py - 2} textAnchor="middle" fill="#ff0000" fontSize="7" fontWeight="bold">
                    #{hi + 1}
                  </text>
                </g>
              );
            })}

            <text x={dx + dw / 2} y={dy + dh + 12} textAnchor="middle" fill="#999" fontSize="7">
              {hm.hLabel} ({uLen.toFixed(1)}m)
            </text>
            <text transform={`translate(${dx - 10}, ${dy + dh / 2}) rotate(-90)`} textAnchor="middle" fill="#999" fontSize="7">
              {hm.vLabel} ({vLen.toFixed(1)}m)
            </text>
          </g>
        );
      })}

      {(() => {
        const barX = totalW - 24;
        const barY = pad + 20;
        const barH = Math.min(panelH - 40, 160);
        const steps = 20;
        const stepH = barH / steps;
        return (
          <g>
            {Array.from({ length: steps }, (_, i) => {
              const v = 1 - i / (steps - 1);
              return (
                <rect key={`cb-${i}`} x={barX} y={barY + i * stepH} width={14} height={stepH + 0.5}
                  fill={colorFn(v)} />
              );
            })}
            <rect x={barX} y={barY} width={14} height={barH} fill="none" stroke="#999" strokeWidth="0.5" />
            <text x={barX + 7} y={barY - 4} textAnchor="middle" fontSize="7" fill="#666">1.0</text>
            <text x={barX + 7} y={barY + barH + 10} textAnchor="middle" fontSize="7" fill="#666">0.0</text>
          </g>
        );
      })()}

      <text x={(totalW - 26) / 2} y={totalH - 6} textAnchor="middle" fill="#666" fontSize="10">
        Treatment Target Heatmaps — color intensity = severity
      </text>
    </svg>
  );
}

function reportPressureColor(dB: number, minDB: number, maxDB: number): string {
  if (dB <= -998) return '#e5e5e5';
  const range = maxDB - minDB || 1;
  const t = Math.max(0, Math.min(1, (dB - minDB) / range));
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const s = t / 0.5;
    r = 0;
    g = Math.round(255 * s);
    b = Math.round(255 * (1 - s));
  } else {
    const s = (t - 0.5) / 0.5;
    r = Math.round(255 * s);
    g = Math.round(255 * (1 - s));
    b = 0;
  }
  return `rgb(${r},${g},${b})`;
}

function ReportPressureMapSVG({ data, title, bestSeat, seatCandidates, speakers, micPos, mic2Position }: {
  data: PressureMapData;
  title: string;
  bestSeat?: import("@shared/schema").SeatCandidate;
  seatCandidates?: import("@shared/schema").SeatCandidate[];
  speakers?: import("@shared/schema").SpeakerConfig[];
  micPos?: Point3D;
  mic2Position?: Point3D | null;
}) {
  const padL = 36;
  const padR = 28;
  const padT = 18;
  const padB = 22;
  const uLen = data.uRange[1] - data.uRange[0];
  const vLen = data.vRange[1] - data.vRange[0];
  const isTop = title.includes('Top');
  const isSide = title.includes('Side');

  const baseW = 320;
  const drawW = baseW;
  const drawH = Math.round(baseW * (isTop ? uLen / vLen : vLen / uLen));

  const svgWidth = padL + drawW + padR;
  const svgHeight = padT + drawH + padB;

  const toScreenX = isTop
    ? (y: number) => padL + (1 - (y - data.vRange[0]) / vLen) * drawW
    : (x: number) => padL + ((x - data.uRange[0]) / uLen) * drawW;
  const toScreenY = isTop
    ? (x: number) => padT + ((x - data.uRange[0]) / uLen) * drawH
    : (z: number) => padT + (1 - (z - data.vRange[0]) / vLen) * drawH;

  const cellWTop = drawW / data.gridHeight;
  const cellHTop = drawH / data.gridWidth;
  const cellWSide = drawW / data.gridWidth;
  const cellHSide = drawH / data.gridHeight;

  const renderStar = (cx: number, cy: number) => {
    const starR = 7;
    const points = Array.from({ length: 10 }, (_, i) => {
      const angle = -Math.PI / 2 + (i * Math.PI / 5);
      const r = i % 2 === 0 ? starR : starR * 0.4;
      return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
    }).join(' ');
    return <polygon points={points} fill="#ffd700" stroke="#b8860b" strokeWidth="1" />;
  };

  return (
    <svg width={svgWidth} height={svgHeight} style={{ border: '1px solid #ddd' }}>
      <text x={padL + drawW / 2} y={12} textAnchor="middle" fontSize="9" fontWeight="bold" fill="#333">{title}</text>
      {data.grid.map((row, j) =>
        row.map((cell, i) => {
          const rx = isTop ? padL + (data.gridHeight - 1 - j) * cellWTop : padL + i * cellWSide;
          const ry = isTop ? padT + i * cellHTop : padT + (data.gridHeight - 1 - j) * cellHSide;
          const rw = isTop ? cellWTop + 0.5 : cellWSide + 0.5;
          const rh = isTop ? cellHTop + 0.5 : cellHSide + 0.5;
          return (
            <rect key={`${j}-${i}`}
              x={rx} y={ry} width={rw} height={rh}
              fill={reportPressureColor(cell, data.minVal, data.maxVal)}
            />
          );
        })
      )}
      <rect x={padL} y={padT} width={drawW} height={drawH} fill="none" stroke="#999" strokeWidth="0.5" />

      {speakers && isTop && speakers.map((spk, si) => (
        <g key={spk.id}>
          <circle cx={toScreenX(spk.position.y)} cy={toScreenY(spk.position.x)} r="4" fill="#e74c3c" stroke="#fff" strokeWidth="0.5" />
          <text x={toScreenX(spk.position.y) + 6} y={toScreenY(spk.position.x) + 3} fontSize="6" fill="#e74c3c" fontWeight="bold">
            {speakers.length > 1 ? `S${si + 1}` : 'S'}
          </text>
        </g>
      ))}
      {speakers && isSide && speakers.map((spk, si) => (
        <g key={spk.id}>
          <circle cx={toScreenX(spk.position.x)} cy={toScreenY(spk.position.z)} r="4" fill="#e74c3c" stroke="#fff" strokeWidth="0.5" />
          <text x={toScreenX(spk.position.x) + 6} y={toScreenY(spk.position.z) + 3} fontSize="6" fill="#e74c3c" fontWeight="bold">
            {speakers.length > 1 ? `S${si + 1}` : 'S'}
          </text>
        </g>
      ))}
      {micPos && isTop && (
        <>
          <circle cx={toScreenX(micPos.y)} cy={toScreenY(micPos.x)} r="3" fill="#3498db" stroke="#fff" strokeWidth="0.5" />
          <text x={toScreenX(micPos.y) + 5} y={toScreenY(micPos.x) + 3} fontSize="6" fill="#3498db" fontWeight="bold">M1</text>
        </>
      )}
      {micPos && isSide && (
        <>
          <circle cx={toScreenX(micPos.x)} cy={toScreenY(micPos.z)} r="3" fill="#3498db" stroke="#fff" strokeWidth="0.5" />
          <text x={toScreenX(micPos.x) + 5} y={toScreenY(micPos.z) + 3} fontSize="6" fill="#3498db" fontWeight="bold">M1</text>
        </>
      )}
      {mic2Position && isTop && (
        <>
          <circle cx={toScreenX(mic2Position.y)} cy={toScreenY(mic2Position.x)} r="3" fill="#8e44ad" stroke="#fff" strokeWidth="0.5" />
          <text x={toScreenX(mic2Position.y) + 5} y={toScreenY(mic2Position.x) + 3} fontSize="6" fill="#8e44ad" fontWeight="bold">M2</text>
        </>
      )}
      {mic2Position && isSide && (
        <>
          <circle cx={toScreenX(mic2Position.x)} cy={toScreenY(mic2Position.z)} r="3" fill="#8e44ad" stroke="#fff" strokeWidth="0.5" />
          <text x={toScreenX(mic2Position.x) + 5} y={toScreenY(mic2Position.z) + 3} fontSize="6" fill="#8e44ad" fontWeight="bold">M2</text>
        </>
      )}

      {seatCandidates && isTop && seatCandidates.slice(0, 5).map((c, ci) => {
        const cx = toScreenX(c.y); const cy = toScreenY(c.x);
        return (
          <g key={`sc-t-${ci}`}>
            {ci === 0 ? renderStar(cx, cy) : (
              <polygon points={Array.from({ length: 10 }, (_, i) => {
                const angle = -Math.PI / 2 + (i * Math.PI / 5);
                const r = i % 2 === 0 ? 5 : 2;
                return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
              }).join(' ')} fill={ci === 0 ? '#ffd700' : '#c0c0c0'} stroke="#666" strokeWidth="0.5" />
            )}
            <text x={cx + 7} y={cy + 3} fontSize="6" fill={ci === 0 ? '#b8860b' : '#666'} fontWeight="bold">#{ci + 1}</text>
          </g>
        );
      })}
      {seatCandidates && isSide && seatCandidates.slice(0, 5).map((c, ci) => {
        const cx = toScreenX(c.x); const cy = toScreenY(c.z);
        return (
          <g key={`sc-s-${ci}`}>
            {ci === 0 ? renderStar(cx, cy) : (
              <polygon points={Array.from({ length: 10 }, (_, i) => {
                const angle = -Math.PI / 2 + (i * Math.PI / 5);
                const r = i % 2 === 0 ? 5 : 2;
                return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
              }).join(' ')} fill="#c0c0c0" stroke="#666" strokeWidth="0.5" />
            )}
            <text x={cx + 7} y={cy + 3} fontSize="6" fill={ci === 0 ? '#b8860b' : '#666'} fontWeight="bold">#{ci + 1}</text>
          </g>
        );
      })}
      {bestSeat && !seatCandidates && isTop && (
        <>
          {renderStar(toScreenX(bestSeat.y), toScreenY(bestSeat.x))}
          <text x={toScreenX(bestSeat.y) + 9} y={toScreenY(bestSeat.x) + 3} fontSize="7" fill="#b8860b" fontWeight="bold">Opt</text>
        </>
      )}
      {bestSeat && !seatCandidates && isSide && (
        <>
          {renderStar(toScreenX(bestSeat.x), toScreenY(bestSeat.z))}
          <text x={toScreenX(bestSeat.x) + 9} y={toScreenY(bestSeat.z) + 3} fontSize="7" fill="#b8860b" fontWeight="bold">Opt</text>
        </>
      )}
      <text x={padL + drawW / 2} y={svgHeight - 4} textAnchor="middle" fontSize="7" fill="#666">
        {isTop ? data.vAxis : data.uAxis} ({(isTop ? vLen : uLen).toFixed(1)}m)
      </text>
      <text transform={`translate(8, ${padT + drawH / 2}) rotate(-90)`} textAnchor="middle" fontSize="7" fill="#666">
        {isTop ? data.uAxis : data.vAxis}
      </text>
      <text x={svgWidth - 14} y={padT - 2} textAnchor="middle" fontSize="6" fill="#666">{data.maxVal.toFixed(0)}dB</text>
      <text x={svgWidth - 14} y={padT + drawH + 8} textAnchor="middle" fontSize="6" fill="#666">{data.minVal.toFixed(0)}dB</text>
    </svg>
  );
}

const ModalFreqResponseSection = forwardRef<HTMLDivElement, {
  modalResult: ModalAnalysisResult;
  room: RoomDimensions;
  speakers: SpeakerConfig[];
  micPosition: Point3D;
  ceiling?: CeilingConfig;
}>(function ModalFreqResponseSection({ modalResult, room, speakers, micPosition, ceiling }, ref) {
  const freqResponse = useMemo(() => {
    const freqs: number[] = [];
    for (let f = modalResult.fMin; f <= modalResult.fMax; f += 0.5) freqs.push(f);
    const sourcePos = speakers[0]?.position || { x: 0.5, y: 1.5, z: 1.2 };
    return computeDrivenResponse(modalResult.modes, room, sourcePos, micPosition, freqs, ceiling);
  }, [modalResult, room, speakers, micPosition, ceiling]);

  const modeFreqs = modalResult.modes.map(m => m.frequency);
  const matchedFreqs = modalResult.modes.filter(m => m.matched).map(m => m.frequency);

  return (
    <div ref={ref} style={{ width: '780px', padding: '10px', background: '#fff' }}>
      <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>Modal Analysis — Frequency Response at Mic Position</h3>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={freqResponse} margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="freq" type="number" domain={[modalResult.fMin, modalResult.fMax]}
            tickFormatter={(v: number) => `${v.toFixed(0)}`} fontSize={9} label={{ value: 'Frequency (Hz)', position: 'insideBottom', offset: -2, fontSize: 9 }} />
          <YAxis fontSize={9} label={{ value: 'dB', angle: -90, position: 'insideLeft', fontSize: 9 }} />
          <Line type="monotone" dataKey="dB" stroke="#2563eb" dot={false} strokeWidth={1.5} />
          {modeFreqs.map((f, i) => (
            <ReferenceLine key={`mode-${i}`} x={f} stroke={matchedFreqs.includes(f) ? '#16a34a' : '#d1d5db'} strokeDasharray="2 2" strokeWidth={0.5} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: '8px', color: '#888', textAlign: 'center', marginTop: '2px' }}>
        Green dashes = matched modes, Gray dashes = predicted (unmatched) modes
      </div>
    </div>
  );
});

const ModalCriticalMapsSection = forwardRef<HTMLDivElement, {
  modalResult: ModalAnalysisResult;
  room: RoomDimensions;
  speakers: SpeakerConfig[];
  micPosition: Point3D;
  mic2Position?: Point3D | null;
  ceiling?: CeilingConfig;
}>(function ModalCriticalMapsSection({ modalResult, room, speakers, micPosition, mic2Position, ceiling }, ref) {
  const criticalModes = useMemo(() => {
    const matched = modalResult.modes.filter(m => m.matched);
    if (matched.length === 0) return [];
    const sorted = [...matched].sort((a, b) => b.amplitude - a.amplitude);
    return sorted.slice(0, 5);
  }, [modalResult.modes]);

  const criticalMaps = useMemo(() => {
    if (criticalModes.length === 0) return [];
    const sourcePos = speakers[0]?.position || { x: 0.5, y: 1.5, z: 1.2 };
    return criticalModes.map(mode => ({
      freq: mode.frequency,
      label: `(${mode.n},${mode.m},${mode.l}) @ ${mode.frequency.toFixed(1)} Hz`,
      top: computePressureMap(modalResult.modes, room, sourcePos, mode.frequency, 'top', micPosition.z, 30, ceiling),
      side: computePressureMap(modalResult.modes, room, sourcePos, mode.frequency, 'side', room.width / 2, 30, ceiling),
    }));
  }, [criticalModes, modalResult.modes, room, speakers, micPosition, ceiling]);

  if (criticalMaps.length === 0) return null;

  return (
    <div ref={ref} style={{ width: '780px', padding: '10px', background: '#fff' }}>
      <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>Modal Analysis — Critical Mode Pressure Maps</h3>
      <div style={{ fontSize: '10px', color: '#666', marginBottom: '8px' }}>
        Pressure distribution at the {criticalMaps.length} strongest matched room modes
      </div>
      {criticalMaps.map((cm, ci) => (
        <div key={ci} style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 'bold', marginBottom: '4px', color: '#333' }}>
            Mode {cm.label}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <ReportPressureMapSVG data={cm.top} title={`Top View — ${cm.freq.toFixed(0)} Hz`}
              speakers={speakers} micPos={micPosition} mic2Position={mic2Position} />
            <ReportPressureMapSVG data={cm.side} title={`Side View — ${cm.freq.toFixed(0)} Hz`}
              speakers={speakers} micPos={micPosition} mic2Position={mic2Position} />
          </div>
        </div>
      ))}
      <div style={{ fontSize: '8px', color: '#888', textAlign: 'center', marginTop: '4px' }}>
        Blue = cancellation (null), Green = neutral, Red = resonance (high pressure)
      </div>
    </div>
  );
});

const ModalSeatSection = forwardRef<HTMLDivElement, {
  modalResult: ModalAnalysisResult;
  room: RoomDimensions;
  speakers: SpeakerConfig[];
  micPosition: Point3D;
  mic2Position?: Point3D | null;
  ceiling?: CeilingConfig;
}>(function ModalSeatSection({ modalResult, room, speakers, micPosition, mic2Position, ceiling }, ref) {
  const seatResponseComparison = useMemo(() => {
    if (!modalResult.bestSeat) return null;
    const freqs: number[] = [];
    for (let f = modalResult.fMin; f <= modalResult.fMax; f += 0.5) freqs.push(f);
    const sourcePos = speakers[0]?.position || { x: 0.5, y: 1.5, z: 1.2 };

    const micResponse = computeDrivenResponse(modalResult.modes, room, sourcePos, micPosition, freqs, ceiling);
    const optResponse = computeDrivenResponse(
      modalResult.modes, room, sourcePos,
      { x: modalResult.bestSeat.x, y: modalResult.bestSeat.y, z: modalResult.bestSeat.z },
      freqs, ceiling
    );

    const mic2Response = mic2Position ? computeDrivenResponse(modalResult.modes, room, sourcePos, mic2Position, freqs, ceiling) : null;

    return freqs.map((f, i) => ({
      freq: f,
      mic: micResponse[i].dB,
      optimal: optResponse[i].dB,
      ...(mic2Response ? { mic2: mic2Response[i].dB } : {}),
    }));
  }, [modalResult, room, speakers, micPosition, mic2Position, ceiling]);

  if (!modalResult.bestSeat) return null;

  return (
    <div ref={ref} style={{ width: '780px', padding: '10px', background: '#fff' }}>
      <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>Modal Analysis — Seat Optimizer</h3>

      <div style={{ fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>Top 5 Seat Candidates</div>
      <table style={{ width: 'auto', borderCollapse: 'collapse', fontSize: '9px', marginBottom: '12px' }}>
        <thead>
          <tr>
            <th style={thStyle}>Rank</th>
            <th style={thStyle}>X (m)</th>
            <th style={thStyle}>Y (m)</th>
            <th style={thStyle}>Z (m)</th>
            <th style={thStyle}>Score</th>
            <th style={thStyle}>Jvar</th>
            <th style={thStyle}>Jnull</th>
            <th style={thStyle}>Jpeak</th>
            <th style={thStyle}>Jsym</th>
          </tr>
        </thead>
        <tbody>
          {modalResult.seatCandidates.slice(0, 5).map((c, i) => (
            <tr key={i} style={{ background: i === 0 ? '#fefce8' : undefined }}>
              <td style={tdStyle}>#{i + 1}</td>
              <td style={tdStyle}>{c.x.toFixed(2)}</td>
              <td style={tdStyle}>{c.y.toFixed(2)}</td>
              <td style={tdStyle}>{c.z.toFixed(2)}</td>
              <td style={tdStyle}>{c.score.toFixed(2)}</td>
              <td style={tdStyle}>{c.Jvar.toFixed(2)}</td>
              <td style={tdStyle}>{c.Jnull.toFixed(2)}</td>
              <td style={tdStyle}>{c.Jpeak.toFixed(2)}</td>
              <td style={tdStyle}>{(c.Jsymmetry ?? 0).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>Optimal Position</div>
      <div style={{ display: 'flex', gap: '16px', fontSize: '10px', marginBottom: '8px' }}>
        <div><strong>X (Depth):</strong> {modalResult.bestSeat.x.toFixed(2)} m</div>
        <div><strong>Y (Width):</strong> {modalResult.bestSeat.y.toFixed(2)} m</div>
        <div><strong>Z (Height):</strong> {modalResult.bestSeat.z.toFixed(2)} m</div>
        <div><strong>Score:</strong> {modalResult.bestSeat.score.toFixed(2)}</div>
      </div>

      {seatResponseComparison && (
        <>
          <div style={{ fontSize: '11px', fontWeight: 'bold', marginBottom: '4px' }}>Frequency Response Comparison</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={seatResponseComparison} margin={{ top: 5, right: 15, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="freq" type="number" domain={[modalResult.fMin, modalResult.fMax]}
                tickFormatter={(v: number) => `${v.toFixed(0)}`} fontSize={9}
                label={{ value: 'Frequency (Hz)', position: 'insideBottom', offset: -2, fontSize: 9 }} />
              <YAxis fontSize={9} label={{ value: 'dB', angle: -90, position: 'insideLeft', fontSize: 9 }} />
              <Line type="monotone" dataKey="mic" stroke="#3498db" dot={false} strokeWidth={1.5} name="Mic Position" />
              <Line type="monotone" dataKey="optimal" stroke="#f59e0b" dot={false} strokeWidth={1.5} name="Optimal Seat" />
              {seatResponseComparison[0] && 'mic2' in seatResponseComparison[0] && (
                <Line type="monotone" dataKey="mic2" stroke="#8e44ad" dot={false} strokeWidth={1.5} name="Mic 2" />
              )}
              <Legend wrapperStyle={{ fontSize: '8px' }} />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ fontSize: '8px', color: '#888', textAlign: 'center', marginTop: '2px' }}>
            Blue = current mic position, Orange = optimal seat position{mic2Position ? ', Purple = Mic 2' : ''}
          </div>
        </>
      )}
    </div>
  );
});

export const ReportCapture = forwardRef<ReportCaptureHandle, ReportCaptureProps>(function ReportCapture(props, ref) {
  const etcRef = useRef<HTMLDivElement>(null);
  const roomTopRef = useRef<HTMLDivElement>(null);
  const roomSideRef = useRef<HTMLDivElement>(null);
  const roomSurfaceRef = useRef<HTMLDivElement>(null);
  const peakTableRef = useRef<HTMLDivElement>(null);
  const surfaceTableRef = useRef<HTMLDivElement>(null);
  const decayChartRef = useRef<HTMLDivElement>(null);
  const frequencyChartRef = useRef<HTMLDivElement>(null);
  const scorecardRef = useRef<HTMLDivElement>(null);
  const clarityRef = useRef<HTMLDivElement>(null);
  const unassignedRef = useRef<HTMLDivElement>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);
  const criticalZoneRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const modalFreqResponseRef = useRef<HTMLDivElement>(null);
  const modalMapsRef = useRef<HTMLDivElement>(null);
  const modalCriticalMapsRef = useRef<HTMLDivElement>(null);
  const modalGlobalRef = useRef<HTMLDivElement>(null);
  const modalSeatRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    getEtcElement: () => etcRef.current,
    getRoomTopElement: () => roomTopRef.current,
    getRoomSideElement: () => roomSideRef.current,
    getRoomSurfaceElement: () => roomSurfaceRef.current,
    getPeakTableElement: () => peakTableRef.current,
    getSurfaceTableElement: () => surfaceTableRef.current,
    getDecayChartElement: () => decayChartRef.current,
    getFrequencyChartElement: () => frequencyChartRef.current,
    getScorecardElement: () => scorecardRef.current,
    getClarityElement: () => clarityRef.current,
    getUnassignedElement: () => unassignedRef.current,
    getHeatmapElement: () => heatmapRef.current,
    getCriticalZoneElement: () => criticalZoneRef.current,
    getModalElement: () => modalRef.current,
    getModalFreqResponseElement: () => modalFreqResponseRef.current,
    getModalMapsElement: () => modalMapsRef.current,
    getModalCriticalMapsElement: () => modalCriticalMapsRef.current,
    getModalGlobalElement: () => modalGlobalRef.current,
    getModalSeatElement: () => modalSeatRef.current,
  }));

  const fusionETCs = useMemo(() => {
    if (!props.fusionDatasets || props.fusionDatasets.length === 0) return [];
    return props.fusionDatasets.map(ds => {
      const dIdx = findDirectArrival(ds.irData);
      return { label: ds.label, data: computeETC(ds.irData, 0.1, dIdx) };
    });
  }, [props.fusionDatasets]);

  const hasFusion = fusionETCs.length > 0;

  const etcChartData = useMemo(() => {
    const maxTime = props.earlyWindowMs * 1.5;

    if (hasFusion) {
      const timeMap = new Map<number, Record<string, number>>();
      for (let fi = 0; fi < fusionETCs.length; fi++) {
        const data = fusionETCs[fi].data.filter(p => p.time <= maxTime);
        const step = Math.max(1, Math.floor(data.length / 600));
        for (let i = 0; i < data.length; i += step) {
          const t = Math.round(data[i].time * 10) / 10;
          if (!timeMap.has(t)) timeMap.set(t, {});
          timeMap.get(t)![`ir${fi}`] = Math.round(data[i].level * 10) / 10;
        }
      }
      return Array.from(timeMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([time, vals]) => ({ time, ...vals }));
    }

    if (!props.etcData.length) return [];
    return props.etcData.filter(p => p.time <= maxTime);
  }, [props.etcData, props.earlyWindowMs, fusionETCs, hasFusion]);

  const peakMarkers = useMemo(() => {
    return props.matchedPeaks.map((mp) => ({
      time: mp.peak.delay_ms,
      level: mp.peak.rel_dB,
      assigned: mp.assigned,
      surface: mp.reflection?.surfaceLabel || 'Unknown',
    }));
  }, [props.matchedPeaks]);

  const reportHasFusion = !!(props.fusionOverlayPeaks && props.fusionOverlayPeaks.length > 0) ||
    !!(props.fusionPerIRPeaks && props.fusionPerIRPeaks.length > 0);
  const reportMainIRLabel = props.fusionPerIRPeaks && props.fusionPerIRPeaks.length > 0
    ? props.fusionPerIRPeaks[0].label
    : 'Primary';

  const mergedReportPeaks = useMemo(() => {
    return mergeAndDeduplicatePeaks(
      props.matchedPeaks,
      props.fusionOverlayPeaks,
      props.fusionPerIRPeaks,
      reportMainIRLabel
    );
  }, [props.matchedPeaks, props.fusionOverlayPeaks, props.fusionPerIRPeaks, reportMainIRLabel]);

  const mergedSurfaceSummaries = useMemo(() => {
    if (!reportHasFusion) return props.surfaceSummaries;
    const assigned = mergedReportPeaks.map(m => m.peak).filter(mp => mp.assigned && mp.reflection);
    return computeSurfaceSummaries(assigned);
  }, [mergedReportPeaks, props.surfaceSummaries, reportHasFusion]);

  const directIdx = useMemo(() => {
    if (!props.irData) return 0;
    return findDirectArrival(props.irData);
  }, [props.irData]);

  const decayMetrics = useMemo(() => {
    if (!props.irData) return null;
    return computeDecayMetrics(props.irData, directIdx);
  }, [props.irData, directIdx]);

  const fusionDecayMetrics = useMemo(() => {
    if (!props.fusionDatasets || props.fusionDatasets.length === 0) return [];
    return props.fusionDatasets.map(ds => {
      const dIdx = findDirectArrival(ds.irData);
      return { label: ds.label, metrics: computeDecayMetrics(ds.irData, dIdx) };
    });
  }, [props.fusionDatasets]);

  const decayAvgMetrics = useMemo(() => {
    if (fusionDecayMetrics.length === 0) return null;
    const avg = (vals: (number | null)[]) => {
      const valid = vals.filter((v): v is number => v !== null);
      return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    };
    const all = fusionDecayMetrics.map(fm => fm.metrics);
    return {
      edt: avg(all.map(m => m.edt)),
      t20: avg(all.map(m => m.t20)),
      t30: avg(all.map(m => m.t30)),
      rt60: avg(all.map(m => m.rt60)),
    };
  }, [fusionDecayMetrics]);

  const hasFusionDecay = fusionDecayMetrics.length > 0;

  const decayChartData = useMemo(() => {
    if (hasFusionDecay) {
      const timeMap = new Map<number, Record<string, number>>();
      const maxLen = Math.max(...fusionDecayMetrics.map(fm => fm.metrics.curve.length));
      const step = Math.max(1, Math.floor(maxLen / 600));
      for (let fi = 0; fi < fusionDecayMetrics.length; fi++) {
        const curve = fusionDecayMetrics[fi].metrics.curve;
        for (let i = 0; i < curve.length; i += step) {
          const t = Math.round(curve[i].time_ms * 10) / 10;
          if (!timeMap.has(t)) timeMap.set(t, {});
          timeMap.get(t)![`ir${fi}`] = Math.round(curve[i].level_dB * 10) / 10;
        }
      }
      for (const [, vals] of timeMap) {
        const irVals = Object.entries(vals).filter(([k]) => k.startsWith('ir')).map(([, v]) => v);
        if (irVals.length > 0) {
          vals.avg = Math.round((irVals.reduce((a, b) => a + b, 0) / irVals.length) * 10) / 10;
        }
      }
      return Array.from(timeMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([time, vals]) => ({ time, ...vals }));
    }

    if (!decayMetrics) return [];
    const curve = decayMetrics.curve;
    const step = Math.max(1, Math.floor(curve.length / 600));
    const data: { time: number; level: number }[] = [];
    for (let i = 0; i < curve.length; i += step) {
      data.push({ time: Math.round(curve[i].time_ms * 10) / 10, level: Math.round(curve[i].level_dB * 10) / 10 });
    }
    return data;
  }, [decayMetrics, fusionDecayMetrics, hasFusionDecay]);

  const clarityMetrics = useMemo(() => {
    if (!props.irData) return null;
    return computeClarityMetrics(props.irData, directIdx);
  }, [props.irData, directIdx]);

  const freqAnalysis = useMemo(() => {
    if (!props.irData) return null;
    return computeFrequencyResponse(props.irData, directIdx, 300, 12);
  }, [props.irData, directIdx]);

  const fusionFreqAnalyses = useMemo(() => {
    if (!props.fusionDatasets || props.fusionDatasets.length === 0) return [];
    return props.fusionDatasets.map(ds => {
      const dIdx = findDirectArrival(ds.irData);
      return { label: ds.label, analysis: computeFrequencyResponse(ds.irData, dIdx, 300, 12) };
    });
  }, [props.fusionDatasets]);

  const hasFusionFreq = fusionFreqAnalyses.length > 0;

  const freqChartData = useMemo(() => {
    if (hasFusionFreq) {
      const freqMap = new Map<number, Record<string, number>>();
      for (let fi = 0; fi < fusionFreqAnalyses.length; fi++) {
        const fa = fusionFreqAnalyses[fi].analysis;
        const src = fa.smoothedSpectrum.length > 0 ? fa.smoothedSpectrum : fa.spectrum;
        const fStep = Math.max(1, Math.floor(src.length / 600));
        for (let i = 0; i < src.length; i += fStep) {
          const freq = Math.round(src[i].frequency);
          if (freq < 20 || freq > 20000) continue;
          if (!freqMap.has(freq)) freqMap.set(freq, {});
          freqMap.get(freq)![`ir${fi}`] = Math.round(src[i].magnitude_dB * 10) / 10;
        }
      }
      for (const [, vals] of freqMap) {
        const irVals = Object.entries(vals).filter(([k]) => k.startsWith('ir')).map(([, v]) => v);
        if (irVals.length > 0) {
          vals.avg = Math.round((irVals.reduce((a, b) => a + b, 0) / irVals.length) * 10) / 10;
        }
      }
      return Array.from(freqMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([freq, vals]) => ({ freq, ...vals }));
    }

    if (!freqAnalysis) return [];
    const src = freqAnalysis.smoothedSpectrum.length > 0 ? freqAnalysis.smoothedSpectrum : freqAnalysis.spectrum;
    const step = Math.max(1, Math.floor(src.length / 600));
    const data: { freq: number; mag: number }[] = [];
    for (let i = 0; i < src.length; i += step) {
      const f = Math.round(src[i].frequency);
      if (f >= 20 && f <= 20000) {
        data.push({ freq: f, mag: Math.round(src[i].magnitude_dB * 10) / 10 });
      }
    }
    return data;
  }, [freqAnalysis, fusionFreqAnalyses, hasFusionFreq]);

  const combSignatures = useMemo(() => {
    return computeCombSignatures(props.matchedPeaks, 5);
  }, [props.matchedPeaks]);

  const scorecardPeaks = useMemo(() => {
    if (!reportHasFusion) return props.matchedPeaks;
    return mergedReportPeaks.map(m => m.peak);
  }, [props.matchedPeaks, mergedReportPeaks, reportHasFusion]);

  const scorecard = useMemo(() => {
    if (scorecardPeaks.length === 0) return null;
    return computeScorecard(scorecardPeaks, 'Mix');
  }, [scorecardPeaks]);

  const combinedHeatmapPeaks = useMemo(() => {
    if (!props.fusionOverlayPeaks || props.fusionOverlayPeaks.length === 0) return props.matchedPeaks;
    const toKey = (p: MatchedPeak) => `${(p.peak.delay_ms ?? 0).toFixed(3)}_${p.reflection?.surfaceLabel || ''}`;
    const existingKeys = new Set(props.matchedPeaks.map(toKey));
    const uniqueFusion = props.fusionOverlayPeaks.filter(fp => !existingKeys.has(toKey(fp)));
    return [...props.matchedPeaks, ...uniqueFusion];
  }, [props.matchedPeaks, props.fusionOverlayPeaks]);

  const unassignedDiags = useMemo(() => {
    if (props.mode !== 'geometry' || !props.irData || props.speakers.length === 0) return [];
    const canonicalPeaks = scorecardPeaks;
    return analyzeUnassignedPeaks(
      canonicalPeaks, props.room, props.speakers[0].position, props.micPosition,
      props.speedOfSound, props.surfaceWeights || {}, props.surfaceMaterials || {},
      props.peakMatchTolerance, props.ceiling, props.roomObjects
    );
  }, [scorecardPeaks, props.room, props.speakers, props.micPosition, props.speedOfSound, props.surfaceWeights, props.surfaceMaterials, props.mode, props.irData, props.peakMatchTolerance, props.ceiling, props.roomObjects]);

  return (
    <div style={{
      position: 'fixed',
      left: '-9999px',
      top: '0px',
      width: '800px',
      zIndex: -1,
      pointerEvents: 'none',
      background: '#fff',
      color: '#000',
    }}>
      <div ref={etcRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>
          Energy Time Curve{hasFusion ? ` — ${fusionETCs.length} IRs Overlaid` : ''}
        </h3>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={etcChartData} margin={{ top: 10, right: 20, bottom: 25, left: 15 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis dataKey="time" type="number" domain={[0, 'auto']}
              label={{ value: 'Time (ms)', position: 'insideBottom', offset: -10, style: { fontSize: 11 } }}
              tick={{ fontSize: 10 }} />
            <YAxis domain={[-60, 5]} tickFormatter={(v: number) => v.toFixed(0)}
              label={{ value: 'Level (dB)', angle: -90, position: 'insideLeft', offset: 5, style: { fontSize: 11 } }}
              tick={{ fontSize: 10 }} />
            <ReferenceArea x1={0} x2={props.earlyWindowMs} fill="#3b82f6" fillOpacity={0.06} />
            <ReferenceLine y={props.thresholdDb} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.6} />
            {!hasFusion && (
              <Line type="monotone" dataKey="level" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            )}
            {hasFusion && fusionETCs.map((fe, i) => (
              <Line key={`ir${i}`} type="monotone" dataKey={`ir${i}`}
                stroke={FUSION_COLORS[i % FUSION_COLORS.length]} strokeWidth={1.5} dot={false} isAnimationActive={false} name={fe.label} />
            ))}
            {hasFusion && <Legend />}
            {!hasFusion && peakMarkers.map((pm, i) => (
              <ReferenceLine key={`pk-${i}`} x={pm.time}
                stroke={pm.assigned ? "#22c55e" : "#f59e0b"}
                strokeDasharray={pm.assigned ? "none" : "2 2"}
                strokeWidth={pm.assigned ? 1.5 : 1} strokeOpacity={0.7} />
            ))}
            {hasFusion && props.fusionPerIRPeaks && props.fusionPerIRPeaks.map((irPeaks, irIdx) =>
              irPeaks.peaks.map((pk, pkIdx) => (
                <ReferenceLine key={`fir${irIdx}-pk${pkIdx}`} x={pk.delay_ms}
                  stroke={FUSION_COLORS[irIdx % FUSION_COLORS.length]}
                  strokeDasharray="none"
                  strokeWidth={1} strokeOpacity={0.6} />
              ))
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {props.mode === 'geometry' && (
        <>
          <div ref={roomTopRef} style={{ width: '620px', padding: '10px', background: '#fff' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>Room View — Top (XY)</h3>
            <RoomSVG room={props.room} speakers={props.speakers} micPosition={props.micPosition}
              mic2Position={props.mic2Position} matchedPeaks={props.matchedPeaks}
              fusionOverlayPeaks={props.fusionOverlayPeaks} viewMode="top"
              ceiling={props.ceiling} roomObjects={props.roomObjects} />
          </div>

          <div ref={roomSideRef} style={{ width: '620px', padding: '10px', background: '#fff' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>Room View — Side (XZ)</h3>
            <RoomSVG room={props.room} speakers={props.speakers} micPosition={props.micPosition}
              mic2Position={props.mic2Position} matchedPeaks={props.matchedPeaks}
              fusionOverlayPeaks={props.fusionOverlayPeaks} viewMode="side"
              ceiling={props.ceiling} roomObjects={props.roomObjects} />
          </div>

          <div ref={roomSurfaceRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>Room View — Surfaces (Inside View)</h3>
            <RoomSurfaceSVG room={props.room} matchedPeaks={props.matchedPeaks}
              fusionOverlayPeaks={props.fusionOverlayPeaks}
              peakMatchTolerance={props.peakMatchTolerance} speedOfSound={props.speedOfSound}
              ceiling={props.ceiling} />
          </div>
        </>
      )}

      <div ref={peakTableRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>Peak Analysis Results</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
          <thead>
            <tr style={{ background: '#f0f0f0' }}>
              <th style={thStyle}>#</th>
              {reportHasFusion && <th style={thStyle}>IR Source</th>}
              <th style={thStyle}>Delay (ms)</th>
              <th style={thStyle}>Level (dB)</th>
              <th style={thStyle}>{'\u0394'}L (m)</th>
              <th style={thStyle}>Severity</th>
              {props.mode === 'geometry' && (
                <>
                  <th style={thStyle}>Surface</th>
                  <th style={thStyle}>Pred. Delay</th>
                  <th style={thStyle}>Err (ms)</th>
                  <th style={thStyle}>Conf.</th>
                  <th style={thStyle}>P*</th>
                  <th style={thStyle}>|S-P*|</th>
                  <th style={thStyle}>|P*-M|</th>
                  <th style={thStyle}>L_pred</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {mergedReportPeaks.map((merged, i) => {
              const mp = merged.peak;
              const deltaL = mp.peak.extraPathLength ?? ((mp.peak.delay_ms / 1000) * props.speedOfSound);
              return (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={tdStyle}>{i + 1}</td>
                  {reportHasFusion && <td style={tdStyle}>{merged.irSources.join(', ')}</td>}
                  <td style={tdStyle}>{mp.peak.delay_ms.toFixed(2)}</td>
                  <td style={tdStyle}>{mp.peak.rel_dB.toFixed(1)}</td>
                  <td style={tdStyle}>{deltaL.toFixed(3)}</td>
                  <td style={{
                    ...tdStyle,
                    ...(mp.peak.severity >= -5 ? { color: '#dc2626', fontWeight: 600 } :
                        mp.peak.severity >= -15 ? { color: '#ea580c', fontWeight: 600 } : {})
                  }}>{mp.peak.severity.toFixed(1)}</td>
                  {props.mode === 'geometry' && (
                    <>
                      <td style={tdStyle}>{mp.assigned ? mp.reflection!.surfaceLabel.replace(/\u2192/g, '->') : 'Unassigned'}</td>
                      <td style={tdStyle}>{mp.assigned ? mp.reflection!.delay_ms.toFixed(2) : '-'}</td>
                      <td style={tdStyle}>{mp.assigned ? mp.timeError.toFixed(3) : '-'}</td>
                      <td style={{
                        ...tdStyle,
                        ...(mp.assigned ? {
                          color: mp.confidence >= 0.8 ? '#16a34a' : mp.confidence >= 0.5 ? '#ca8a04' : '#dc2626',
                          fontWeight: 600,
                        } : {})
                      }}>{mp.assigned ? `${(mp.confidence * 100).toFixed(0)}%` : '-'}</td>
                      <td style={tdStyle}>{mp.assigned ? `(${mp.reflection!.reflectionPoint.x.toFixed(2)}, ${mp.reflection!.reflectionPoint.y.toFixed(2)}, ${mp.reflection!.reflectionPoint.z.toFixed(2)})` : '-'}</td>
                      <td style={tdStyle}>{mp.assigned ? mp.reflection!.speakerDistance.toFixed(3) : '-'}</td>
                      <td style={tdStyle}>{mp.assigned ? mp.reflection!.micDistance.toFixed(3) : '-'}</td>
                      <td style={tdStyle}>{mp.assigned ? (mp.reflection!.speakerDistance + mp.reflection!.micDistance).toFixed(3) : '-'}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {props.mode === 'geometry' && mergedSurfaceSummaries.length > 0 && (
        <div ref={surfaceTableRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>Results By Surface</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
            <thead>
              <tr style={{ background: '#f0f0f0' }}>
                <th style={thStyle}>Surface</th>
                <th style={thStyle}>Peaks</th>
                <th style={thStyle}>Worst Severity</th>
                <th style={thStyle}>Earliest (ms)</th>
                <th style={thStyle}>Total Severity</th>
              </tr>
            </thead>
            <tbody>
              {mergedSurfaceSummaries.map((s, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafafa' }}>
                  <td style={tdStyle}>{s.surfaceLabel}</td>
                  <td style={tdStyle}>{s.peakCount}</td>
                  <td style={tdStyle}>{s.worstSeverity.toFixed(1)}</td>
                  <td style={tdStyle}>{s.earliestTime.toFixed(2)}</td>
                  <td style={tdStyle}>{s.totalSeverity.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scorecard && (
        <div ref={scorecardRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px', color: '#333' }}>Quality Gates Scorecard</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 500, marginBottom: '6px' }}>ITDG (Initial Time Delay Gap)</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '18px', fontWeight: 'bold' }}>
                  {scorecard.itdg.value_ms === Infinity ? 'N/A' : `${scorecard.itdg.value_ms.toFixed(1)} ms`}
                </span>
                <span style={{ fontSize: '10px', fontWeight: 'bold',
                  width: '48px', height: '22px', borderRadius: '9999px', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  textAlign: 'center', boxSizing: 'border-box',
                  background: scorecard.itdg.verdict === 'PASS' ? '#16a34a' : scorecard.itdg.verdict === 'WARN' ? '#eab308' : '#dc2626' }}>
                  {scorecard.itdg.verdict}
                </span>
              </div>
              {scorecard.itdg.firstSignificantPeak && (
                <div style={{ fontSize: '9px', color: '#9ca3af', marginTop: '4px' }}>
                  First significant peak at {scorecard.itdg.firstSignificantPeak.peak.delay_ms.toFixed(1)} ms ({scorecard.itdg.firstSignificantPeak.peak.rel_dB.toFixed(1)} dB)
                </div>
              )}
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 500, marginBottom: '6px' }}>RFZ (0-20 ms): PASS &lt; -20 dB, WARN -20 to -10 dB, FAIL ≥ -10 dB</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '10px', fontWeight: 'bold',
                  width: '48px', height: '22px', borderRadius: '9999px', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  textAlign: 'center', boxSizing: 'border-box',
                  background: scorecard.rfz.verdict === 'PASS' ? '#16a34a' : scorecard.rfz.verdict === 'WARN' ? '#eab308' : '#dc2626' }}>
                  {scorecard.rfz.verdict}
                </span>
              </div>
              {scorecard.rfz.worstPeak && (
                <div style={{ fontSize: '9px', color: '#9ca3af', marginTop: '4px' }}>
                  Worst: {scorecard.rfz.worstPeak.peak.delay_ms.toFixed(1)} ms at {scorecard.rfz.worstDb.toFixed(1)} dB
                  {scorecard.rfz.worstPeak.assigned && scorecard.rfz.worstPeak.reflection ? ` (${scorecard.rfz.worstPeak.reflection.surfaceLabel.replace(/\u2192/g, ' -> ')})` : ''}
                </div>
              )}
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 500, marginBottom: '6px' }}>Critical Early (0-10 ms): PASS &lt; -15 dB, WARN -15 to -10 dB, FAIL ≥ -10 dB</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '10px', fontWeight: 'bold',
                  width: '48px', height: '22px', borderRadius: '9999px', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  textAlign: 'center', boxSizing: 'border-box',
                  background: scorecard.criticalEarly.verdict === 'PASS' ? '#16a34a' : scorecard.criticalEarly.verdict === 'WARN' ? '#eab308' : '#dc2626' }}>
                  {scorecard.criticalEarly.verdict}
                </span>
              </div>
              {scorecard.criticalEarly.worstPeak && (
                <div style={{ fontSize: '9px', color: '#9ca3af', marginTop: '4px' }}>
                  Worst: {scorecard.criticalEarly.worstPeak.peak.delay_ms.toFixed(1)} ms at {scorecard.criticalEarly.worstDb.toFixed(1)} dB
                </div>
              )}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Peak Counts by Time Bin</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{scorecard.timeBins.bin_0_10}</div>
                  <div style={{ fontSize: '9px', color: '#9ca3af' }}>0-10 ms</div>
                </div>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{scorecard.timeBins.bin_10_20}</div>
                  <div style={{ fontSize: '9px', color: '#9ca3af' }}>10-20 ms</div>
                </div>
                <div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{scorecard.timeBins.bin_20_50}</div>
                  <div style={{ fontSize: '9px', color: '#9ca3af' }}>20-50 ms</div>
                </div>
              </div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '12px' }}>
              <div style={{ fontSize: '10px', color: '#6b7280', fontWeight: 500, marginBottom: '8px' }}>Top 3 Worst Offenders</div>
              {scorecard.worstOffenders.length === 0 ? (
                <div style={{ fontSize: '10px', color: '#9ca3af' }}>No peaks detected.</div>
              ) : (
                <div>
                  {scorecard.worstOffenders.map((wo, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', marginBottom: '4px', lineHeight: '1.4' }}>
                      <span style={{ fontWeight: 500, minWidth: '55px' }}>{wo.delay_ms.toFixed(1)} ms</span>
                      <span style={{ minWidth: '50px' }}>{wo.rel_dB.toFixed(1)} dB</span>
                      <span style={{ color: '#6b7280', flex: 1, textAlign: 'center' }}>{wo.assignedSurface.replace(/\u2192/g, ' -> ')}</span>
                      <span style={{ color: '#6b7280', minWidth: '55px', textAlign: 'right' }}>sev: {wo.severity.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={{ fontSize: '9px', color: '#9ca3af', marginTop: '6px', fontStyle: 'italic' }}>
            Scorecard computed from {scorecardPeaks.length} detected peaks{reportHasFusion ? ' (merged from all analyzed IRs)' : ''}.
          </div>
        </div>
      )}

      {decayChartData.length > 0 && (
        <div ref={decayChartRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px', color: '#333' }}>
            Schroeder Decay & Reverberation Metrics{hasFusionDecay ? ` — Fusion: ${fusionDecayMetrics.length} IRs` : ''}
          </h3>
          {hasFusionDecay && decayAvgMetrics ? (
            <>
              <div style={{ fontSize: '10px', fontWeight: 500, color: '#6b7280', marginBottom: '6px' }}>Fusion Average</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                {[
                  { label: 'EDT (avg)', value: decayAvgMetrics.edt, suffix: ' s' },
                  { label: 'T20 (avg)', value: decayAvgMetrics.t20, suffix: ' s' },
                  { label: 'T30 (avg)', value: decayAvgMetrics.t30, suffix: ' s' },
                  { label: 'RT60 (avg)', value: decayAvgMetrics.rt60, suffix: ' s' },
                ].map(m => (
                  <div key={m.label} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                    <div style={{ fontSize: '10px', color: '#6b7280' }}>{m.label}</div>
                    <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{m.value !== null ? `${m.value.toFixed(3)}${m.suffix}` : 'N/A'}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: '10px', fontWeight: 500, color: '#6b7280', marginBottom: '4px' }}>Individual IR Results</div>
              <div style={{ marginBottom: '10px' }}>
                {fusionDecayMetrics.map((fm, i) => (
                  <div key={fm.label} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '4px', fontSize: '10px', marginBottom: '2px', alignItems: 'center' }}>
                    <span style={{ fontWeight: 500, color: FUSION_COLORS[i % FUSION_COLORS.length] }}>{fm.label}</span>
                    <span>EDT: {fm.metrics.edt !== null ? `${fm.metrics.edt.toFixed(3)} s` : 'N/A'}</span>
                    <span>T20: {fm.metrics.t20 !== null ? `${fm.metrics.t20.toFixed(3)} s` : 'N/A'}</span>
                    <span>T30: {fm.metrics.t30 !== null ? `${fm.metrics.t30.toFixed(3)} s` : 'N/A'}</span>
                    <span>RT60: {fm.metrics.rt60 !== null ? `${fm.metrics.rt60.toFixed(3)} s` : 'N/A'}</span>
                  </div>
                ))}
              </div>
            </>
          ) : decayMetrics && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
              {[
                { label: 'EDT', value: decayMetrics.edt, suffix: ' s' },
                { label: 'T20', value: decayMetrics.t20, suffix: ' s' },
                { label: 'T30', value: decayMetrics.t30, suffix: ' s' },
                { label: 'RT60 (est.)', value: decayMetrics.rt60, suffix: ' s' },
              ].map(m => (
                <div key={m.label} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: '#6b7280' }}>{m.label}</div>
                  <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{m.value !== null ? `${m.value.toFixed(3)}${m.suffix}` : 'N/A'}</div>
                </div>
              ))}
            </div>
          )}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px', marginBottom: '10px' }}>
            <div style={{ fontSize: '11px', fontWeight: 500, marginBottom: '6px' }}>Schroeder Integrated Decay Curve{hasFusionDecay ? ' — Multi-IR Overlay' : ''}</div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={decayChartData} margin={{ top: 10, right: 20, bottom: 25, left: 15 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="time" type="number" domain={[0, 'auto']}
                  label={{ value: 'Time (ms)', position: 'insideBottom', offset: -10, style: { fontSize: 11 } }}
                  tick={{ fontSize: 10 }} />
                <YAxis domain={[-70, 5]}
                  label={{ value: 'Level (dB)', angle: -90, position: 'insideLeft', offset: 5, style: { fontSize: 11 } }}
                  tick={{ fontSize: 10 }} />
                <ReferenceLine y={-10} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.5} />
                <ReferenceLine y={-25} stroke="#3b82f6" strokeDasharray="4 4" strokeOpacity={0.5} />
                <ReferenceLine y={-35} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.5} />
                {!hasFusionDecay && (
                  <Line type="monotone" dataKey="level" stroke="#8b5cf6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                )}
                {hasFusionDecay && fusionDecayMetrics.map((fm, i) => (
                  <Line key={`ir${i}`} type="monotone" dataKey={`ir${i}`}
                    stroke={FUSION_COLORS[i % FUSION_COLORS.length]} strokeWidth={1.5} dot={false} isAnimationActive={false} name={fm.label} />
                ))}
                {hasFusionDecay && (
                  <Line type="monotone" dataKey="avg" stroke="#000" strokeWidth={2.5} strokeDasharray="6 3" dot={false} isAnimationActive={false} name="Average" />
                )}
                {hasFusionDecay && <Legend />}
              </LineChart>
            </ResponsiveContainer>
            <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '10px', color: '#6b7280', justifyContent: 'center' }}>
              <span><span style={{ display: 'inline-block', width: '12px', height: '2px', background: '#22c55e', marginRight: '4px', verticalAlign: 'middle' }} />EDT (0 to -10 dB)</span>
              <span><span style={{ display: 'inline-block', width: '12px', height: '2px', background: '#3b82f6', marginRight: '4px', verticalAlign: 'middle' }} />T20 (-5 to -25 dB)</span>
              <span><span style={{ display: 'inline-block', width: '12px', height: '2px', background: '#f59e0b', marginRight: '4px', verticalAlign: 'middle' }} />T30 (-5 to -35 dB)</span>
            </div>
          </div>
          {decayMetrics && (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 500, marginBottom: '4px' }}>Early vs Late Decay Analysis</div>
              <div style={{ fontSize: '10px', color: '#6b7280' }}>
                {decayMetrics.earlySlope !== null && <p style={{ marginBottom: '2px' }}>Early slope (0 to -10 dB): {decayMetrics.earlySlope.toFixed(4)} dB/ms</p>}
                {decayMetrics.lateSlope !== null && <p style={{ marginBottom: '2px' }}>Late slope (-15 to -35 dB): {decayMetrics.lateSlope.toFixed(4)} dB/ms</p>}
                <p style={{ fontStyle: 'italic' }}>{decayMetrics.slopeInterpretation}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {clarityMetrics && (
        <div ref={clarityRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px', color: '#333' }}>Clarity & Definition Metrics</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', marginBottom: '10px' }}>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: '#6b7280' }}>C50 (Speech)</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{clarityMetrics.c50 !== null ? `${clarityMetrics.c50.toFixed(2)} dB` : 'N/A'}</div>
              <div style={{ fontSize: '9px', color: '#9ca3af' }}>Early/Late energy ratio (50 ms)</div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: '#6b7280' }}>D50 (Definition)</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{clarityMetrics.d50 !== null ? `${clarityMetrics.d50.toFixed(1)} %` : 'N/A'}</div>
              <div style={{ fontSize: '9px', color: '#9ca3af' }}>Early energy fraction (50 ms)</div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: '#6b7280' }}>C80 (Music)</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{clarityMetrics.c80 !== null ? `${clarityMetrics.c80.toFixed(2)} dB` : 'N/A'}</div>
              <div style={{ fontSize: '9px', color: '#9ca3af' }}>Early/Late energy ratio (80 ms)</div>
            </div>
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '10px', color: '#6b7280' }}>Ts (Centre Time)</div>
              <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{clarityMetrics.ts_ms !== null ? `${clarityMetrics.ts_ms.toFixed(1)} ms` : 'N/A'}</div>
              <div style={{ fontSize: '9px', color: '#9ca3af' }}>Energy centre of gravity</div>
            </div>
          </div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px', marginBottom: '8px' }}>
            <div style={{ fontSize: '11px', fontWeight: 500, marginBottom: '4px' }}>Interpretation</div>
            <p style={{ fontSize: '10px', color: '#6b7280', fontStyle: 'italic', lineHeight: '1.4' }}>
              {clarityMetrics.interpretation}
            </p>
          </div>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px' }}>
            <div style={{ fontSize: '11px', fontWeight: 500, marginBottom: '4px' }}>Reference Ranges</div>
            <div style={{ fontSize: '10px', color: '#6b7280', lineHeight: '1.5' }}>
              <p><strong>C50 &gt; 2 dB:</strong> Good speech intelligibility. <strong>C50 &lt; -2 dB:</strong> Poor.</p>
              <p><strong>C80 &gt; 2 dB:</strong> Clear music definition. <strong>C80 &lt; -2 dB:</strong> Reverberant.</p>
              <p><strong>D50 &gt; 50%:</strong> Good speech clarity. <strong>D50 &lt; 30%:</strong> Very reverberant.</p>
              <p><strong>Ts:</strong> Lower values = closer/intimate. Higher values = distant/diffuse.</p>
            </div>
          </div>
        </div>
      )}

      {freqChartData.length > 0 && (
        <div ref={frequencyChartRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px', color: '#333' }}>
            Frequency Response & Comb Impact{hasFusionFreq ? ` — Fusion: ${fusionFreqAnalyses.length} IRs` : ''}
          </h3>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px', marginBottom: '10px' }}>
            <div style={{ fontSize: '11px', fontWeight: 500, marginBottom: '6px' }}>
              {hasFusionFreq ? 'Frequency Response — Multi-IR Overlay' : 'Frequency Response'}
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={freqChartData} margin={{ top: 10, right: 20, bottom: 25, left: 15 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="freq" type="number" scale="log" domain={[20, 20000]}
                  ticks={[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]}
                  tickFormatter={(v: number) => v >= 1000 ? `${v / 1000}k` : String(v)}
                  label={{ value: 'Frequency (Hz)', position: 'insideBottom', offset: -10, style: { fontSize: 11 } }}
                  tick={{ fontSize: 9 }} />
                <YAxis domain={[-60, 5]}
                  label={{ value: 'Magnitude (dB)', angle: -90, position: 'insideLeft', offset: 5, style: { fontSize: 11 } }}
                  tick={{ fontSize: 10 }} />
                {!hasFusionFreq && (
                  <Line type="monotone" dataKey="mag" stroke="#8b5cf6" strokeWidth={1} dot={false} isAnimationActive={false} />
                )}
                {hasFusionFreq && fusionFreqAnalyses.map((fa, i) => (
                  <Line key={`ir${i}`} type="monotone" dataKey={`ir${i}`}
                    stroke={FUSION_COLORS[i % FUSION_COLORS.length]} strokeWidth={1} dot={false} isAnimationActive={false} name={fa.label} />
                ))}
                {hasFusionFreq && (
                  <Line type="monotone" dataKey="avg" stroke="#000" strokeWidth={2.5} strokeDasharray="6 3" dot={false} isAnimationActive={false} name="Average" />
                )}
                {hasFusionFreq && <Legend />}
              </LineChart>
            </ResponsiveContainer>
          </div>
          {combSignatures.length > 0 && (
            <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 500, marginBottom: '6px' }}>Peak → Comb Filter Signature</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 500, fontSize: '10px' }}>Delay (ms)</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 500, fontSize: '10px' }}>Level (dB)</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 500, fontSize: '10px' }}>Surface</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 500, fontSize: '10px' }}>Comb Δf (Hz)</th>
                    <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 500, fontSize: '10px' }}>First notch frequencies (Hz)</th>
                  </tr>
                </thead>
                <tbody>
                  {combSignatures.map((sig, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                      <td style={{ padding: '4px 6px', fontSize: '10px' }}>{sig.delay_ms.toFixed(2)}</td>
                      <td style={{ padding: '4px 6px', fontSize: '10px' }}>{sig.rel_dB.toFixed(1)}</td>
                      <td style={{ padding: '4px 6px', fontSize: '10px', color: '#6b7280' }}>{sig.surface.replace(/\u2192/g, ' -> ')}</td>
                      <td style={{ padding: '4px 6px', fontSize: '10px', fontFamily: 'monospace' }}>{sig.combSpacing_Hz}</td>
                      <td style={{ padding: '4px 6px', fontSize: '10px', fontFamily: 'monospace', color: '#6b7280' }}>{sig.notchFrequencies.slice(0, 5).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {unassignedDiags.length > 0 && (
        <div ref={unassignedRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px', color: '#333' }}>Unassigned Peaks Diagnostics ({unassignedDiags.length} peaks)</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {unassignedDiags.map((diag, i) => {
              const classColorMap: Record<string, string> = {
                'likely desk/console/near object': '#f97316',
                'likely local object near one speaker': '#f59e0b',
                'likely diffraction': '#3b82f6',
                'likely higher-order reflection': '#8b5cf6',
                'likely noise': '#9ca3af',
                'unknown': '#6b7280',
              };
              const badgeColor = classColorMap[diag.classification] || '#6b7280';
              return (
                <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 600 }}>Peak @ {diag.peak.peak.delay_ms.toFixed(2)} ms</span>
                      <span style={{ fontSize: '10px', color: '#6b7280' }}>{diag.peak.peak.rel_dB.toFixed(1)} dB | severity: {diag.peak.peak.severity.toFixed(1)}</span>
                    </div>
                    <span style={{ fontSize: '9px', fontWeight: 'bold', padding: '2px 8px', borderRadius: '9999px', color: '#fff', background: badgeColor }}>
                      {diag.classification}
                    </span>
                  </div>
                  <p style={{ fontSize: '10px', color: '#6b7280', fontStyle: 'italic', marginBottom: '6px' }}>{diag.classificationReason}</p>
                  {diag.topCandidates.length > 0 && (
                    <div>
                      <div style={{ fontSize: '10px', fontWeight: 500, marginBottom: '4px' }}>Top 3 closest surface candidates:</div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9px' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                            <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 500 }}>Surface</th>
                            <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 500 }}>Pred. Delay (ms)</th>
                            <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 500 }}>Time Error (ms)</th>
                            <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 500 }}>Bounds</th>
                            <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 500 }}>uInSeg</th>
                            <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 500 }}>Accepted</th>
                            <th style={{ textAlign: 'left', padding: '2px 4px', fontWeight: 500 }}>Reject Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diag.topCandidates.map((c, j) => (
                            <tr key={j} style={{ borderBottom: '1px solid #f3f4f6' }}>
                              <td style={{ padding: '2px 4px' }}>{c.surfaceLabel}</td>
                              <td style={{ padding: '2px 4px' }}>{c.predictedDelay_ms.toFixed(2)}</td>
                              <td style={{ padding: '2px 4px' }}>{c.timeError_ms.toFixed(3)}</td>
                              <td style={{ padding: '2px 4px' }}>{c.boundsPass ? 'Y' : 'N'}</td>
                              <td style={{ padding: '2px 4px' }}>{c.uInSegment ? 'Y' : 'N'}</td>
                              <td style={{ padding: '2px 4px' }}>{c.accepted ? 'Y' : 'N'}</td>
                              <td style={{ padding: '2px 4px', color: '#6b7280' }}>{c.rejectReason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {props.mode === 'geometry' && (
        <div ref={heatmapRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>Treatment Target Heatmaps</h3>
          <ReportHeatmapGrid room={props.room} matchedPeaks={combinedHeatmapPeaks}
            speedOfSound={props.speedOfSound} peakMatchTolerance={props.peakMatchTolerance}
            ceiling={props.ceiling} colorFn={reportHeatColor} idPrefix="rpt" />
        </div>
      )}

      {props.mode === 'geometry' && (
        <div ref={criticalZoneRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
          <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>Critical Zones</h3>
          <p style={{ fontSize: '9px', color: '#666', marginBottom: '6px' }}>Red = most critical (highest reflection energy), Yellow = moderate, Green = low priority</p>
          <ReportHeatmapGrid room={props.room} matchedPeaks={combinedHeatmapPeaks}
            speedOfSound={props.speedOfSound} peakMatchTolerance={props.peakMatchTolerance}
            ceiling={props.ceiling} colorFn={reportCriticalZoneColor} idPrefix="cz" />
        </div>
      )}

      {props.mode === 'geometry' && props.modalResult && (
        <>
          <div ref={modalRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>Modal Analysis — Room Modes</h3>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '8px', fontSize: '11px' }}>
              <div><strong>Predicted modes:</strong> {props.modalResult.modes.length}</div>
              <div><strong>IR peaks matched:</strong> {props.modalResult.modes.filter(m => m.matched).length} / {props.modalResult.measuredPeaks.length}</div>
              <div><strong>Schroeder freq:</strong> {props.modalResult.schroederFreq.toFixed(0)} Hz</div>
              <div><strong>Range:</strong> {props.modalResult.fMin}–{props.modalResult.fMax} Hz</div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '12px' }}>
              <thead>
                <tr>
                  <th style={thStyle}>(n,m,l)</th>
                  <th style={thStyle}>Freq (Hz)</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>IR Peak (Hz)</th>
                  <th style={thStyle}>Q</th>
                  <th style={thStyle}>T60 (s)</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {props.modalResult.modes.map((mode, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>({mode.n},{mode.m},{mode.l})</td>
                    <td style={tdStyle}>{mode.frequency.toFixed(1)}</td>
                    <td style={tdStyle}>{mode.type}</td>
                    <td style={tdStyle}>{mode.measuredFreq ? mode.measuredFreq.toFixed(1) : '-'}</td>
                    <td style={tdStyle}>{mode.Q.toFixed(1)}</td>
                    <td style={tdStyle}>{mode.T60.toFixed(2)}</td>
                    <td style={{ ...tdStyle, color: mode.matched ? '#16a34a' : '#9ca3af' }}>
                      {mode.matched ? 'Matched' : 'Predicted'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ModalFreqResponseSection
            ref={modalFreqResponseRef}
            modalResult={props.modalResult}
            room={props.room}
            speakers={props.speakers}
            micPosition={props.micPosition}
            ceiling={props.ceiling}
          />

          {props.modalResult.pressureMapTop && props.modalResult.pressureMapSide && (
            <div ref={modalMapsRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>Modal Analysis — Pressure Maps (Selected Mode)</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <ReportPressureMapSVG data={props.modalResult.pressureMapTop} title="Top View (ear height)"
                  speakers={props.speakers} micPos={props.micPosition} mic2Position={props.mic2Position} />
                <ReportPressureMapSVG data={props.modalResult.pressureMapSide} title="Side View (centerline)"
                  speakers={props.speakers} micPos={props.micPosition} mic2Position={props.mic2Position} />
              </div>
              <div style={{ fontSize: '8px', color: '#888', textAlign: 'center', marginTop: '4px' }}>
                Blue = cancellation (null), Green = neutral, Red = resonance (high pressure)
              </div>
            </div>
          )}

          <ModalCriticalMapsSection
            ref={modalCriticalMapsRef}
            modalResult={props.modalResult}
            room={props.room}
            speakers={props.speakers}
            micPosition={props.micPosition}
            mic2Position={props.mic2Position}
            ceiling={props.ceiling}
          />

          {props.modalResult.globalPressureMapTop && props.modalResult.globalPressureMapSide && (
            <div ref={modalGlobalRef} style={{ width: '780px', padding: '10px', background: '#fff' }}>
              <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px', color: '#333' }}>Modal Analysis — Global Pressure Map</h3>
              <div style={{ fontSize: '11px', marginBottom: '4px' }}>All modes, {props.modalResult.fMin}–{props.modalResult.fMax} Hz</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <ReportPressureMapSVG data={props.modalResult.globalPressureMapTop} title="Global Top View (ear height)"
                  seatCandidates={props.modalResult.seatCandidates.slice(0, 5)}
                  speakers={props.speakers} micPos={props.micPosition} mic2Position={props.mic2Position} />
                <ReportPressureMapSVG data={props.modalResult.globalPressureMapSide} title="Global Side View (centerline)"
                  seatCandidates={props.modalResult.seatCandidates.slice(0, 5)}
                  speakers={props.speakers} micPos={props.micPosition} mic2Position={props.mic2Position} />
              </div>
              <div style={{ fontSize: '8px', color: '#888', textAlign: 'center', marginTop: '4px' }}>
                Broadband average of all modes. Blue = cancellation, Green = neutral, Red = resonance. Stars = top 5 seat candidates.
              </div>
            </div>
          )}

          <ModalSeatSection
            ref={modalSeatRef}
            modalResult={props.modalResult}
            room={props.room}
            speakers={props.speakers}
            micPosition={props.micPosition}
            mic2Position={props.mic2Position}
            ceiling={props.ceiling}
          />
        </>
      )}
    </div>
  );
});
