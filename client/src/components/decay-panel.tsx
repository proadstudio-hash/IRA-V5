import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend
} from "recharts";
import { Clock } from "lucide-react";
import type { IRData, FusionIRDataset } from "@shared/schema";
import { computeDecayMetrics, type DecayMetricsResult } from "@/lib/decay-metrics";
import { findDirectArrival } from "@/lib/dsp";

interface DecayPanelProps {
  irData: IRData;
  fusionDatasets?: FusionIRDataset[];
}

const FUSION_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981'];

export function DecayPanel({ irData, fusionDatasets }: DecayPanelProps) {
  const metrics = useMemo<DecayMetricsResult>(() => {
    const directIdx = findDirectArrival(irData);
    return computeDecayMetrics(irData, directIdx);
  }, [irData]);

  const fusionMetrics = useMemo(() => {
    if (!fusionDatasets || fusionDatasets.length === 0) return [];
    return fusionDatasets.map(ds => {
      const directIdx = findDirectArrival(ds.irData);
      return {
        label: ds.label,
        metrics: computeDecayMetrics(ds.irData, directIdx),
      };
    });
  }, [fusionDatasets]);

  const avgMetrics = useMemo(() => {
    if (fusionMetrics.length === 0) return null;
    const allMetrics = fusionMetrics.map(fm => fm.metrics);
    const avg = (vals: (number | null)[]) => {
      const valid = vals.filter((v): v is number => v !== null);
      return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    };
    return {
      edt: avg(allMetrics.map(m => m.edt)),
      t20: avg(allMetrics.map(m => m.t20)),
      t30: avg(allMetrics.map(m => m.t30)),
      rt60: avg(allMetrics.map(m => m.rt60)),
    };
  }, [fusionMetrics]);

  const hasFusion = fusionMetrics.length > 0;

  const chartData = useMemo(() => {
    const timeSet = new Map<number, Record<string, number>>();

    if (hasFusion) {
      const maxLen = Math.max(...fusionMetrics.map(fm => fm.metrics.curve.length));
      const step = Math.max(1, Math.floor(maxLen / 800));

      for (let fi = 0; fi < fusionMetrics.length; fi++) {
        const curve = fusionMetrics[fi].metrics.curve;
        for (let i = 0; i < curve.length; i += step) {
          const t = Math.round(curve[i].time_ms * 10) / 10;
          if (!timeSet.has(t)) timeSet.set(t, {});
          timeSet.get(t)![`ir${fi}`] = Math.round(curve[i].level_dB * 10) / 10;
        }
      }

      for (const [t, vals] of timeSet) {
        const irVals = Object.entries(vals).filter(([k]) => k.startsWith('ir')).map(([, v]) => v);
        if (irVals.length > 0) {
          vals.avg = Math.round((irVals.reduce((a, b) => a + b, 0) / irVals.length) * 10) / 10;
        }
      }
    } else {
      const mainCurve = metrics.curve;
      const step = Math.max(1, Math.floor(mainCurve.length / 800));
      for (let i = 0; i < mainCurve.length; i += step) {
        const t = Math.round(mainCurve[i].time_ms * 10) / 10;
        if (!timeSet.has(t)) timeSet.set(t, {});
        timeSet.get(t)!.main = Math.round(mainCurve[i].level_dB * 10) / 10;
      }
    }

    return Array.from(timeSet.entries())
      .sort(([a], [b]) => a - b)
      .map(([time, vals]) => ({ time, ...vals }));
  }, [metrics.curve, fusionMetrics, hasFusion]);

  return (
    <div className="space-y-4" data-testid="decay-panel">
      <div className="flex items-center gap-2">
        <Clock className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-semibold">Schroeder Decay & Reverberation Metrics</h3>
        {hasFusion && (
          <Badge variant="secondary" className="text-[9px]">Fusion: {fusionMetrics.length} IRs</Badge>
        )}
      </div>

      {hasFusion && avgMetrics ? (
        <>
          <div className="text-[10px] font-medium text-muted-foreground mb-1">Fusion Average</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-3 text-center border-primary/30">
              <div className="text-[10px] text-muted-foreground">EDT (avg)</div>
              <div className="text-lg font-bold" data-testid="text-edt-avg">
                {avgMetrics.edt !== null ? `${avgMetrics.edt.toFixed(3)} s` : 'N/A'}
              </div>
            </Card>
            <Card className="p-3 text-center border-primary/30">
              <div className="text-[10px] text-muted-foreground">T20 (avg)</div>
              <div className="text-lg font-bold" data-testid="text-t20-avg">
                {avgMetrics.t20 !== null ? `${avgMetrics.t20.toFixed(3)} s` : 'N/A'}
              </div>
            </Card>
            <Card className="p-3 text-center border-primary/30">
              <div className="text-[10px] text-muted-foreground">T30 (avg)</div>
              <div className="text-lg font-bold" data-testid="text-t30-avg">
                {avgMetrics.t30 !== null ? `${avgMetrics.t30.toFixed(3)} s` : 'N/A'}
              </div>
            </Card>
            <Card className="p-3 text-center border-primary/30">
              <div className="text-[10px] text-muted-foreground">RT60 (avg)</div>
              <div className="text-lg font-bold" data-testid="text-rt60-avg">
                {avgMetrics.rt60 !== null ? `${avgMetrics.rt60.toFixed(3)} s` : 'N/A'}
              </div>
            </Card>
          </div>

          <div className="text-[10px] font-medium text-muted-foreground mt-3 mb-1">Individual IR Results</div>
          <div className="space-y-2">
            {fusionMetrics.map((fm, i) => (
              <div key={fm.label} className="grid grid-cols-5 gap-2 text-[10px] items-center">
                <span className="font-medium" style={{ color: FUSION_COLORS[i % FUSION_COLORS.length] }}>
                  {fm.label}
                </span>
                <span>EDT: {fm.metrics.edt !== null ? `${fm.metrics.edt.toFixed(3)} s` : 'N/A'}</span>
                <span>T20: {fm.metrics.t20 !== null ? `${fm.metrics.t20.toFixed(3)} s` : 'N/A'}</span>
                <span>T30: {fm.metrics.t30 !== null ? `${fm.metrics.t30.toFixed(3)} s` : 'N/A'}</span>
                <span>RT60: {fm.metrics.rt60 !== null ? `${fm.metrics.rt60.toFixed(3)} s` : 'N/A'}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-3 text-center">
            <div className="text-[10px] text-muted-foreground">EDT</div>
            <div className="text-lg font-bold" data-testid="text-edt">
              {metrics.edt !== null ? `${metrics.edt.toFixed(3)} s` : 'N/A'}
            </div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-[10px] text-muted-foreground">T20</div>
            <div className="text-lg font-bold" data-testid="text-t20">
              {metrics.t20 !== null ? `${metrics.t20.toFixed(3)} s` : 'N/A'}
            </div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-[10px] text-muted-foreground">T30</div>
            <div className="text-lg font-bold" data-testid="text-t30">
              {metrics.t30 !== null ? `${metrics.t30.toFixed(3)} s` : 'N/A'}
            </div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-[10px] text-muted-foreground">RT60 (est.)</div>
            <div className="text-lg font-bold" data-testid="text-rt60">
              {metrics.rt60 !== null ? `${metrics.rt60.toFixed(3)} s` : 'N/A'}
            </div>
          </Card>
        </div>
      )}

      {chartData.length > 0 && (
        <Card className="p-4">
          <div className="text-xs font-medium mb-2">
            Schroeder Integrated Decay Curve
            {hasFusion && ' — Multi-IR Overlay'}
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 25, left: 15 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="time"
                type="number"
                domain={[0, 'auto']}
                label={{ value: 'Time (ms)', position: 'insideBottom', offset: -10, style: { fontSize: 11 } }}
                tick={{ fontSize: 10 }}
              />
              <YAxis
                domain={[-70, 5]}
                label={{ value: 'Level (dB)', angle: -90, position: 'insideLeft', offset: 5, style: { fontSize: 11 } }}
                tick={{ fontSize: 10 }}
              />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(value: number, name: string) => {
                  if (name === 'main') return [`${value.toFixed(1)} dB`, 'Main IR'];
                  if (name === 'avg') return [`${value.toFixed(1)} dB`, 'Average'];
                  const idx = parseInt(name.replace('ir', ''));
                  const label = fusionMetrics[idx]?.label || name;
                  return [`${value.toFixed(1)} dB`, label];
                }}
                labelFormatter={(label: number) => `${label.toFixed(1)} ms`}
              />
              {hasFusion && <Legend formatter={(value: string) => {
                if (value === 'avg') return 'Average';
                const idx = parseInt(value.replace('ir', ''));
                return fusionMetrics[idx]?.label || value;
              }} />}
              {!hasFusion && (
                <Line type="monotone" dataKey="main" stroke="#8b5cf6" strokeWidth={1.5} dot={false} isAnimationActive={false} name="main" />
              )}
              {fusionMetrics.map((_, i) => (
                <Line
                  key={`ir${i}`}
                  type="monotone"
                  dataKey={`ir${i}`}
                  stroke={FUSION_COLORS[i % FUSION_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                  name={`ir${i}`}
                />
              ))}
              {hasFusion && (
                <Line
                  type="monotone"
                  dataKey="avg"
                  stroke="#000"
                  strokeWidth={2.5}
                  strokeDasharray="6 3"
                  dot={false}
                  isAnimationActive={false}
                  name="avg"
                />
              )}
              <ReferenceLine y={-10} stroke="#22c55e" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: '-10 dB', position: 'right', style: { fontSize: 8, fill: '#22c55e' } }} />
              <ReferenceLine y={-25} stroke="#3b82f6" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: '-25 dB', position: 'right', style: { fontSize: 8, fill: '#3b82f6' } }} />
              <ReferenceLine y={-35} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.5} label={{ value: '-35 dB', position: 'right', style: { fontSize: 8, fill: '#f59e0b' } }} />
            </LineChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground justify-center">
            <span><span className="inline-block w-3 h-[2px] bg-green-500 mr-1 align-middle" />EDT (0 to -10 dB)</span>
            <span><span className="inline-block w-3 h-[2px] bg-blue-500 mr-1 align-middle" />T20 (-5 to -25 dB)</span>
            <span><span className="inline-block w-3 h-[2px] bg-yellow-500 mr-1 align-middle" />T30 (-5 to -35 dB)</span>
          </div>
        </Card>
      )}

      <Card className="p-3">
        <div className="text-xs font-medium mb-1">Early vs Late Decay Analysis</div>
        <div className="text-[10px] text-muted-foreground space-y-1">
          {metrics.earlySlope !== null && (
            <p>Early slope (0 to -10 dB): {metrics.earlySlope.toFixed(4)} dB/ms</p>
          )}
          {metrics.lateSlope !== null && (
            <p>Late slope (-15 to -35 dB): {metrics.lateSlope.toFixed(4)} dB/ms</p>
          )}
          <p className="italic">{metrics.slopeInterpretation}</p>
        </div>
      </Card>
    </div>
  );
}
