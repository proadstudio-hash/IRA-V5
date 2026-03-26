import { useMemo } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import type { MatchedPeak, SurfaceSummary, AnalysisMode, FusionIRDataset, Peak } from "@shared/schema";
import { exportPeaksCSV, exportSurfacesCSV, computeSurfaceSummaries } from "@/lib/matching";
import { downloadFile } from "@/lib/project";

interface ResultsTablesProps {
  matchedPeaks: MatchedPeak[];
  surfaceSummaries: SurfaceSummary[];
  mode: AnalysisMode;
  speedOfSound: number;
  fusionOverlayPeaks?: MatchedPeak[];
  fusionPerIRPeaks?: { label: string; peaks: Peak[] }[];
}

export interface MergedPeak {
  peak: MatchedPeak;
  irSources: string[];
}

const DEDUP_TOLERANCE_MS = 0.5;

function peakToMatchedPeak(pk: Peak): MatchedPeak {
  return {
    peak: pk,
    confidence: 0,
    timeError: 0,
    assigned: false,
  };
}

export function mergeAndDeduplicatePeaks(
  matchedPeaks: MatchedPeak[],
  fusionOverlayPeaks: MatchedPeak[] | undefined,
  fusionPerIRPeaks: { label: string; peaks: Peak[] }[] | undefined,
  mainIRLabel: string
): MergedPeak[] {
  const hasFusionData = (fusionPerIRPeaks && fusionPerIRPeaks.length > 0) ||
    (fusionOverlayPeaks && fusionOverlayPeaks.length > 0);

  if (!hasFusionData) {
    return matchedPeaks.map(mp => ({ peak: mp, irSources: [mainIRLabel] }));
  }

  const allPeaks: { mp: MatchedPeak; source: string }[] = [];

  for (const mp of matchedPeaks) {
    allPeaks.push({ mp, source: mainIRLabel });
  }

  if (fusionOverlayPeaks) {
    for (const fmp of fusionOverlayPeaks) {
      let source = 'Fusion';
      if (fusionPerIRPeaks) {
        let bestLabel = '';
        let bestDist = Infinity;
        for (const irSet of fusionPerIRPeaks) {
          for (const pk of irSet.peaks) {
            const d = Math.abs(pk.delay_ms - fmp.peak.delay_ms);
            if (d < bestDist) {
              bestDist = d;
              bestLabel = irSet.label;
            }
          }
        }
        if (bestDist < DEDUP_TOLERANCE_MS && bestLabel) {
          source = bestLabel;
        }
      }
      allPeaks.push({ mp: fmp, source });
    }
  }

  if (fusionPerIRPeaks) {
    for (const irSet of fusionPerIRPeaks) {
      for (const pk of irSet.peaks) {
        const alreadyCovered = allPeaks.some(
          ap => Math.abs(ap.mp.peak.delay_ms - pk.delay_ms) <= DEDUP_TOLERANCE_MS
        );
        if (!alreadyCovered) {
          allPeaks.push({ mp: peakToMatchedPeak(pk), source: irSet.label });
        }
      }
    }
  }

  allPeaks.sort((a, b) => a.mp.peak.delay_ms - b.mp.peak.delay_ms);

  const merged: MergedPeak[] = [];
  const used = new Set<number>();

  for (let i = 0; i < allPeaks.length; i++) {
    if (used.has(i)) continue;

    const group: { mp: MatchedPeak; source: string }[] = [allPeaks[i]];
    used.add(i);

    for (let j = i + 1; j < allPeaks.length; j++) {
      if (used.has(j)) continue;
      if (Math.abs(allPeaks[j].mp.peak.delay_ms - allPeaks[i].mp.peak.delay_ms) <= DEDUP_TOLERANCE_MS) {
        group.push(allPeaks[j]);
        used.add(j);
      } else {
        break;
      }
    }

    let best = group[0];
    for (const g of group) {
      if (g.mp.assigned && !best.mp.assigned) best = g;
      else if (g.mp.assigned && best.mp.assigned && g.mp.confidence > best.mp.confidence) best = g;
      else if (!g.mp.assigned && !best.mp.assigned && g.mp.peak.rel_dB > best.mp.peak.rel_dB) best = g;
    }

    const sources = [...new Set(group.map(g => g.source))];
    merged.push({ peak: best.mp, irSources: sources });
  }

  return merged;
}

function SeverityBadge({ severity }: { severity: number }) {
  if (severity >= -5) return <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{severity.toFixed(1)}</Badge>;
  if (severity >= -15) return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-orange-500/10 text-orange-600 dark:text-orange-400">{severity.toFixed(1)}</Badge>;
  return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{severity.toFixed(1)}</Badge>;
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  if (confidence >= 0.8) return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-green-500/10 text-green-600 dark:text-green-400">{(confidence * 100).toFixed(0)}%</Badge>;
  if (confidence >= 0.5) return <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">{(confidence * 100).toFixed(0)}%</Badge>;
  return <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{(confidence * 100).toFixed(0)}%</Badge>;
}

export function ResultsTables({ matchedPeaks, surfaceSummaries, mode, speedOfSound, fusionOverlayPeaks, fusionPerIRPeaks }: ResultsTablesProps) {
  const hasFusion = !!(fusionOverlayPeaks && fusionOverlayPeaks.length > 0) ||
    !!(fusionPerIRPeaks && fusionPerIRPeaks.length > 0);
  const mainIRLabel = fusionPerIRPeaks && fusionPerIRPeaks.length > 0
    ? fusionPerIRPeaks[0].label
    : 'Primary';

  const mergedPeaks = useMemo(() => {
    return mergeAndDeduplicatePeaks(matchedPeaks, fusionOverlayPeaks, fusionPerIRPeaks, mainIRLabel);
  }, [matchedPeaks, fusionOverlayPeaks, fusionPerIRPeaks, mainIRLabel]);

  const mergedSurfaceSummaries = useMemo(() => {
    if (!hasFusion) return surfaceSummaries;
    const allAssigned = mergedPeaks.map(m => m.peak).filter(mp => mp.assigned && mp.reflection);
    return computeSurfaceSummaries(allAssigned);
  }, [mergedPeaks, surfaceSummaries, hasFusion]);

  if (!mergedPeaks.length) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm" data-testid="results-empty">
        No peaks detected. Upload an IR file and run analysis.
      </div>
    );
  }

  const handleExportPeaks = () => {
    const peaksForExport = mergedPeaks.map(mp => mp.peak);
    const csv = exportPeaksCSV(peaksForExport, mode, speedOfSound);
    downloadFile(csv, 'peaks.csv', 'text/csv');
  };

  const handleExportSurfaces = () => {
    const csv = exportSurfacesCSV(mergedSurfaceSummaries);
    downloadFile(csv, 'surfaces.csv', 'text/csv');
  };

  return (
    <Tabs defaultValue="peaks" className="w-full" data-testid="results-tabs">
      <div className="flex items-center justify-between gap-2 mb-2">
        <TabsList className="h-8">
          <TabsTrigger value="peaks" className="text-xs px-3" data-testid="tab-peaks">
            Peak Analysis ({mergedPeaks.length})
          </TabsTrigger>
          {mode === 'geometry' && mergedSurfaceSummaries.length > 0 && (
            <TabsTrigger value="surfaces" className="text-xs px-3" data-testid="tab-surfaces">
              By Surface ({mergedSurfaceSummaries.length})
            </TabsTrigger>
          )}
        </TabsList>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleExportPeaks}
          data-testid="button-export-csv"
        >
          <Download className="w-3 h-3 mr-1" /> CSV
        </Button>
      </div>

      <TabsContent value="peaks" className="mt-0">
        <div className="rounded-md border overflow-auto max-h-[400px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px] w-10">#</TableHead>
                {hasFusion && <TableHead className="text-[11px]">IR Source</TableHead>}
                <TableHead className="text-[11px]">Delay (ms)</TableHead>
                <TableHead className="text-[11px]">Level (dB)</TableHead>
                <TableHead className="text-[11px]">ΔL (m)</TableHead>
                {mode === 'geometry' && (
                  <TableHead className="text-[11px]">L_refl (m)</TableHead>
                )}
                <TableHead className="text-[11px]">Severity</TableHead>
                {mode === 'geometry' && (
                  <>
                    <TableHead className="text-[11px]">Surface</TableHead>
                    <TableHead className="text-[11px]">Pred. Delay</TableHead>
                    <TableHead className="text-[11px]">Err (ms)</TableHead>
                    <TableHead className="text-[11px]">Confidence</TableHead>
                    <TableHead className="text-[11px]">P* (x,y,z)</TableHead>
                    <TableHead className="text-[11px]">|S-P*|</TableHead>
                    <TableHead className="text-[11px]">|P*-M|</TableHead>
                    <TableHead className="text-[11px]" title="L_refl predicted = |S-P*| + |P*-M|">L_pred (m)</TableHead>
                    <TableHead className="text-[11px]">Bounds</TableHead>
                  </>
                )}
                {mode === 'ir-only' && (
                  <TableHead className="text-[11px]">Equiv. Dist (m)</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {mergedPeaks.map((merged, i) => {
                const mp = merged.peak;
                return (
                  <TableRow key={i} className={!mp.assigned && mode === 'geometry' ? 'opacity-60' : ''} data-testid={`row-peak-${i}`}>
                    <TableCell className="text-xs font-mono">{i + 1}</TableCell>
                    {hasFusion && (
                      <TableCell className="text-xs">
                        <div className="flex flex-wrap gap-0.5">
                          {merged.irSources.map((src, si) => (
                            <Badge key={si} variant="outline" className="text-[9px] px-1 py-0">{src}</Badge>
                          ))}
                        </div>
                      </TableCell>
                    )}
                    <TableCell className="text-xs font-mono">{mp.peak.delay_ms.toFixed(2)}</TableCell>
                    <TableCell className="text-xs font-mono">{mp.peak.rel_dB.toFixed(1)}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {(mp.peak.extraPathLength ?? ((mp.peak.delay_ms / 1000) * speedOfSound)).toFixed(3)}
                    </TableCell>
                    {mode === 'geometry' && (
                      <TableCell className="text-xs font-mono">
                        {(mp.peak.targetReflectedLength ?? 0).toFixed(3)}
                      </TableCell>
                    )}
                    <TableCell><SeverityBadge severity={mp.peak.severity} /></TableCell>
                    {mode === 'geometry' && (
                      <>
                        <TableCell className="text-xs">
                          {mp.assigned ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {mp.reflection!.surfaceLabel}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground italic text-[10px]">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {mp.assigned ? mp.reflection!.delay_ms.toFixed(2) : '-'}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {mp.assigned ? mp.timeError.toFixed(3) : '-'}
                        </TableCell>
                        <TableCell>
                          {mp.assigned ? <ConfidenceBadge confidence={mp.confidence} /> : '-'}
                        </TableCell>
                        <TableCell className="text-xs font-mono whitespace-nowrap">
                          {mp.assigned ? `(${mp.reflection!.reflectionPoint.x.toFixed(2)}, ${mp.reflection!.reflectionPoint.y.toFixed(2)}, ${mp.reflection!.reflectionPoint.z.toFixed(2)})` : '-'}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {mp.assigned ? mp.reflection!.speakerDistance.toFixed(3) : '-'}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {mp.assigned ? mp.reflection!.micDistance.toFixed(3) : '-'}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {mp.assigned ? (mp.reflection!.speakerDistance + mp.reflection!.micDistance).toFixed(3) : '-'}
                        </TableCell>
                        <TableCell className="text-xs">
                          {mp.assigned ? (
                            <span className={mp.reflection!.insideSurfaceBounds ? 'text-green-600 dark:text-green-400' : 'text-red-500'}>
                              {mp.reflection!.insideSurfaceBounds ? '✓' : '✗'}
                            </span>
                          ) : '-'}
                        </TableCell>
                      </>
                    )}
                    {mode === 'ir-only' && (
                      <TableCell className="text-xs font-mono">
                        {(mp.peak.equivalentDistance ?? ((mp.peak.delay_ms / 1000) * speedOfSound)).toFixed(3)}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      {mode === 'geometry' && (
        <TabsContent value="surfaces" className="mt-0">
          <div className="flex justify-end mb-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExportSurfaces}
              data-testid="button-export-surfaces-csv"
            >
              <Download className="w-3 h-3 mr-1" /> CSV
            </Button>
          </div>
          <div className="rounded-md border overflow-auto max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Surface</TableHead>
                  <TableHead className="text-[11px]">Peaks</TableHead>
                  <TableHead className="text-[11px]">Worst Severity</TableHead>
                  <TableHead className="text-[11px]">Earliest (ms)</TableHead>
                  <TableHead className="text-[11px]">Criticality</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mergedSurfaceSummaries.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {s.surfaceLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-mono">{s.peakCount}</TableCell>
                    <TableCell><SeverityBadge severity={s.worstSeverity} /></TableCell>
                    <TableCell className="text-xs font-mono">{s.earliestTime.toFixed(2)}</TableCell>
                    <TableCell className="text-xs font-mono">{s.totalSeverity.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      )}
    </Tabs>
  );
}
