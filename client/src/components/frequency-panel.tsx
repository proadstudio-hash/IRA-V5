import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend
} from "recharts";
import { Waves } from "lucide-react";
import type { IRData, MatchedPeak, FusionIRDataset } from "@shared/schema";
import { computeFrequencyResponse, computeCombSignatures, type FrequencyAnalysisResult, type CombSignature } from "@/lib/frequency-analysis";
import { findDirectArrival } from "@/lib/dsp";

interface FrequencyPanelProps {
  irData: IRData;
  matchedPeaks: MatchedPeak[];
  fusionDatasets?: FusionIRDataset[];
}

const FUSION_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981'];

export function FrequencyPanel({ irData, matchedPeaks, fusionDatasets }: FrequencyPanelProps) {
  const [smoothing, setSmoothing] = useState<string>('12');
  const [showNotches, setShowNotches] = useState(false);

  const directIdx = useMemo(() => findDirectArrival(irData), [irData]);

  const analysis = useMemo<FrequencyAnalysisResult>(() => {
    return computeFrequencyResponse(irData, directIdx, 300, parseInt(smoothing));
  }, [irData, directIdx, smoothing]);

  const fusionAnalyses = useMemo(() => {
    if (!fusionDatasets || fusionDatasets.length === 0) return [];
    return fusionDatasets.map(ds => {
      const dIdx = findDirectArrival(ds.irData);
      return {
        label: ds.label,
        analysis: computeFrequencyResponse(ds.irData, dIdx, 300, parseInt(smoothing)),
      };
    });
  }, [fusionDatasets, smoothing]);

  const combSignatures = useMemo<CombSignature[]>(() => {
    return computeCombSignatures(matchedPeaks, 5);
  }, [matchedPeaks]);

  const chartData = useMemo(() => {
    const source = analysis.smoothedSpectrum.length > 0 ? analysis.smoothedSpectrum : analysis.spectrum;
    const step = Math.max(1, Math.floor(source.length / 800));

    const freqMap = new Map<number, Record<string, number>>();
    const hasFusionData = fusionAnalyses.length > 0;

    if (hasFusionData) {
      for (let fi = 0; fi < fusionAnalyses.length; fi++) {
        const fa = fusionAnalyses[fi].analysis;
        const src = fa.smoothedSpectrum.length > 0 ? fa.smoothedSpectrum : fa.spectrum;
        const fStep = Math.max(1, Math.floor(src.length / 800));
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
    } else {
      for (let i = 0; i < source.length; i += step) {
        const freq = Math.round(source[i].frequency);
        if (freq < 20 || freq > 20000) continue;
        if (!freqMap.has(freq)) freqMap.set(freq, {});
        freqMap.get(freq)!.main = Math.round(source[i].magnitude_dB * 10) / 10;
      }
    }

    return Array.from(freqMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([freq, vals]) => ({ freq, ...vals }));
  }, [analysis, fusionAnalyses]);

  const notchFreqs = useMemo(() => {
    if (!showNotches) return [];
    const all: number[] = [];
    for (const sig of combSignatures) {
      all.push(...sig.notchFrequencies);
    }
    return [...new Set(all)].filter(f => f >= 20 && f <= 20000).sort((a, b) => a - b);
  }, [combSignatures, showNotches]);

  const hasFusion = fusionAnalyses.length > 0;

  return (
    <div className="space-y-4" data-testid="frequency-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Waves className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold">Frequency Response & Comb Impact</h3>
          {hasFusion && (
            <Badge variant="secondary" className="text-[9px]">Fusion: {fusionAnalyses.length} IRs</Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px]">Smoothing</Label>
            <Select value={smoothing} onValueChange={setSmoothing}>
              <SelectTrigger className="w-24 h-7 text-[10px]" data-testid="select-smoothing">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="12">1/12 octave</SelectItem>
                <SelectItem value="24">1/24 octave</SelectItem>
                <SelectItem value="1">None</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-1.5">
            <Label className="text-[10px]">Notch markers</Label>
            <Switch checked={showNotches} onCheckedChange={setShowNotches} data-testid="switch-notches" />
          </div>
        </div>
      </div>

      {chartData.length > 0 && (
        <Card className="p-4">
          <div className="text-xs font-medium mb-2">
            {hasFusion ? 'Frequency Response — Multi-IR Overlay' : 'Frequency Response'}
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 25, left: 15 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis
                dataKey="freq"
                type="number"
                scale="log"
                domain={[20, 20000]}
                ticks={[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]}
                tickFormatter={(v: number) => v >= 1000 ? `${v / 1000}k` : String(v)}
                label={{ value: 'Frequency (Hz)', position: 'insideBottom', offset: -10, style: { fontSize: 11 } }}
                tick={{ fontSize: 9 }}
              />
              <YAxis
                domain={[-60, 5]}
                label={{ value: 'Magnitude (dB)', angle: -90, position: 'insideLeft', offset: 5, style: { fontSize: 11 } }}
                tick={{ fontSize: 10 }}
              />
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(value: number, name: string) => {
                  if (name === 'avg') return [`${value.toFixed(1)} dB`, 'Average'];
                  const label = name === 'main' ? 'Main IR' : fusionAnalyses[parseInt(name.replace('ir', ''))]?.label || name;
                  return [`${value.toFixed(1)} dB`, label];
                }}
                labelFormatter={(label: number) => `${label} Hz`}
              />
              {hasFusion && <Legend formatter={(value: string) => {
                if (value === 'avg') return 'Average';
                const idx = parseInt(value.replace('ir', ''));
                return fusionAnalyses[idx]?.label || value;
              }} />}
              {!hasFusion && (
                <Line type="monotone" dataKey="main" stroke="#8b5cf6" strokeWidth={1} dot={false} isAnimationActive={false} name="main" />
              )}
              {fusionAnalyses.map((_, i) => (
                <Line
                  key={`ir${i}`}
                  type="monotone"
                  dataKey={`ir${i}`}
                  stroke={FUSION_COLORS[i % FUSION_COLORS.length]}
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                  name={`ir${i}`}
                  strokeDasharray={i % 2 === 0 ? "5 3" : "3 3"}
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
              {notchFreqs.slice(0, 20).map((f, i) => (
                <ReferenceLine key={i} x={f} stroke="#ef4444" strokeDasharray="2 2" strokeOpacity={0.4} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      {combSignatures.length > 0 && (
        <Card className="p-3">
          <div className="text-xs font-medium mb-2">Peak → Comb Filter Signature</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-1.5 font-medium">Delay (ms)</th>
                  <th className="text-left p-1.5 font-medium">Level (dB)</th>
                  <th className="text-left p-1.5 font-medium">Surface</th>
                  <th className="text-left p-1.5 font-medium">Comb Δf (Hz)</th>
                  <th className="text-left p-1.5 font-medium">First notch frequencies (Hz)</th>
                </tr>
              </thead>
              <tbody>
                {combSignatures.map((sig, i) => (
                  <tr key={i} className="border-b border-muted/30" data-testid={`row-comb-${i}`}>
                    <td className="p-1.5">{sig.delay_ms.toFixed(2)}</td>
                    <td className="p-1.5">{sig.rel_dB.toFixed(1)}</td>
                    <td className="p-1.5 text-muted-foreground">{sig.surface}</td>
                    <td className="p-1.5 font-mono">{sig.combSpacing_Hz}</td>
                    <td className="p-1.5 font-mono text-muted-foreground">
                      {sig.notchFrequencies.slice(0, 5).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
