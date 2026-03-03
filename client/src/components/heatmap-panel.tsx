import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Flame } from "lucide-react";
import type { MatchedPeak, RoomDimensions } from "@shared/schema";
import { computeSurfaceHeatmaps, type SurfaceHeatmap } from "@/lib/surface-heatmaps";

interface HeatmapPanelProps {
  matchedPeaks: MatchedPeak[];
  fusionOverlayPeaks?: MatchedPeak[];
  room: RoomDimensions;
  speedOfSound: number;
  toleranceMs: number;
}

function heatColor(value: number): string {
  if (value < 0.01) return 'rgb(240,240,255)';
  const r = Math.round(255 * Math.min(1, value * 2));
  const g = Math.round(255 * Math.max(0, 1 - value * 2));
  const b = Math.round(80 * (1 - value));
  return `rgb(${r},${g},${b})`;
}

const AXIS_LABELS: Record<string, string> = { x: 'Depth', y: 'Width', z: 'Height' };

function HeatmapSVG({ heatmap }: { heatmap: SurfaceHeatmap }) {
  const uLen = heatmap.uRange[1] - heatmap.uRange[0];
  const vLen = heatmap.vRange[1] - heatmap.vRange[0];
  const aspect = uLen / vLen;

  const maxDrawW = 220;
  const maxDrawH = 180;
  let drawW: number, drawH: number;
  if (aspect >= 1) {
    drawW = maxDrawW;
    drawH = maxDrawW / aspect;
    if (drawH > maxDrawH) { drawH = maxDrawH; drawW = maxDrawH * aspect; }
  } else {
    drawH = maxDrawH;
    drawW = maxDrawH * aspect;
    if (drawW > maxDrawW) { drawW = maxDrawW; drawH = maxDrawW / aspect; }
  }

  const padL = 44;
  const padR = 30;
  const padT = 22;
  const padB = 32;
  const svgWidth = padL + drawW + padR;
  const svgHeight = padT + drawH + padB;
  const cellW = drawW / heatmap.gridWidth;
  const cellH = drawH / heatmap.gridHeight;

  return (
    <svg width={svgWidth} height={svgHeight} className="border rounded">
      <defs>
        <filter id={`blur-${heatmap.surfaceLabel.replace(/\s+/g, '-')}`}>
          <feGaussianBlur stdDeviation={`${cellW * 0.6} ${cellH * 0.6}`} />
        </filter>
        <clipPath id={`clip-${heatmap.surfaceLabel.replace(/\s+/g, '-')}`}>
          <rect x={padL} y={padT} width={drawW} height={drawH} />
        </clipPath>
      </defs>
      <text x={padL + drawW / 2} y={14} textAnchor="middle" fontSize="11" fontWeight="bold" fill="currentColor">
        {heatmap.surfaceLabel} (Refl: {heatmap.reflectionPoints.length})
      </text>

      <g filter={`url(#blur-${heatmap.surfaceLabel.replace(/\s+/g, '-')})`}
         clipPath={`url(#clip-${heatmap.surfaceLabel.replace(/\s+/g, '-')})`}>
        {heatmap.grid.map((row, j) =>
          row.map((cell, i) => (
            <rect
              key={`${j}-${i}`}
              x={padL + i * cellW}
              y={padT + (heatmap.gridHeight - 1 - j) * cellH}
              width={cellW + 0.5}
              height={cellH + 0.5}
              fill={heatColor(cell.value)}
            />
          ))
        )}
      </g>

      <rect x={padL} y={padT} width={drawW} height={drawH} fill="none" stroke="#666" strokeWidth="1" />

      {heatmap.reflectionPoints.map((rp, i) => {
        const px = padL + ((rp.u - heatmap.uRange[0]) / uLen) * drawW;
        const py = padT + (1 - (rp.v - heatmap.vRange[0]) / vLen) * drawH;
        return (
          <g key={i}>
            <circle cx={px} cy={py} r="4" fill="none" stroke="#000" strokeWidth="1.5" />
            <circle cx={px} cy={py} r="1.5" fill="#000" />
          </g>
        );
      })}

      {heatmap.hotspots.map((hs, i) => {
        const px = padL + ((hs.u - heatmap.uRange[0]) / uLen) * drawW;
        const py = padT + (1 - (hs.v - heatmap.vRange[0]) / vLen) * drawH;
        return (
          <g key={`hs-${i}`}>
            <circle cx={px} cy={py} r="8" fill="none" stroke="#ff0000" strokeWidth="2" strokeDasharray="3 2" />
            <text x={px + 10} y={py - 2} fontSize="7" fill="#ff0000" fontWeight="bold">
              #{i + 1}
            </text>
          </g>
        );
      })}

      <text x={padL + drawW / 2} y={svgHeight - 4} textAnchor="middle" fontSize="8" fill="#999">
        {AXIS_LABELS[heatmap.uAxis]} ({uLen.toFixed(1)}m)
      </text>
      <text transform={`translate(10, ${padT + drawH / 2}) rotate(-90)`} textAnchor="middle" fontSize="8" fill="#999">
        {AXIS_LABELS[heatmap.vAxis]} ({vLen.toFixed(1)}m)
      </text>

      {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
        <g key={`cb-${i}`}>
          <rect x={svgWidth - 25} y={padT + (1 - v) * drawH - 2} width={12} height={drawH * 0.25 + 4} fill={heatColor(v)} />
        </g>
      ))}
      <text x={svgWidth - 12} y={padT - 4} textAnchor="middle" fontSize="7" fill="#999">1.0</text>
      <text x={svgWidth - 12} y={padT + drawH + 8} textAnchor="middle" fontSize="7" fill="#999">0.0</text>
    </svg>
  );
}

export function HeatmapPanel({ matchedPeaks, fusionOverlayPeaks, room, speedOfSound, toleranceMs }: HeatmapPanelProps) {
  const combinedPeaks = useMemo(() => {
    if (!fusionOverlayPeaks || fusionOverlayPeaks.length === 0) return matchedPeaks;
    const toKey = (p: MatchedPeak) => `${(p.peak.delay_ms ?? 0).toFixed(3)}_${p.reflection?.surfaceLabel || ''}`;
    const existingKeys = new Set(matchedPeaks.map(toKey));
    const uniqueFusion = fusionOverlayPeaks.filter(fp => !existingKeys.has(toKey(fp)));
    return [...matchedPeaks, ...uniqueFusion];
  }, [matchedPeaks, fusionOverlayPeaks]);

  const heatmaps = useMemo<SurfaceHeatmap[]>(() => {
    return computeSurfaceHeatmaps(combinedPeaks, room, speedOfSound, toleranceMs);
  }, [combinedPeaks, room, speedOfSound, toleranceMs]);

  const baseHeatmaps = useMemo<SurfaceHeatmap[]>(() => {
    if (!fusionOverlayPeaks || fusionOverlayPeaks.length === 0) return heatmaps;
    return computeSurfaceHeatmaps(matchedPeaks, room, speedOfSound, toleranceMs);
  }, [matchedPeaks, fusionOverlayPeaks, room, speedOfSound, toleranceMs, heatmaps]);

  const hasAnyData = heatmaps.some(h => h.reflectionPoints.length > 0);
  const hasFusion = fusionOverlayPeaks && fusionOverlayPeaks.length > 0;

  return (
    <div className="space-y-4" data-testid="heatmap-panel">
      <div className="flex items-center gap-2">
        <Flame className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-semibold">Treatment Target Heatmaps</h3>
        {hasFusion && (
          <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">+ fusion data</span>
        )}
      </div>

      {!hasAnyData ? (
        <Card className="p-4 text-center text-sm text-muted-foreground">
          No assigned reflection points to generate heatmaps.
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {heatmaps.map(hm => (
              <Card key={hm.surfaceLabel} className="p-2">
                <HeatmapSVG heatmap={hm} />
                <div className="mt-1 px-2">
                  {(() => {
                    const baseHm = baseHeatmaps.find(b => b.surfaceLabel === hm.surfaceLabel);
                    const assignedRefl = baseHm ? baseHm.reflectionPoints.length : hm.reflectionPoints.length;
                    const supportPts = hm.reflectionPoints.length;
                    return (
                      <div className="text-[8px] text-muted-foreground">
                        Assigned reflections: {assignedRefl}{hasFusion ? `, Support points: ${supportPts}` : ''}
                      </div>
                    );
                  })()}
                </div>
                {hm.hotspots.length > 0 && (
                  <div className="mt-1 px-2">
                    <div className="text-[9px] font-medium mb-1">Top Hotspots:</div>
                    {hm.hotspots.map((hs, i) => (
                      <div key={i} className="text-[8px] text-muted-foreground">
                        #{i + 1}: ({hs.x.toFixed(2)}, {hs.y.toFixed(2)}, {hs.z.toFixed(2)}) — intensity: {(hs.value * 100).toFixed(0)}%
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
