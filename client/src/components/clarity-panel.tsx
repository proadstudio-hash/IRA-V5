import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Volume2 } from "lucide-react";
import type { IRData, FusionIRDataset } from "@shared/schema";
import { computeClarityMetrics, type ClarityResult } from "@/lib/clarity-metrics";
import { findDirectArrival } from "@/lib/dsp";

interface ClarityPanelProps {
  irData: IRData;
  fusionDatasets?: FusionIRDataset[];
}

export function ClarityPanel({ irData, fusionDatasets }: ClarityPanelProps) {
  const result = useMemo<ClarityResult>(() => {
    const directIdx = findDirectArrival(irData);
    return computeClarityMetrics(irData, directIdx);
  }, [irData]);

  const fusionResults = useMemo(() => {
    if (!fusionDatasets || fusionDatasets.length === 0) return [];
    return fusionDatasets.map(ds => {
      const directIdx = findDirectArrival(ds.irData);
      return {
        label: ds.label,
        result: computeClarityMetrics(ds.irData, directIdx),
      };
    });
  }, [fusionDatasets]);

  const avgResult = useMemo(() => {
    if (fusionResults.length === 0) return null;
    const all = fusionResults.map(fr => fr.result);
    const avg = (vals: (number | null)[]) => {
      const valid = vals.filter((v): v is number => v !== null);
      return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    };
    return {
      c50: avg(all.map(r => r.c50)),
      c80: avg(all.map(r => r.c80)),
      d50: avg(all.map(r => r.d50)),
      ts_ms: avg(all.map(r => r.ts_ms)),
    };
  }, [fusionResults]);

  const hasFusion = fusionResults.length > 0;
  const displayResult = avgResult || result;

  return (
    <div className="space-y-4" data-testid="clarity-panel">
      <div className="flex items-center gap-2">
        <Volume2 className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-semibold">Clarity & Definition Metrics</h3>
        {hasFusion && (
          <Badge variant="secondary" className="text-[9px]">Fusion Average</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className={`p-3 text-center ${hasFusion ? 'border-primary/30' : ''}`}>
          <div className="text-[10px] text-muted-foreground">C50 (Speech){hasFusion ? ' avg' : ''}</div>
          <div className="text-lg font-bold" data-testid="text-c50">
            {displayResult.c50 !== null ? `${displayResult.c50.toFixed(2)} dB` : 'N/A'}
          </div>
          <div className="text-[9px] text-muted-foreground">Early/Late energy ratio (50 ms)</div>
        </Card>
        <Card className={`p-3 text-center ${hasFusion ? 'border-primary/30' : ''}`}>
          <div className="text-[10px] text-muted-foreground">D50 (Definition){hasFusion ? ' avg' : ''}</div>
          <div className="text-lg font-bold" data-testid="text-d50">
            {displayResult.d50 !== null ? `${displayResult.d50.toFixed(1)} %` : 'N/A'}
          </div>
          <div className="text-[9px] text-muted-foreground">Early energy fraction (50 ms)</div>
        </Card>
        <Card className={`p-3 text-center ${hasFusion ? 'border-primary/30' : ''}`}>
          <div className="text-[10px] text-muted-foreground">C80 (Music){hasFusion ? ' avg' : ''}</div>
          <div className="text-lg font-bold" data-testid="text-c80">
            {displayResult.c80 !== null ? `${displayResult.c80.toFixed(2)} dB` : 'N/A'}
          </div>
          <div className="text-[9px] text-muted-foreground">Early/Late energy ratio (80 ms)</div>
        </Card>
        <Card className={`p-3 text-center ${hasFusion ? 'border-primary/30' : ''}`}>
          <div className="text-[10px] text-muted-foreground">Ts (Centre Time){hasFusion ? ' avg' : ''}</div>
          <div className="text-lg font-bold" data-testid="text-ts">
            {displayResult.ts_ms !== null ? `${displayResult.ts_ms.toFixed(1)} ms` : 'N/A'}
          </div>
          <div className="text-[9px] text-muted-foreground">Energy centre of gravity</div>
        </Card>
      </div>

      {hasFusion && (
        <Card className="p-3">
          <div className="text-xs font-medium mb-2">Individual IR Clarity</div>
          <div className="overflow-x-auto">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-1 font-medium">IR</th>
                  <th className="text-left p-1 font-medium">C50 (dB)</th>
                  <th className="text-left p-1 font-medium">D50 (%)</th>
                  <th className="text-left p-1 font-medium">C80 (dB)</th>
                  <th className="text-left p-1 font-medium">Ts (ms)</th>
                </tr>
              </thead>
              <tbody>
                {fusionResults.map((fr, i) => (
                  <tr key={i} className="border-b border-muted/20">
                    <td className="p-1 font-medium">{fr.label}</td>
                    <td className="p-1">{fr.result.c50 !== null ? fr.result.c50.toFixed(2) : 'N/A'}</td>
                    <td className="p-1">{fr.result.d50 !== null ? fr.result.d50.toFixed(1) : 'N/A'}</td>
                    <td className="p-1">{fr.result.c80 !== null ? fr.result.c80.toFixed(2) : 'N/A'}</td>
                    <td className="p-1">{fr.result.ts_ms !== null ? fr.result.ts_ms.toFixed(1) : 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-3">
        <div className="text-xs font-medium mb-1">Interpretation</div>
        <p className="text-[10px] text-muted-foreground leading-relaxed" data-testid="text-clarity-interpretation">
          {result.interpretation}
        </p>
      </Card>

      <Card className="p-3">
        <div className="text-xs font-medium mb-1">Reference Ranges</div>
        <div className="text-[10px] text-muted-foreground space-y-1">
          <p><strong>C50 &gt; 2 dB:</strong> Good speech intelligibility. <strong>C50 &lt; -2 dB:</strong> Poor.</p>
          <p><strong>C80 &gt; 2 dB:</strong> Clear music definition. <strong>C80 &lt; -2 dB:</strong> Reverberant, less defined.</p>
          <p><strong>D50 &gt; 50%:</strong> Good speech clarity. <strong>D50 &lt; 30%:</strong> Very reverberant.</p>
          <p><strong>Ts:</strong> Lower values = closer/more intimate. Higher values = distant/diffuse.</p>
        </div>
      </Card>
    </div>
  );
}
