import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Shield, AlertTriangle, CheckCircle, XCircle, SlidersHorizontal } from "lucide-react";
import type { MatchedPeak, Peak, FusionIRDataset } from "@shared/schema";
import { computeScorecard, type ScorecardPreset, type Verdict, type TrimSettings } from "@/lib/scorecard";
import { mergeAndDeduplicatePeaks } from "@/components/results-tables";

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  if (verdict === 'PASS') return <Badge className="bg-green-600 text-white" data-testid="badge-verdict-pass"><CheckCircle className="w-3 h-3 mr-1" />PASS</Badge>;
  if (verdict === 'WARN') return <Badge className="bg-yellow-500 text-white" data-testid="badge-verdict-warn"><AlertTriangle className="w-3 h-3 mr-1" />WARN</Badge>;
  return <Badge className="bg-red-600 text-white" data-testid="badge-verdict-fail"><XCircle className="w-3 h-3 mr-1" />FAIL</Badge>;
}

interface ScorecardPanelProps {
  matchedPeaks: MatchedPeak[];
  fusionMatchedPeaks?: MatchedPeak[];
  fusionOverlayPeaks?: MatchedPeak[];
  fusionPerIRPeaks?: { label: string; peaks: Peak[] }[];
}

export function ScorecardPanel({ matchedPeaks, fusionOverlayPeaks, fusionPerIRPeaks }: ScorecardPanelProps) {
  const [preset, setPreset] = useState<ScorecardPreset>('Mix');
  const [trim, setTrim] = useState<TrimSettings>({ excludeWorst: 0, excludeBest: 0 });

  const hasFusion = !!(fusionOverlayPeaks && fusionOverlayPeaks.length > 0) ||
    !!(fusionPerIRPeaks && fusionPerIRPeaks.length > 0);

  const mainIRLabel = fusionPerIRPeaks && fusionPerIRPeaks.length > 0
    ? fusionPerIRPeaks[0].label : 'Primary';

  const allPeaks = useMemo(() => {
    if (!hasFusion) return matchedPeaks;
    const merged = mergeAndDeduplicatePeaks(matchedPeaks, fusionOverlayPeaks, fusionPerIRPeaks, mainIRLabel);
    return merged.map(m => m.peak);
  }, [matchedPeaks, fusionOverlayPeaks, fusionPerIRPeaks, hasFusion, mainIRLabel]);

  const maxExclude = Math.max(0, Math.floor(allPeaks.length / 2) - 1);

  const scorecard = computeScorecard(allPeaks, preset, trim);

  const trimOptions = useMemo(() => {
    const opts: number[] = [];
    for (let i = 0; i <= Math.min(maxExclude, 5); i++) opts.push(i);
    return opts;
  }, [maxExclude]);

  return (
    <div className="space-y-4" data-testid="scorecard-panel">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold">Quality Gates Scorecard</h3>
        </div>
        <Select value={preset} onValueChange={(v) => setPreset(v as ScorecardPreset)}>
          <SelectTrigger className="w-32 h-8 text-xs" data-testid="select-preset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Mix">Mix</SelectItem>
            <SelectItem value="Vocal">Vocal</SelectItem>
            <SelectItem value="Podcast">Podcast</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2 space-y-1">
        <div>
          Scorecard computed from {scorecard.activePeaks} of {scorecard.totalPeaks} total peaks
          {hasFusion ? ' (merged from all analyzed IRs)' : ''}.
        </div>
        {(trim.excludeWorst > 0 || trim.excludeBest > 0) && (
          <div>
            Excluded: {trim.excludeWorst > 0 ? `${trim.excludeWorst} worst` : ''}
            {trim.excludeWorst > 0 && trim.excludeBest > 0 ? ', ' : ''}
            {trim.excludeBest > 0 ? `${trim.excludeBest} best (mildest)` : ''} peak(s) by severity.
          </div>
        )}
      </div>

      <Card className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground font-medium">Trim Outliers</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Exclude worst</Label>
            <Select
              value={String(trim.excludeWorst)}
              onValueChange={(v) => setTrim(prev => ({ ...prev, excludeWorst: Number(v) }))}
            >
              <SelectTrigger className="w-16 h-7 text-xs" data-testid="select-exclude-worst">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {trimOptions.map(n => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-[10px] text-muted-foreground whitespace-nowrap">Exclude best</Label>
            <Select
              value={String(trim.excludeBest)}
              onValueChange={(v) => setTrim(prev => ({ ...prev, excludeBest: Number(v) }))}
            >
              <SelectTrigger className="w-16 h-7 text-xs" data-testid="select-exclude-best">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {trimOptions.map(n => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ScorecardSection
          title="ITDG (Initial Time Delay Gap)"
          valueMs={scorecard.itdg.value_ms}
          verdict={scorecard.itdg.verdict}
          detail={scorecard.itdg.firstSignificantPeak}
        />
        <RFZSection
          title="RFZ Check (0-20 ms < -20 dB)"
          verdict={scorecard.rfz.verdict}
          worstDb={scorecard.rfz.worstDb}
          worstPeak={scorecard.rfz.worstPeak}
        />
        <CriticalSection
          title="Critical Early (0-10 ms < -15 dB)"
          verdict={scorecard.criticalEarly.verdict}
          worstDb={scorecard.criticalEarly.worstDb}
          worstPeak={scorecard.criticalEarly.worstPeak}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground font-medium mb-2">
            Peak Counts by Time Bin
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-lg font-bold" data-testid="text-bin-0-10">{scorecard.timeBins.bin_0_10}</div>
              <div className="text-[10px] text-muted-foreground">0-10 ms</div>
            </div>
            <div>
              <div className="text-lg font-bold" data-testid="text-bin-10-20">{scorecard.timeBins.bin_10_20}</div>
              <div className="text-[10px] text-muted-foreground">10-20 ms</div>
            </div>
            <div>
              <div className="text-lg font-bold" data-testid="text-bin-20-50">{scorecard.timeBins.bin_20_50}</div>
              <div className="text-[10px] text-muted-foreground">20-50 ms</div>
            </div>
          </div>
        </Card>

        <Card className="p-3">
          <div className="text-xs text-muted-foreground font-medium mb-2">
            Top 3 Worst Offenders
          </div>
          {scorecard.worstOffenders.length === 0 ? (
            <div className="text-[10px] text-muted-foreground">No peaks detected.</div>
          ) : (
            <div className="space-y-1">
              {scorecard.worstOffenders.map((wo, i) => (
                <div key={i} className="flex justify-between text-[10px]" data-testid={`row-offender-${i}`}>
                  <span className="font-medium">{wo.delay_ms.toFixed(1)} ms</span>
                  <span>{wo.rel_dB.toFixed(1)} dB</span>
                  <span className="text-muted-foreground truncate max-w-[80px]">{wo.assignedSurface}</span>
                  <span className="text-muted-foreground">{wo.assignedSurface !== 'Unassigned' ? `${(wo.confidence * 100).toFixed(0)}%` : '-'}</span>
                  <span className="text-muted-foreground">sev: {wo.severity.toFixed(1)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function ScorecardSection({ title, valueMs, verdict, detail }: {
  title: string;
  valueMs: number;
  verdict: Verdict;
  detail: MatchedPeak | null;
}) {
  return (
    <Card className="p-3 space-y-2">
      <div className="text-xs text-muted-foreground font-medium">{title}</div>
      <div className="flex items-center justify-between">
        <span className="text-lg font-bold" data-testid="text-itdg-value">
          {valueMs === Infinity ? 'N/A' : `${valueMs.toFixed(1)} ms`}
        </span>
        <VerdictBadge verdict={verdict} />
      </div>
      {detail && (
        <div className="text-[10px] text-muted-foreground">
          First significant peak at {detail.peak.delay_ms.toFixed(1)} ms
          ({detail.peak.rel_dB.toFixed(1)} dB)
        </div>
      )}
    </Card>
  );
}

function RFZSection({ title, verdict, worstDb, worstPeak }: {
  title: string;
  verdict: Verdict;
  worstDb: number;
  worstPeak: MatchedPeak | null;
}) {
  return (
    <Card className="p-3 space-y-2">
      <div className="text-xs text-muted-foreground font-medium">{title}</div>
      <div className="flex items-center justify-between">
        <VerdictBadge verdict={verdict} />
      </div>
      {worstPeak && (
        <div className="text-[10px] text-muted-foreground">
          Worst: {worstPeak.peak.delay_ms.toFixed(1)} ms at {worstDb.toFixed(1)} dB
          {worstPeak.assigned && worstPeak.reflection
            ? ` (${worstPeak.reflection.surfaceLabel})`
            : ''}
        </div>
      )}
    </Card>
  );
}

function CriticalSection({ title, verdict, worstDb, worstPeak }: {
  title: string;
  verdict: Verdict;
  worstDb: number;
  worstPeak: MatchedPeak | null;
}) {
  return (
    <Card className="p-3 space-y-2">
      <div className="text-xs text-muted-foreground font-medium">{title}</div>
      <div className="flex items-center justify-between">
        <VerdictBadge verdict={verdict} />
      </div>
      {worstPeak && (
        <div className="text-[10px] text-muted-foreground">
          Worst: {worstPeak.peak.delay_ms.toFixed(1)} ms at {worstDb.toFixed(1)} dB
        </div>
      )}
    </Card>
  );
}
