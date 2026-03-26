import { useState, useCallback, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Box, Upload, Play } from "lucide-react";
import { parseIRFile } from "@/lib/dsp";
import { computeFourIRFusion, type FourIRInput, type FourIRResult } from "@/lib/fusion-4ir";
import type { IRData, RoomDimensions, SpeakerConfig, Point3D, AnalysisSettings, MatchedPeak, FusionIRDataset, CeilingConfig, RoomObject } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface FourIRPanelProps {
  room: RoomDimensions;
  speakers: SpeakerConfig[];
  micPosition: Point3D;
  mic2Position: Point3D | null;
  settings: AnalysisSettings;
  surfaceWeights: Record<string, number>;
  surfaceMaterials: Record<string, string>;
  ceiling?: CeilingConfig;
  roomObjects?: RoomObject[];
  onFusionResult?: (fusionPeaks: MatchedPeak[]) => void;
  onFusionDatasets?: (datasets: FusionIRDataset[], fusionPeaks: MatchedPeak[]) => void;
  onFourIRResult?: (result: FourIRResult | null) => void;
}

interface IRSlot {
  label: string;
  key: string;
  data: IRData | null;
}

export function FourIRPanel({ room, speakers, micPosition, mic2Position, settings, surfaceWeights, surfaceMaterials, ceiling, roomObjects, onFusionResult, onFusionDatasets, onFourIRResult }: FourIRPanelProps) {
  const { toast } = useToast();
  const [slots, setSlots] = useState<IRSlot[]>([
    { label: 'S1 → M1', key: 'S1M1', data: null },
    { label: 'S2 → M1', key: 'S2M1', data: null },
    { label: 'S1 → M2', key: 'S1M2', data: null },
    { label: 'S2 → M2', key: 'S2M2', data: null },
  ]);
  const [result, setResult] = useState<FourIRResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    setResult(null);
    onFusionResult?.([]);
    onFusionDatasets?.([], []);
    onFourIRResult?.(null);
  }, [speakers, micPosition, mic2Position, room]);

  const handleUpload = useCallback((slotKey: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wav,.txt,.csv';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const data = await parseIRFile(file);
        setSlots(prev => prev.map(s => s.key === slotKey ? { ...s, data } : s));
        toast({ title: "IR loaded", description: `${data.filename} → ${slotKey}` });
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    };
    input.click();
  }, [toast]);

  const allLoaded = slots.every(s => s.data !== null);

  const runFusion = useCallback(() => {
    if (!allLoaded) {
      toast({ title: "Missing files", description: "Upload all 4 IR files.", variant: "destructive" });
      return;
    }
    if (speakers.length < 2) {
      toast({ title: "Need 2 speakers", description: "Add a second speaker in geometry settings.", variant: "destructive" });
      return;
    }
    if (!mic2Position) {
      toast({ title: "Need Mic 2", description: "Add Mic 2 position in geometry settings.", variant: "destructive" });
      return;
    }

    setIsProcessing(true);
    try {
      const input: FourIRInput = {
        ir_S1_M1: slots[0].data!,
        ir_S2_M1: slots[1].data!,
        ir_S1_M2: slots[2].data!,
        ir_S2_M2: slots[3].data!,
        speaker1: speakers[0],
        speaker2: speakers[1],
        mic1: micPosition,
        mic2: mic2Position,
        room, settings, surfaceWeights, surfaceMaterials, ceiling, roomObjects,
      };
      const res = computeFourIRFusion(input);
      setResult(res);
      onFourIRResult?.(res);

      const allFusionPeaks = res.measurements.flatMap(m => {
        const isMic2 = m.label.includes('M2');
        return m.matchedPeaks.map(mp => ({ ...mp, targetMicIndex: isMic2 ? 1 : 0 }));
      });
      onFusionResult?.(allFusionPeaks);

      const datasets: FusionIRDataset[] = slots
        .filter(s => s.data !== null)
        .map(s => ({ label: s.label, irData: s.data! }));
      onFusionDatasets?.(datasets, allFusionPeaks);

      toast({ title: "4-IR fusion complete" });
    } catch (err: any) {
      toast({ title: "Fusion error", description: err.message, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  }, [allLoaded, slots, speakers, micPosition, mic2Position, room, settings, surfaceWeights, surfaceMaterials, toast, onFusionResult, onFusionDatasets]);

  return (
    <div className="space-y-4" data-testid="four-ir-panel">
      <div className="flex items-center gap-2">
        <Box className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-semibold">4-IR 3D Refinement (2 Speakers × 2 Mics)</h3>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {slots.map(slot => (
          <Card key={slot.key} className="p-2">
            <Label className="text-[10px]">{slot.label}</Label>
            <Button variant="outline" size="sm" className="w-full mt-1 text-[10px]"
              onClick={() => handleUpload(slot.key)} data-testid={`button-upload-${slot.key}`}>
              <Upload className="w-3 h-3 mr-1" />
              {slot.data ? slot.data.filename : `Upload ${slot.label}`}
            </Button>
          </Card>
        ))}
      </div>

      <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2">
        {mic2Position ? (
          <span>Mic 2 position: ({mic2Position.x}, {mic2Position.y}, {mic2Position.z}) m — set in geometry settings.</span>
        ) : (
          <span className="text-destructive">Mic 2 not configured. Add Mic 2 in geometry settings to enable 4-IR fusion.</span>
        )}
      </div>

      <Button onClick={runFusion} disabled={!allLoaded || isProcessing || !mic2Position} className="w-full" data-testid="button-run-4ir-fusion">
        <Play className="w-3.5 h-3.5 mr-1.5" />
        {isProcessing ? 'Processing...' : 'Run 4-IR Fusion'}
      </Button>

      {result && (
        <>
          <Separator />

          <Card className="p-3">
            <div className="text-xs font-medium mb-2">Multi-View Surface Results</div>
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-1">Surface</th>
                  <th className="text-left p-1">Total Peaks</th>
                  <th className="text-left p-1">Max Support</th>
                  <th className="text-left p-1">Best Hotspot</th>
                  <th className="text-left p-1">Issues</th>
                </tr>
              </thead>
              <tbody>
                {result.surfaceResults.map((sr, i) => (
                  <tr key={i} className="border-b border-muted/20" data-testid={`row-4ir-surface-${i}`}>
                    <td className="p-1">{sr.surfaceLabel}</td>
                    <td className="p-1">{sr.totalPeakCount}</td>
                    <td className="p-1">
                      {sr.hotspots.length > 0 ? (
                        <Badge variant={sr.hotspots[0].supportCount >= 3 ? "default" : "secondary"} className="text-[9px]">
                          {sr.hotspots[0].supportCount}/4 IRs
                        </Badge>
                      ) : '—'}
                    </td>
                    <td className="p-1 font-mono">
                      {sr.hotspots.length > 0
                        ? `(${sr.hotspots[0].avgX.toFixed(2)}, ${sr.hotspots[0].avgY.toFixed(2)}, ${sr.hotspots[0].avgZ.toFixed(2)})`
                        : '—'}
                    </td>
                    <td className="p-1 text-muted-foreground">
                      {sr.disagreements.length > 0 ? sr.disagreements.join('; ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {result.surfaceResults.some(sr => sr.hotspots.length > 0) && (
            <Card className="p-3">
              <div className="text-xs font-medium mb-2">3D-Supported Hotspots</div>
              <div className="space-y-2">
                {result.surfaceResults.filter(sr => sr.hotspots.length > 0).map(sr => (
                  <div key={sr.surfaceLabel}>
                    <div className="text-[10px] font-medium">{sr.surfaceLabel}</div>
                    {sr.hotspots.map((hs, i) => (
                      <div key={i} className="text-[9px] text-muted-foreground ml-3">
                        Hotspot #{i + 1}: ({hs.avgX.toFixed(2)}, {hs.avgY.toFixed(2)}, {hs.avgZ.toFixed(2)})
                        — {hs.supportCount}/4 IRs ({hs.supportingIRs.join(', ')})
                        — avg error: {hs.avgTimeError.toFixed(3)} ms
                        — avg level: {hs.avgRelDb.toFixed(1)} dB
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
