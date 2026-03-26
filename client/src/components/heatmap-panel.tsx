import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Flame } from "lucide-react";
import type { MatchedPeak, RoomDimensions, CeilingConfig } from "@shared/schema";
import { computeSurfaceHeatmaps, type SurfaceHeatmap } from "@/lib/surface-heatmaps";

interface HeatmapPanelProps {
  matchedPeaks: MatchedPeak[];
  fusionOverlayPeaks?: MatchedPeak[];
  room: RoomDimensions;
  speedOfSound: number;
  toleranceMs: number;
  ceiling?: CeilingConfig;
}

function heatColor(value: number): string {
  if (value < 0.01) return 'rgb(240,240,255)';
  const r = Math.round(255 * Math.min(1, value * 2));
  const g = Math.round(255 * Math.max(0, 1 - value * 2));
  const b = Math.round(80 * (1 - value));
  return `rgb(${r},${g},${b})`;
}

function criticalZoneColor(value: number): string {
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

function generateRulerTicks(length: number, step: number): number[] {
  const ticks: number[] = [];
  for (let v = 0; v <= length + 0.001; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

function HeatmapSVG({ heatmap, colorFn = heatColor, titleOverride, idPrefix = '' }: { heatmap: SurfaceHeatmap; colorFn?: (v: number) => string; titleOverride?: string; idPrefix?: string }) {
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

  const mapU = (u: number) => {
    const frac = (u - heatmap.uRange[0]) / uLen;
    return heatmap.reverseH ? padL + (1 - frac) * drawW : padL + frac * drawW;
  };
  const mapV = (v: number) => {
    const frac = (v - heatmap.vRange[0]) / vLen;
    return heatmap.reverseV ? padT + frac * drawH : padT + (1 - frac) * drawH;
  };

  const mapCellI = (i: number) => {
    return heatmap.reverseH ? padL + (heatmap.gridWidth - 1 - i) * cellW : padL + i * cellW;
  };
  const mapCellJ = (j: number) => {
    return heatmap.reverseV ? padT + j * cellH : padT + (heatmap.gridHeight - 1 - j) * cellH;
  };

  const hTicks = generateRulerTicks(uLen, uLen > 3 ? 1.0 : 0.5);
  const vTicks = generateRulerTicks(vLen, vLen > 3 ? 1.0 : 0.5);

  return (
    <svg width={svgWidth} height={svgHeight} className="border rounded">
      <defs>
        <filter id={`${idPrefix}blur-${heatmap.surfaceLabel.replace(/\s+/g, '-')}`}>
          <feGaussianBlur stdDeviation={`${cellW * 0.6} ${cellH * 0.6}`} />
        </filter>
        <clipPath id={`${idPrefix}clip-${heatmap.surfaceLabel.replace(/\s+/g, '-')}`}>
          {heatmap.ceilingProfile ? (
            <polygon points={[
              `${padL},${padT + drawH}`,
              `${padL + drawW},${padT + drawH}`,
              ...[...heatmap.ceilingProfile].map(pt => ({
                px: mapU(pt.u),
                py: mapV(pt.v),
              })).sort((a, b) => b.px - a.px).map(p => `${p.px},${p.py}`),
            ].join(' ')} />
          ) : (
            <rect x={padL} y={padT} width={drawW} height={drawH} />
          )}
        </clipPath>
      </defs>
      <text x={padL + drawW / 2} y={14} textAnchor="middle" fontSize="11" fontWeight="bold" fill="currentColor">
        {titleOverride ?? `${heatmap.surfaceLabel} (Refl: ${heatmap.reflectionPoints.length})`}
      </text>

      <g filter={`url(#${idPrefix}blur-${heatmap.surfaceLabel.replace(/\s+/g, '-')})`}
         clipPath={`url(#${idPrefix}clip-${heatmap.surfaceLabel.replace(/\s+/g, '-')})`}>
        {heatmap.grid.map((row, j) =>
          row.map((cell, i) => (
            <rect
              key={`${j}-${i}`}
              x={mapCellI(i)}
              y={mapCellJ(j)}
              width={cellW + 0.5}
              height={cellH + 0.5}
              fill={colorFn(cell.value)}
            />
          ))
        )}
      </g>

      {heatmap.ceilingProfile ? (
        <g>
          <line x1={padL} y1={padT + drawH} x2={padL + drawW} y2={padT + drawH} stroke="#666" strokeWidth="1" />
          {(() => {
            const mapped = heatmap.ceilingProfile.map(pt => ({
              px: mapU(pt.u),
              py: mapV(pt.v),
            }));
            mapped.sort((a, b) => a.px - b.px);
            const leftPt = mapped[0];
            const rightPt = mapped[mapped.length - 1];
            return (
              <>
                <line x1={leftPt.px} y1={padT + drawH} x2={leftPt.px} y2={leftPt.py} stroke="#666" strokeWidth="1" />
                <line x1={rightPt.px} y1={padT + drawH} x2={rightPt.px} y2={rightPt.py} stroke="#666" strokeWidth="1" />
                <polyline
                  points={mapped.map(p => `${p.px},${p.py}`).join(' ')}
                  fill="none" stroke="#666" strokeWidth="1"
                />
              </>
            );
          })()}
        </g>
      ) : (
        <rect x={padL} y={padT} width={drawW} height={drawH} fill="none" stroke="#666" strokeWidth="1" />
      )}

      {hTicks.map((t, i) => {
        const px = mapU(t);
        return (
          <g key={`ht-${i}`}>
            <line x1={px} y1={padT + drawH} x2={px} y2={padT + drawH + 4} stroke="#999" strokeWidth="0.5" />
            <text x={px} y={padT + drawH + 12} textAnchor="middle" fontSize="7" fill="#999">
              {t.toFixed(1)}
            </text>
          </g>
        );
      })}
      {vTicks.map((t, i) => {
        const py = mapV(t);
        return (
          <g key={`vt-${i}`}>
            <line x1={padL - 4} y1={py} x2={padL} y2={py} stroke="#999" strokeWidth="0.5" />
            <text x={padL - 6} y={py + 3} textAnchor="end" fontSize="7" fill="#999">
              {t.toFixed(1)}
            </text>
          </g>
        );
      })}

      {heatmap.reflectionPoints.map((rp, i) => {
        const px = mapU(rp.u);
        const py = mapV(rp.v);
        return (
          <g key={i}>
            <circle cx={px} cy={py} r="4" fill="none" stroke="#000" strokeWidth="1.5" />
            <circle cx={px} cy={py} r="1.5" fill="#000" />
          </g>
        );
      })}

      {heatmap.hotspots.map((hs, i) => {
        const px = mapU(hs.u);
        const py = mapV(hs.v);
        return (
          <g key={`hs-${i}`}>
            <circle cx={px} cy={py} r="8" fill="none" stroke="#ff0000" strokeWidth="2" strokeDasharray="3 2" />
            <text x={px + 10} y={py - 2} fontSize="7" fill="#ff0000" fontWeight="bold">
              #{i + 1}
            </text>
          </g>
        );
      })}

      <text x={padL + drawW / 2} y={svgHeight - 2} textAnchor="middle" fontSize="8" fill="#999">
        {heatmap.hLabel} ({uLen.toFixed(1)}m)
      </text>
      <text transform={`translate(10, ${padT + drawH / 2}) rotate(-90)`} textAnchor="middle" fontSize="8" fill="#999">
        {heatmap.vLabel} ({vLen.toFixed(1)}m)
      </text>

      {[0, 0.25, 0.5, 0.75, 1].map((v, i) => (
        <g key={`cb-${i}`}>
          <rect x={svgWidth - 25} y={padT + (1 - v) * drawH - 2} width={12} height={drawH * 0.25 + 4} fill={colorFn(v)} />
        </g>
      ))}
      <text x={svgWidth - 12} y={padT - 4} textAnchor="middle" fontSize="7" fill="#999">1.0</text>
      <text x={svgWidth - 12} y={padT + drawH + 8} textAnchor="middle" fontSize="7" fill="#999">0.0</text>
    </svg>
  );
}

export function HeatmapPanel({ matchedPeaks, fusionOverlayPeaks, room, speedOfSound, toleranceMs, ceiling }: HeatmapPanelProps) {
  const combinedPeaks = useMemo(() => {
    if (!fusionOverlayPeaks || fusionOverlayPeaks.length === 0) return matchedPeaks;
    const toKey = (p: MatchedPeak) => `${(p.peak.delay_ms ?? 0).toFixed(3)}_${p.reflection?.surfaceLabel || ''}`;
    const existingKeys = new Set(matchedPeaks.map(toKey));
    const uniqueFusion = fusionOverlayPeaks.filter(fp => !existingKeys.has(toKey(fp)));
    return [...matchedPeaks, ...uniqueFusion];
  }, [matchedPeaks, fusionOverlayPeaks]);

  const heatmaps = useMemo<SurfaceHeatmap[]>(() => {
    return computeSurfaceHeatmaps(combinedPeaks, room, speedOfSound, toleranceMs, 30, ceiling);
  }, [combinedPeaks, room, speedOfSound, toleranceMs, ceiling]);

  const baseHeatmaps = useMemo<SurfaceHeatmap[]>(() => {
    if (!fusionOverlayPeaks || fusionOverlayPeaks.length === 0) return heatmaps;
    return computeSurfaceHeatmaps(matchedPeaks, room, speedOfSound, toleranceMs, 30, ceiling);
  }, [matchedPeaks, fusionOverlayPeaks, room, speedOfSound, toleranceMs, heatmaps, ceiling]);

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

          <div className="flex items-center gap-2 mt-6">
            <Flame className="w-5 h-5 text-destructive" />
            <h3 className="text-sm font-semibold">Critical Zones</h3>
          </div>
          <div className="text-[10px] text-muted-foreground -mt-2">
            Red = most critical (highest reflection energy), Yellow = moderate, Green = low priority
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {heatmaps.map(hm => (
              <Card key={`cz-${hm.surfaceLabel}`} className="p-2">
                <HeatmapSVG heatmap={hm} colorFn={criticalZoneColor} idPrefix="cz-"
                  titleOverride={`${hm.surfaceLabel}`} />
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
