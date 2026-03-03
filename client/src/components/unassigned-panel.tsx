import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import type { MatchedPeak, RoomDimensions, Point3D } from "@shared/schema";
import { analyzeUnassignedPeaks, type UnassignedPeakDiagnostic } from "@/lib/unassigned-diagnostics";

interface UnassignedPanelProps {
  matchedPeaks: MatchedPeak[];
  room: RoomDimensions;
  speakerPos: Point3D;
  micPos: Point3D;
  speedOfSound: number;
  surfaceWeights: Record<string, number>;
  surfaceMaterials: Record<string, string>;
  toleranceMs: number;
}

const classColors: Record<string, string> = {
  'likely desk/console/near object': 'bg-orange-500',
  'likely local object near one speaker': 'bg-amber-500',
  'likely diffraction': 'bg-blue-500',
  'likely higher-order reflection': 'bg-purple-500',
  'likely noise': 'bg-gray-400',
  'unknown': 'bg-gray-500',
};

export function UnassignedPanel({
  matchedPeaks, room, speakerPos, micPos, speedOfSound, surfaceWeights, surfaceMaterials, toleranceMs
}: UnassignedPanelProps) {
  const diagnostics = useMemo<UnassignedPeakDiagnostic[]>(() => {
    return analyzeUnassignedPeaks(matchedPeaks, room, speakerPos, micPos, speedOfSound, surfaceWeights, surfaceMaterials, toleranceMs);
  }, [matchedPeaks, room, speakerPos, micPos, speedOfSound, surfaceWeights, surfaceMaterials, toleranceMs]);

  if (diagnostics.length === 0) {
    return (
      <div className="space-y-4" data-testid="unassigned-panel">
        <div className="flex items-center gap-2">
          <Search className="w-5 h-5 text-primary" />
          <h3 className="text-sm font-semibold">Unassigned Peaks Diagnostics</h3>
        </div>
        <Card className="p-4 text-center text-sm text-muted-foreground">
          All peaks are assigned to surfaces. No diagnostics needed.
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="unassigned-panel">
      <div className="flex items-center gap-2">
        <Search className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-semibold">Unassigned Peaks Diagnostics ({diagnostics.length} peaks)</h3>
      </div>

      <div className="space-y-3">
        {diagnostics.map((diag, i) => (
          <Card key={i} className="p-3" data-testid={`card-unassigned-${i}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">
                  Peak @ {diag.peak.peak.delay_ms.toFixed(2)} ms
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {diag.peak.peak.rel_dB.toFixed(1)} dB | severity: {diag.peak.peak.severity.toFixed(1)}
                </span>
              </div>
              <Badge className={`text-white text-[9px] ${classColors[diag.classification] || 'bg-gray-500'}`}>
                {diag.classification}
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground mb-2 italic">{diag.classificationReason}</p>

            {diag.topCandidates.length > 0 && (
              <div>
                <div className="text-[10px] font-medium mb-1">Top 3 closest surface candidates:</div>
                <table className="w-full text-[9px] border-collapse">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-1">Candidate Surface</th>
                      <th className="text-left p-1">Pred Delay (ms)</th>
                      <th className="text-left p-1">Time Error (ms)</th>
                      <th className="text-left p-1">BoundsPass</th>
                      <th className="text-left p-1">uInSegment</th>
                      <th className="text-left p-1">Accepted</th>
                      <th className="text-left p-1">Reject Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diag.topCandidates.map((c, j) => (
                        <tr key={j} className="border-b border-muted/20">
                          <td className="p-1">{c.surfaceLabel}</td>
                          <td className="p-1">{c.predictedDelay_ms.toFixed(2)}</td>
                          <td className="p-1">{c.timeError_ms.toFixed(3)}</td>
                          <td className="p-1">{c.boundsPass ? 'Y' : 'N'}</td>
                          <td className="p-1">{c.uInSegment ? 'Y' : 'N'}</td>
                          <td className="p-1">{c.accepted ? 'Y' : 'N'}</td>
                          <td className="p-1 text-muted-foreground">{c.rejectReason}</td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
