import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ReferenceLine, ReferenceArea, Legend
} from "recharts";
import type { ETCPoint, MatchedPeak, FusionIRDataset, Peak } from "@shared/schema";
import { computeETC, findDirectArrival, detectPeaks } from "@/lib/dsp";

interface ETCChartProps {
  etcData: ETCPoint[];
  matchedPeaks: MatchedPeak[];
  earlyWindowMs: number;
  thresholdDb: number;
  mode: 'ir-only' | 'geometry';
  fusionDatasets?: FusionIRDataset[];
  fusionPerIRPeaks?: { label: string; peaks: Peak[] }[];
}

const FUSION_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981'];

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null;
  return (
    <div className="bg-popover border border-popover-border rounded-md p-2 shadow-lg text-xs">
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>
          <span className="font-medium">{p.payload.time?.toFixed(2)} ms</span>{' — '}
          <span>{p.value?.toFixed(1)} dB</span>
          {p.name !== 'level' && <span className="text-muted-foreground ml-1">({p.name})</span>}
        </p>
      ))}
    </div>
  );
}

export function ETCChart({ etcData, matchedPeaks, earlyWindowMs, thresholdDb, mode, fusionDatasets, fusionPerIRPeaks }: ETCChartProps) {
  const fusionETCs = useMemo(() => {
    if (!fusionDatasets || fusionDatasets.length === 0) return [];
    return fusionDatasets.map(ds => {
      const directIdx = findDirectArrival(ds.irData);
      return {
        label: ds.label,
        data: computeETC(ds.irData, 0.1, directIdx),
      };
    });
  }, [fusionDatasets]);

  const hasFusion = fusionETCs.length > 0;

  const chartData = useMemo(() => {
    const maxTime = earlyWindowMs * 1.5;

    if (hasFusion) {
      const timeMap = new Map<number, Record<string, number>>();

      for (let fi = 0; fi < fusionETCs.length; fi++) {
        const data = fusionETCs[fi].data.filter(p => p.time <= maxTime);
        const step = Math.max(1, Math.floor(data.length / 800));
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

    if (!etcData.length) return [];
    return etcData.filter(p => p.time <= maxTime);
  }, [etcData, earlyWindowMs, fusionETCs, hasFusion]);

  const peakMarkers = useMemo(() => {
    return matchedPeaks.map((mp, i) => ({
      time: mp.peak.delay_ms,
      level: mp.peak.rel_dB,
      assigned: mp.assigned,
      surface: mp.reflection?.surfaceLabel || 'Unknown',
      confidence: mp.confidence,
      severity: mp.peak.severity,
      rank: i + 1,
    }));
  }, [matchedPeaks]);

  if (!chartData.length) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm" data-testid="etc-chart-empty">
        Upload an IR file to see the Energy Time Curve
      </div>
    );
  }

  return (
    <div className="w-full" data-testid="etc-chart">
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
          <XAxis
            dataKey="time"
            type="number"
            domain={[0, 'auto']}
            label={{ value: 'Time (ms)', position: 'insideBottom', offset: -10, style: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } }}
            tick={{ fontSize: 10 }}
            stroke="hsl(var(--muted-foreground))"
          />
          <YAxis
            domain={[-60, 5]}
            tickFormatter={(v: number) => v.toFixed(0)}
            label={{ value: 'Level (dB)', angle: -90, position: 'insideLeft', offset: 5, style: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } }}
            tick={{ fontSize: 10 }}
            stroke="hsl(var(--muted-foreground))"
          />
          <Tooltip content={<CustomTooltip />} />

          <ReferenceArea
            x1={0}
            x2={earlyWindowMs}
            fill="hsl(var(--primary))"
            fillOpacity={0.04}
          />

          <ReferenceLine
            y={thresholdDb}
            stroke="hsl(var(--destructive))"
            strokeDasharray="4 4"
            strokeOpacity={0.5}
          />

          {!hasFusion && (
            <Line
              type="monotone"
              dataKey="level"
              stroke="hsl(var(--primary))"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          )}

          {hasFusion && fusionETCs.map((fe, i) => (
            <Line
              key={`ir${i}`}
              type="monotone"
              dataKey={`ir${i}`}
              stroke={FUSION_COLORS[i % FUSION_COLORS.length]}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              name={fe.label}
            />
          ))}

          {hasFusion && <Legend />}

          {!hasFusion && peakMarkers.map((pm, i) => (
            <ReferenceLine
              key={`pk-${i}`}
              x={pm.time}
              stroke={pm.assigned ? "hsl(var(--chart-2))" : "hsl(var(--chart-4))"}
              strokeDasharray={pm.assigned ? "none" : "2 2"}
              strokeWidth={pm.assigned ? 1.5 : 1}
              strokeOpacity={0.7}
            />
          ))}

          {hasFusion && fusionPerIRPeaks && fusionPerIRPeaks.map((irPeaks, irIdx) =>
            irPeaks.peaks.map((pk, pkIdx) => (
              <ReferenceLine
                key={`fir${irIdx}-pk${pkIdx}`}
                x={pk.delay_ms}
                stroke={FUSION_COLORS[irIdx % FUSION_COLORS.length]}
                strokeDasharray="none"
                strokeWidth={1}
                strokeOpacity={0.6}
              />
            ))
          )}
        </LineChart>
      </ResponsiveContainer>

      <div className="flex flex-wrap gap-3 mt-2 px-2">
        {hasFusion && (
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="font-medium">Fusion: {fusionETCs.length} IRs overlaid</span>
          </div>
        )}
        {!hasFusion && peakMarkers.length > 0 && (
          <>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <div className="w-4 h-0.5 bg-[hsl(var(--chart-2))]" />
              <span>Assigned peaks</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <div className="w-4 h-0.5 bg-[hsl(var(--chart-4))] border-dashed" style={{ borderTop: '1px dashed' }} />
              <span>Unassigned peaks</span>
            </div>
          </>
        )}
        {hasFusion && fusionPerIRPeaks && fusionPerIRPeaks.map((irPeaks, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <div className="w-4 h-0.5" style={{ backgroundColor: FUSION_COLORS[i % FUSION_COLORS.length] }} />
            <span>{irPeaks.label} peaks ({irPeaks.peaks.length})</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <div className="w-4 h-0.5 bg-destructive/50" style={{ borderTop: '1px dashed' }} />
          <span>Threshold ({thresholdDb} dB)</span>
        </div>
      </div>
    </div>
  );
}
