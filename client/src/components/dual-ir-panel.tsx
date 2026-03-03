import { useState, useCallback, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Layers, Upload, Play, CheckCircle } from "lucide-react";
import { parseIRFile } from "@/lib/dsp";
import { computeDualIRFusion, type DualIRInput, type DualIRResult } from "@/lib/fusion-dual-ir";
import type { IRData, RoomDimensions, SpeakerConfig, Point3D, AnalysisSettings, MatchedPeak, FusionIRDataset } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

interface DualIRPanelProps {
  room: RoomDimensions;
  speakers: SpeakerConfig[];
  micPosition: Point3D;
  settings: AnalysisSettings;
  surfaceWeights: Record<string, number>;
  surfaceMaterials: Record<string, string>;
  mainIrData: IRData | null;
  onFusionResult?: (fusionPeaks: MatchedPeak[]) => void;
  onFusionDatasets?: (datasets: FusionIRDataset[], fusionPeaks: MatchedPeak[]) => void;
}

export function DualIRPanel({ room, speakers, micPosition, settings, surfaceWeights, surfaceMaterials, mainIrData, onFusionResult, onFusionDatasets }: DualIRPanelProps) {
  const { toast } = useToast();
  const [irSpeaker2, setIrSpeaker2] = useState<IRData | null>(null);
  const [result, setResult] = useState<DualIRResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    setResult(null);
    onFusionResult?.([]);
    onFusionDatasets?.([], []);
  }, [mainIrData, speakers, micPosition, room]);

  const handleFileUpload = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.wav,.txt,.csv';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const data = await parseIRFile(file);
        setIrSpeaker2(data);
        setResult(null);
        toast({ title: "Speaker 2 IR loaded", description: data.filename });
      } catch (err: any) {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    };
    input.click();
  }, [toast]);

  const runFusion = useCallback(() => {
    if (!mainIrData) {
      toast({ title: "No main IR", description: "Load an IR file in the main window first (Speaker 1 IR).", variant: "destructive" });
      return;
    }
    if (!irSpeaker2) {
      toast({ title: "Missing file", description: "Upload the Speaker 2 IR file.", variant: "destructive" });
      return;
    }
    if (speakers.length < 2) {
      toast({ title: "Need 2 speakers", description: "Add a second speaker position in geometry settings.", variant: "destructive" });
      return;
    }

    setIsProcessing(true);
    try {
      const input: DualIRInput = {
        irLeft: mainIrData,
        irRight: irSpeaker2,
        speakerLeft: speakers[0],
        speakerRight: speakers[1],
        mic: micPosition,
        room, settings, surfaceWeights, surfaceMaterials,
      };
      const res = computeDualIRFusion(input);
      setResult(res);

      const allFusionPeaks = [...res.leftMatchedPeaks, ...res.rightMatchedPeaks];
      onFusionResult?.(allFusionPeaks);

      const datasets: FusionIRDataset[] = [
        { label: 'S1 (Left)', irData: mainIrData },
        { label: 'S2 (Right)', irData: irSpeaker2 },
      ];
      onFusionDatasets?.(datasets, allFusionPeaks);

      toast({ title: "Dual-IR fusion complete" });
    } catch (err: any) {
      toast({ title: "Fusion error", description: err.message, variant: "destructive" });
    } finally {
      setIsProcessing(false);
    }
  }, [mainIrData, irSpeaker2, speakers, micPosition, room, settings, surfaceWeights, surfaceMaterials, toast, onFusionResult, onFusionDatasets]);

  return (
    <div className="space-y-4" data-testid="dual-ir-panel">
      <div className="flex items-center gap-2">
        <Layers className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-semibold">Dual Speaker Fusion (2 Speakers, 1 Mic)</h3>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3">
          <Label className="text-xs">Speaker 1 IR (from main)</Label>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-muted-foreground">
            {mainIrData ? (
              <>
                <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                <span className="truncate">{mainIrData.filename}</span>
              </>
            ) : (
              <span className="text-destructive">No IR loaded in main window</span>
            )}
          </div>
        </Card>
        <Card className="p-3">
          <Label className="text-xs">Speaker 2 IR</Label>
          <Button variant="outline" size="sm" className="w-full mt-1" onClick={handleFileUpload} data-testid="button-upload-ir-speaker2">
            <Upload className="w-3.5 h-3.5 mr-1" />
            {irSpeaker2 ? irSpeaker2.filename : 'Upload Speaker 2 IR'}
          </Button>
        </Card>
      </div>

      <div className="text-[10px] text-muted-foreground bg-muted/30 rounded p-2">
        Speaker 1 = main IR (recorded by Mic 1). Speaker 2 = IR loaded here. Both speakers must be defined in geometry settings.
      </div>

      <Button onClick={runFusion} disabled={!mainIrData || !irSpeaker2 || isProcessing} className="w-full" data-testid="button-run-dual-fusion">
        <Play className="w-3.5 h-3.5 mr-1.5" />
        {isProcessing ? 'Processing...' : 'Run Dual-IR Fusion'}
      </Button>

      {result && (
        <>
          <Separator />
          <Card className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium">Stereo Consistency</span>
              <Badge variant={result.stereoConsistencyPercent >= 70 ? "default" : "destructive"} data-testid="badge-stereo-consistency">
                {result.stereoConsistencyPercent}%
              </Badge>
            </div>
            <div className="text-[10px] text-muted-foreground">
              {result.fusedSurfaces.filter(s => s.stereoConfirmed).length} of {result.fusedSurfaces.length} surfaces confirmed by both speakers.
            </div>
          </Card>

          <Card className="p-3">
            <div className="text-xs font-medium mb-2">Fused Surface Ranking</div>
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-1">Surface</th>
                  <th className="text-left p-1">Spk 1 Peaks</th>
                  <th className="text-left p-1">Spk 2 Peaks</th>
                  <th className="text-left p-1">Stereo</th>
                  <th className="text-left p-1">Fused Cost</th>
                  <th className="text-left p-1">Severity</th>
                </tr>
              </thead>
              <tbody>
                {result.fusedSurfaces.map((fs, i) => (
                  <tr key={i} className="border-b border-muted/20" data-testid={`row-fused-surface-${i}`}>
                    <td className="p-1">{fs.surfaceLabel}</td>
                    <td className="p-1">{fs.leftPeaks.length}</td>
                    <td className="p-1">{fs.rightPeaks.length}</td>
                    <td className="p-1">{fs.stereoConfirmed ? '✓' : '✗'}</td>
                    <td className="p-1">{fs.fusedCost < 100 ? fs.fusedCost.toFixed(3) : '—'}</td>
                    <td className="p-1">{fs.combinedSeverity.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {result.asymmetricPeaks.length > 0 && (
            <Card className="p-3">
              <div className="text-xs font-medium mb-2">Asymmetric Peaks (local object candidates)</div>
              <div className="space-y-1">
                {result.asymmetricPeaks.map((ap, i) => (
                  <div key={i} className="text-[10px] text-muted-foreground flex gap-2" data-testid={`row-asymmetric-${i}`}>
                    <Badge variant="outline" className="text-[9px]">{ap.source === 'Left' ? 'Spk 1' : 'Spk 2'}</Badge>
                    <span>{ap.reason}</span>
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
