import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import type { RoomDimensions, Point3D, SpeakerConfig, MatchedPeak } from "@shared/schema";

interface RoomViewProps {
  room: RoomDimensions;
  speakers: SpeakerConfig[];
  micPosition: Point3D;
  mic2Position?: Point3D | null;
  matchedPeaks: MatchedPeak[];
  fusionOverlayPeaks?: MatchedPeak[];
  maxPeaks?: number;
  peakMatchTolerance?: number;
  speedOfSound?: number;
}

type ViewMode = 'top' | 'side' | 'surface';

const SURFACE_COLORS: Record<string, string> = {
  'Front Wall': 'hsl(var(--chart-1))',
  'Rear Wall': 'hsl(var(--chart-2))',
  'Left Wall': 'hsl(var(--chart-3))',
  'Right Wall': 'hsl(var(--chart-4))',
  'Floor': 'hsl(var(--chart-5))',
  'Ceiling': 'hsl(var(--chart-1))',
};

function getSurfaceColor(label: string): string {
  for (const key of Object.keys(SURFACE_COLORS)) {
    if (label.includes(key)) return SURFACE_COLORS[key];
  }
  return 'hsl(var(--muted-foreground))';
}

interface SurfacePanelConfig {
  label: string;
  surfaceWidth: number;
  surfaceHeight: number;
  hAxisLabel: string;
  vAxisLabel: string;
  reverseH: boolean;
  reverseV: boolean;
  project: (p: Point3D) => { u: number; v: number };
}

function getSurfacePanels(room: RoomDimensions): SurfacePanelConfig[] {
  return [
    {
      label: 'Front Wall',
      surfaceWidth: room.width,
      surfaceHeight: room.height,
      hAxisLabel: 'Width (Y)',
      vAxisLabel: 'Height (Z)',
      reverseH: true,
      reverseV: false,
      project: (p) => ({ u: room.width - p.y, v: p.z }),
    },
    {
      label: 'Rear Wall',
      surfaceWidth: room.width,
      surfaceHeight: room.height,
      hAxisLabel: 'Width (Y)',
      vAxisLabel: 'Height (Z)',
      reverseH: false,
      reverseV: false,
      project: (p) => ({ u: p.y, v: p.z }),
    },
    {
      label: 'Left Wall',
      surfaceWidth: room.length,
      surfaceHeight: room.height,
      hAxisLabel: 'Length (X)',
      vAxisLabel: 'Height (Z)',
      reverseH: true,
      reverseV: false,
      project: (p) => ({ u: room.length - p.x, v: p.z }),
    },
    {
      label: 'Right Wall',
      surfaceWidth: room.length,
      surfaceHeight: room.height,
      hAxisLabel: 'Length (X)',
      vAxisLabel: 'Height (Z)',
      reverseH: false,
      reverseV: false,
      project: (p) => ({ u: p.x, v: p.z }),
    },
    {
      label: 'Ceiling',
      surfaceWidth: room.width,
      surfaceHeight: room.length,
      hAxisLabel: 'Width (Y)',
      vAxisLabel: 'Length (X)',
      reverseH: true,
      reverseV: true,
      project: (p) => ({ u: room.width - p.y, v: room.length - p.x }),
    },
    {
      label: 'Floor',
      surfaceWidth: room.width,
      surfaceHeight: room.length,
      hAxisLabel: 'Width (Y)',
      vAxisLabel: 'Length (X)',
      reverseH: true,
      reverseV: true,
      project: (p) => ({ u: room.width - p.y, v: room.length - p.x }),
    },
  ];
}

function generateRulerTicks(length: number, step: number): number[] {
  const ticks: number[] = [];
  for (let v = 0; v <= length + 0.001; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

function SurfacePanel({
  config,
  peaks,
  fusionPeaks,
  errorRadiusMeters,
}: {
  config: SurfacePanelConfig;
  peaks: MatchedPeak[];
  fusionPeaks?: MatchedPeak[];
  errorRadiusMeters: number;
}) {
  const rulerSpace = 18;
  const panelPad = 24;
  const panelW = 240;
  const panelH = 200;

  const availW = panelW - panelPad * 2 - rulerSpace;
  const availH = panelH - panelPad * 2 - rulerSpace;
  const scaleX = config.surfaceWidth > 0 ? availW / config.surfaceWidth : 1;
  const scaleY = config.surfaceHeight > 0 ? availH / config.surfaceHeight : 1;
  const s = Math.min(scaleX, scaleY);

  const drawW = config.surfaceWidth * s;
  const drawH = config.surfaceHeight * s;
  const ox = panelPad + rulerSpace + (availW - drawW) / 2;
  const oy = panelPad + (availH - drawH) / 2;

  const color = getSurfaceColor(config.label);
  const errorRadiusPx = isFinite(errorRadiusMeters * s) ? errorRadiusMeters * s : 2;

  const hTicks = generateRulerTicks(config.surfaceWidth, 0.5);
  const vTicks = generateRulerTicks(config.surfaceHeight, 0.5);

  return (
    <div className="bg-background border rounded-md overflow-hidden" data-testid={`surface-panel-${config.label.toLowerCase().replace(/\s+/g, '-')}`}>
      <svg viewBox={`0 0 ${panelW} ${panelH}`} className="w-full" style={{ maxHeight: '200px' }}>
        <rect x={ox} y={oy} width={drawW} height={drawH} fill="none" stroke={color} strokeWidth="1.5" strokeOpacity="0.4" />
        <rect x={ox} y={oy} width={drawW} height={drawH} fill={color} fillOpacity="0.04" />

        <text x={panelW / 2} y={12} textAnchor="middle" fill={color} fontSize="10" fontWeight="600">{config.label}</text>

        {hTicks.map((t) => {
          const px = ox + t * s;
          if (px < ox - 0.5 || px > ox + drawW + 0.5) return null;
          const isMajor = Math.abs(t - Math.round(t)) < 0.01;
          const label = config.reverseH ? (config.surfaceWidth - t) : t;
          return (
            <g key={`ht-${t}`}>
              <line x1={px} y1={oy + drawH} x2={px} y2={oy + drawH + (isMajor ? 5 : 3)} stroke="hsl(var(--muted-foreground))" strokeWidth="0.5" opacity="0.5" />
              {isMajor && (
                <text x={px} y={oy + drawH + 12} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="5.5" opacity="0.6">{label.toFixed(0)}m</text>
              )}
            </g>
          );
        })}

        {vTicks.map((t) => {
          const py = oy + (config.surfaceHeight - t) * s;
          if (py < oy - 0.5 || py > oy + drawH + 0.5) return null;
          const isMajor = Math.abs(t - Math.round(t)) < 0.01;
          const label = config.reverseV ? (config.surfaceHeight - t) : t;
          return (
            <g key={`vt-${t}`}>
              <line x1={ox - (isMajor ? 5 : 3)} y1={py} x2={ox} y2={py} stroke="hsl(var(--muted-foreground))" strokeWidth="0.5" opacity="0.5" />
              {isMajor && (
                <text x={ox - 7} y={py + 2} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="5.5" opacity="0.6">{label.toFixed(0)}m</text>
              )}
            </g>
          );
        })}

        {peaks.map((mp, i) => {
          if (!mp.reflection) return null;
          const projected = config.project(mp.reflection.reflectionPoint);
          const px = ox + projected.u * s;
          const py = oy + (config.surfaceHeight - projected.v) * s;
          if (!isFinite(px) || !isFinite(py)) return null;
          const opacity = 0.3 + mp.confidence * 0.5;

          return (
            <g key={i}>
              <circle cx={px} cy={py} r={Math.max(errorRadiusPx, 2)} fill={color} fillOpacity={opacity * 0.5} stroke={color} strokeWidth="0.5" strokeOpacity={opacity * 0.3} data-testid={`error-zone-${config.label.toLowerCase().replace(/\s+/g, '-')}-${i}`} />
              <circle cx={px} cy={py} r="3" fill={color} fillOpacity={opacity} data-testid={`reflection-point-${config.label.toLowerCase().replace(/\s+/g, '-')}-${i}`} />
              <text x={px} y={py - 6} textAnchor="middle" fill={color} fontSize="7" fillOpacity={opacity}>{mp.reflection.delay_ms.toFixed(1)}ms</text>
            </g>
          );
        })}

        {fusionPeaks && fusionPeaks.map((mp, i) => {
          if (!mp.reflection) return null;
          const projected = config.project(mp.reflection.reflectionPoint);
          const px = ox + projected.u * s;
          const py = oy + (config.surfaceHeight - projected.v) * s;
          if (!isFinite(px) || !isFinite(py)) return null;
          const opacity = 0.2 + mp.confidence * 0.35;
          const sz = 3.5;
          return (
            <g key={`fp-${i}`}>
              <circle cx={px} cy={py} r={Math.max(errorRadiusPx, 2)} fill={color} fillOpacity={opacity * 0.25} stroke={color} strokeWidth="0.5" strokeOpacity={opacity * 0.2} strokeDasharray="2 1" />
              <polygon
                points={`${px},${py - sz} ${px + sz},${py} ${px},${py + sz} ${px - sz},${py}`}
                fill={color}
                fillOpacity={opacity * 0.6}
                stroke={color}
                strokeWidth="0.6"
                strokeOpacity={opacity * 0.5}
              />
            </g>
          );
        })}

        {peaks.length === 0 && (!fusionPeaks || fusionPeaks.length === 0) && (
          <text x={panelW / 2} y={panelH / 2} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="8" opacity="0.4">No reflections</text>
        )}

        <text x={panelW / 2} y={panelH - 2} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="7" opacity="0.4">
          {config.surfaceWidth.toFixed(1)}m × {config.surfaceHeight.toFixed(1)}m
        </text>
      </svg>
    </div>
  );
}

export function RoomView({ room, speakers, micPosition, mic2Position, matchedPeaks, fusionOverlayPeaks, maxPeaks = 10, peakMatchTolerance = 0.35, speedOfSound = 343 }: RoomViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('top');
  const [showCount, setShowCount] = useState(maxPeaks);

  const padding = 40;
  const svgWidth = 500;
  const svgHeight = 400;

  const dims = useMemo(() => {
    if (viewMode === 'surface') return { s: 1, offsetX: 0, offsetY: 0, roomW: 0, roomH: 0 };
    const roomW = viewMode === 'top' ? room.width : room.length;
    const roomH = viewMode === 'top' ? room.length : room.height;

    const availW = svgWidth - padding * 2;
    const availH = svgHeight - padding * 2;
    const scaleX = availW / roomW;
    const scaleY = availH / roomH;
    const s = Math.min(scaleX, scaleY);

    const offsetX = padding + (availW - roomW * s) / 2;
    const offsetY = padding + (availH - roomH * s) / 2;

    return {
      s,
      offsetX,
      offsetY,
      roomW,
      roomH,
    };
  }, [room, viewMode]);

  const clampToRoom = (p: Point3D): Point3D => ({
    x: Math.max(0, Math.min(p.x, room.length)),
    y: Math.max(0, Math.min(p.y, room.width)),
    z: Math.max(0, Math.min(p.z, room.height)),
  });

  const toSVG = (p: Point3D, clamp: boolean = false): { x: number; y: number } => {
    const pt = clamp ? clampToRoom(p) : p;
    if (viewMode === 'top') {
      return {
        x: dims.offsetX + (room.width - pt.y) * dims.s,
        y: dims.offsetY + pt.x * dims.s,
      };
    } else {
      return {
        x: dims.offsetX + pt.x * dims.s,
        y: dims.offsetY + (dims.roomH - pt.z) * dims.s,
      };
    }
  };

  const assignedPeaks = useMemo(() => {
    return matchedPeaks
      .filter(mp => mp.assigned && mp.reflection)
      .slice(0, showCount);
  }, [matchedPeaks, showCount]);

  const fusionAssignedPeaks = useMemo(() => {
    if (!fusionOverlayPeaks || fusionOverlayPeaks.length === 0) return [];
    return fusionOverlayPeaks.filter(mp => mp.assigned && mp.reflection);
  }, [fusionOverlayPeaks]);

  const surfaceLabels = useMemo(() => {
    if (viewMode === 'side') {
      return ['Front Wall', 'Rear Wall', 'Floor', 'Ceiling'];
    }
    return ['Front Wall', 'Rear Wall', 'Left Wall', 'Right Wall'];
  }, [viewMode]);

  const surfacePanels = useMemo(() => getSurfacePanels(room), [room]);

  const peaksBySurface = useMemo(() => {
    const map: Record<string, MatchedPeak[]> = {};
    for (const panel of surfacePanels) {
      map[panel.label] = [];
    }
    for (const mp of assignedPeaks) {
      if (!mp.reflection) continue;
      const baseLabel = mp.reflection.surfaceLabel.split(' + ')[0];
      for (const panel of surfacePanels) {
        if (baseLabel === panel.label || mp.reflection.surfaceLabel.includes(panel.label)) {
          map[panel.label].push(mp);
        }
      }
    }
    return map;
  }, [assignedPeaks, surfacePanels]);

  const fusionPeaksBySurface = useMemo(() => {
    const map: Record<string, MatchedPeak[]> = {};
    for (const panel of surfacePanels) {
      map[panel.label] = [];
    }
    for (const mp of fusionAssignedPeaks) {
      if (!mp.reflection) continue;
      const baseLabel = mp.reflection.surfaceLabel.split(' + ')[0];
      for (const panel of surfacePanels) {
        if (baseLabel === panel.label || mp.reflection.surfaceLabel.includes(panel.label)) {
          map[panel.label].push(mp);
        }
      }
    }
    return map;
  }, [fusionAssignedPeaks, surfacePanels]);

  const errorRadiusMeters = (peakMatchTolerance / 1000) * speedOfSound;

  return (
    <div className="space-y-3" data-testid="room-view">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">View:</Label>
          <Select value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <SelectTrigger className="h-7 w-32 text-xs" data-testid="select-view-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">Top (XY)</SelectItem>
              <SelectItem value="side">Side (XZ)</SelectItem>
              <SelectItem value="surface">Surfaces</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {assignedPeaks.length > 0 && (
          <div className="flex items-center gap-2 flex-1 max-w-48">
            <Label className="text-xs text-muted-foreground whitespace-nowrap">Show:</Label>
            <Slider
              value={[showCount]}
              onValueChange={([v]) => setShowCount(v)}
              min={1}
              max={Math.max(1, matchedPeaks.filter(m => m.assigned).length)}
              step={1}
              className="flex-1"
              data-testid="slider-show-peaks"
            />
            <span className="text-xs text-muted-foreground w-5 text-right">{showCount}</span>
          </div>
        )}
      </div>

      {viewMode === 'surface' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2" data-testid="surface-panels-grid">
            {surfacePanels.map((panel) => (
              <SurfacePanel
                key={panel.label}
                config={panel}
                peaks={peaksBySurface[panel.label] || []}
                fusionPeaks={fusionPeaksBySurface[panel.label]}
                errorRadiusMeters={errorRadiusMeters}
              />
            ))}
          </div>
          <div className="text-center space-y-0.5">
            <span className="text-[10px] text-muted-foreground block">
              Surfaces viewed from inside the room — error zone radius: {(errorRadiusMeters * 100).toFixed(1)} cm ({peakMatchTolerance} ms tolerance)
            </span>
            {fusionAssignedPeaks.length > 0 && (
              <span className="text-[10px] text-muted-foreground block">
                ● = single IR &nbsp; ◆ = fusion overlay ({fusionAssignedPeaks.length} points)
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-background border rounded-md overflow-hidden">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full"
            style={{ maxHeight: '400px' }}
          >
            <rect
              x={dims.offsetX}
              y={dims.offsetY}
              width={dims.roomW * dims.s}
              height={dims.roomH * dims.s}
              fill="none"
              stroke="hsl(var(--border))"
              strokeWidth="2"
            />

            {generateRulerTicks(dims.roomW, 0.5).map((t) => {
              const px = dims.offsetX + t * dims.s;
              if (px < dims.offsetX - 0.5 || px > dims.offsetX + dims.roomW * dims.s + 0.5) return null;
              const isMajor = Math.abs(t - Math.round(t)) < 0.01;
              const hLabel = viewMode === 'top' ? (dims.roomW - t) : t;
              return (
                <g key={`hrule-${t}`}>
                  <line x1={px} y1={dims.offsetY + dims.roomH * dims.s} x2={px} y2={dims.offsetY + dims.roomH * dims.s + (isMajor ? 6 : 3)} stroke="hsl(var(--muted-foreground))" strokeWidth="0.7" opacity="0.4" />
                  {isMajor && (
                    <text x={px} y={dims.offsetY + dims.roomH * dims.s + 14} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="7" opacity="0.5">{hLabel.toFixed(0)}m</text>
                  )}
                </g>
              );
            })}

            {generateRulerTicks(dims.roomH, 0.5).map((t) => {
              const py = dims.offsetY + t * dims.s;
              if (py < dims.offsetY - 0.5 || py > dims.offsetY + dims.roomH * dims.s + 0.5) return null;
              const isMajor = Math.abs(t - Math.round(t)) < 0.01;
              const vLabel = viewMode === 'side' ? (dims.roomH - t) : t;
              return (
                <g key={`vrule-${t}`}>
                  <line x1={dims.offsetX - (isMajor ? 6 : 3)} y1={py} x2={dims.offsetX} y2={py} stroke="hsl(var(--muted-foreground))" strokeWidth="0.7" opacity="0.4" />
                  {isMajor && (
                    <text x={dims.offsetX - 8} y={py + 3} textAnchor="end" fill="hsl(var(--muted-foreground))" fontSize="7" opacity="0.5">{vLabel.toFixed(0)}m</text>
                  )}
                </g>
              );
            })}

            {surfaceLabels.map((label) => {
              let x: number, y: number;
              let anchor: string = 'middle';
              let dx = 0, dy = 0;
              if (viewMode === 'top') {
                switch (label) {
                  case 'Front Wall':
                    x = dims.offsetX + dims.roomW * dims.s / 2;
                    y = dims.offsetY;
                    dy = -6;
                    break;
                  case 'Rear Wall':
                    x = dims.offsetX + dims.roomW * dims.s / 2;
                    y = dims.offsetY + dims.roomH * dims.s;
                    dy = 14;
                    break;
                  case 'Left Wall':
                    x = dims.offsetX;
                    y = dims.offsetY + dims.roomH * dims.s / 2;
                    anchor = 'end';
                    dx = -6;
                    break;
                  case 'Right Wall':
                    x = dims.offsetX + dims.roomW * dims.s;
                    y = dims.offsetY + dims.roomH * dims.s / 2;
                    anchor = 'start';
                    dx = 6;
                    break;
                  default: return null;
                }
              } else {
                switch (label) {
                  case 'Front Wall':
                    x = dims.offsetX;
                    y = dims.offsetY + dims.roomH * dims.s / 2;
                    anchor = 'end';
                    dx = -6;
                    break;
                  case 'Rear Wall':
                    x = dims.offsetX + dims.roomW * dims.s;
                    y = dims.offsetY + dims.roomH * dims.s / 2;
                    anchor = 'start';
                    dx = 6;
                    break;
                  case 'Ceiling':
                    x = dims.offsetX + dims.roomW * dims.s / 2;
                    y = dims.offsetY;
                    dy = -6;
                    break;
                  case 'Floor':
                    x = dims.offsetX + dims.roomW * dims.s / 2;
                    y = dims.offsetY + dims.roomH * dims.s;
                    dy = 14;
                    break;
                  default: return null;
                }
              }
              return (
                <text
                  key={label}
                  x={x + dx}
                  y={y + dy}
                  textAnchor={anchor}
                  fill="hsl(var(--muted-foreground))"
                  fontSize="9"
                  opacity="0.6"
                >
                  {label}
                </text>
              );
            })}

            {assignedPeaks.map((mp, i) => {
              if (!mp.reflection) return null;
              const spkPos = toSVG(mp.reflection.speakerPosition, true);
              const refPos = toSVG(mp.reflection.reflectionPoint, true);
              const micPos = toSVG(micPosition, true);
              const color = getSurfaceColor(mp.reflection.surfaceLabel);
              const opacity = 0.3 + mp.confidence * 0.5;

              return (
                <g key={i}>
                  <line
                    x1={spkPos.x} y1={spkPos.y}
                    x2={refPos.x} y2={refPos.y}
                    stroke={color}
                    strokeWidth="1"
                    strokeOpacity={opacity}
                    strokeDasharray={mp.reflection.order > 1 ? "3 2" : "none"}
                  />
                  <line
                    x1={refPos.x} y1={refPos.y}
                    x2={micPos.x} y2={micPos.y}
                    stroke={color}
                    strokeWidth="1"
                    strokeOpacity={opacity}
                    strokeDasharray={mp.reflection.order > 1 ? "3 2" : "none"}
                  />
                  <circle
                    cx={refPos.x} cy={refPos.y} r="3"
                    fill={color}
                    fillOpacity={opacity}
                  />
                </g>
              );
            })}

            {speakers.map((spk) => {
              const pos = toSVG(spk.position);
              return (
                <g key={spk.id}>
                  <polygon
                    points={`${pos.x},${pos.y + 7} ${pos.x - 5},${pos.y - 5} ${pos.x + 5},${pos.y - 5}`}
                    fill="hsl(var(--chart-4))"
                    stroke="hsl(var(--chart-4))"
                    strokeWidth="1.5"
                  />
                  <text
                    x={pos.x}
                    y={pos.y - 10}
                    textAnchor="middle"
                    fill="hsl(var(--chart-4))"
                    fontSize="9"
                    fontWeight="600"
                  >
                    {spk.label}
                  </text>
                </g>
              );
            })}

            {(() => {
              const mPos = toSVG(micPosition);
              return (
                <g>
                  <circle
                    cx={mPos.x} cy={mPos.y} r="5"
                    fill="hsl(var(--chart-5))"
                    stroke="hsl(var(--background))"
                    strokeWidth="1.5"
                  />
                  <text
                    x={mPos.x}
                    y={mPos.y + 16}
                    textAnchor="middle"
                    fill="hsl(var(--chart-5))"
                    fontSize="9"
                    fontWeight="600"
                  >
                    Mic 1
                  </text>
                </g>
              );
            })()}

            {mic2Position && (() => {
              const m2Pos = toSVG(mic2Position);
              return (
                <g>
                  <circle
                    cx={m2Pos.x} cy={m2Pos.y} r="5"
                    fill="hsl(var(--chart-3))"
                    stroke="hsl(var(--background))"
                    strokeWidth="1.5"
                  />
                  <text
                    x={m2Pos.x}
                    y={m2Pos.y + 16}
                    textAnchor="middle"
                    fill="hsl(var(--chart-3))"
                    fontSize="9"
                    fontWeight="600"
                  >
                    Mic 2
                  </text>
                </g>
              );
            })()}

            {fusionAssignedPeaks.map((mp, i) => {
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
                  <line
                    x1={spkPos.x} y1={spkPos.y}
                    x2={refPos.x} y2={refPos.y}
                    stroke={color}
                    strokeWidth="0.8"
                    strokeOpacity={opacity * 0.6}
                    strokeDasharray="4 2"
                  />
                  <line
                    x1={refPos.x} y1={refPos.y}
                    x2={micPos.x} y2={micPos.y}
                    stroke={color}
                    strokeWidth="0.8"
                    strokeOpacity={opacity * 0.6}
                    strokeDasharray="4 2"
                  />
                  <polygon
                    points={`${refPos.x},${refPos.y - sz} ${refPos.x + sz},${refPos.y} ${refPos.x},${refPos.y + sz} ${refPos.x - sz},${refPos.y}`}
                    fill={color}
                    fillOpacity={opacity}
                    stroke={color}
                    strokeWidth="0.8"
                    strokeOpacity={opacity * 0.8}
                  />
                </g>
              );
            })}

            <text
              x={viewMode === 'top' ? dims.offsetX + dims.roomW * dims.s + 2 : dims.offsetX - 2}
              y={viewMode === 'top' ? dims.offsetY - 2 : dims.offsetY + dims.roomH * dims.s + 10}
              textAnchor="start"
              fill="hsl(var(--muted-foreground))"
              fontSize="8"
              opacity="0.5"
            >
              (0,0)
            </text>

            <text x={svgWidth / 2} y={svgHeight - 5} textAnchor="middle" fill="hsl(var(--muted-foreground))" fontSize="10">
              {viewMode === 'top' ? 'Top View — looking down, Front Wall at top' : 'Side View — Front Wall at left, Ceiling at top'}
            </text>
          </svg>
        </div>
      )}

      {assignedPeaks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(SURFACE_COLORS).map(([label, color]) => (
            <div key={label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              {label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
