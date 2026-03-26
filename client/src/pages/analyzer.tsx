import { useState, useCallback, useMemo, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Activity, Box, Settings2, Save, FolderOpen, Play,
  Info, BarChart3, Eye, FileText, FileDown,
  Shield, Clock, Volume2, Waves, Search, Flame, Layers, Boxes, AudioLines
} from "lucide-react";
import { FileUpload } from "@/components/file-upload";
import { GeometryPanel } from "@/components/geometry-panel";
import { ETCChart } from "@/components/etc-chart";
import { RoomView } from "@/components/room-view";
import { ResultsTables, mergeAndDeduplicatePeaks } from "@/components/results-tables";
import { ThemeToggle } from "@/components/theme-provider";
import { ModalPanel } from "@/components/modal-panel";
import { ScorecardPanel } from "@/components/scorecard-panel";
import { DecayPanel } from "@/components/decay-panel";
import { ClarityPanel } from "@/components/clarity-panel";
import { FrequencyPanel } from "@/components/frequency-panel";
import { UnassignedPanel } from "@/components/unassigned-panel";
import { HeatmapPanel } from "@/components/heatmap-panel";
import { DualIRPanel } from "@/components/dual-ir-panel";
import { FourIRPanel } from "@/components/four-ir-panel";
import type { DualIRResult } from "@/lib/fusion-dual-ir";
import type { FourIRResult } from "@/lib/fusion-4ir";
import { parseIRFile, computeETC, findDirectArrival, detectPeaks } from "@/lib/dsp";
import { getRoomSurfaces, getObjectSurfaces, computeAllReflections } from "@/lib/geometry";
import { matchPeaksToReflections, computeSurfaceSummaries } from "@/lib/matching";
import { createDefaultProject, saveProjectToJSON, loadProjectFromJSON, downloadFile } from "@/lib/project";
import { generateWordReport, generatePdfReport } from "@/lib/report";
import { ReportCapture, type ReportCaptureHandle } from "@/components/report-capture";
import { batchCapture } from "@/lib/capture";
import type { CapturedImages } from "@/lib/report";
import { useToast } from "@/hooks/use-toast";
import type {
  IRData, ETCPoint, Peak, MatchedPeak, SurfaceSummary,
  AnalysisMode, RoomDimensions, SpeakerConfig, Point3D, AnalysisSettings,
  PredictedReflection, ProjectData, FusionIRDataset, RoomObject, CeilingConfig
} from "@shared/schema";
import { DEFAULT_SETTINGS, DEFAULT_ROOM, DEFAULT_SPEAKER, DEFAULT_MIC, MATERIAL_PRESETS, DEFAULT_SURFACE_MATERIALS, DEFAULT_CEILING } from "@shared/schema";

export default function AnalyzerPage() {
  const { toast } = useToast();

  const [irData, setIrData] = useState<IRData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [etcData, setEtcData] = useState<ETCPoint[]>([]);
  const [peaks, setPeaks] = useState<Peak[]>([]);
  const [matchedPeaks, setMatchedPeaks] = useState<MatchedPeak[]>([]);
  const [surfaceSummaries, setSurfaceSummaries] = useState<SurfaceSummary[]>([]);
  const [predictedReflections, setPredictedReflections] = useState<PredictedReflection[]>([]);

  const [settings, setSettings] = useState<AnalysisSettings>({ ...DEFAULT_SETTINGS });
  const [room, setRoom] = useState<RoomDimensions>({ ...DEFAULT_ROOM });
  const [speakers, setSpeakers] = useState<SpeakerConfig[]>([{ ...DEFAULT_SPEAKER }]);
  const [micPosition, setMicPosition] = useState<Point3D>({ ...DEFAULT_MIC });
  const [mic2Position, setMic2Position] = useState<Point3D | null>(null);
  const [modalResult, setModalResult] = useState<import("@shared/schema").ModalAnalysisResult | null>(null);
  const [fusionOverlayPeaks, setFusionOverlayPeaks] = useState<MatchedPeak[]>([]);
  const [fusionDatasets, setFusionDatasets] = useState<FusionIRDataset[]>([]);
  const [fusionMatchedPeaks, setFusionMatchedPeaks] = useState<MatchedPeak[]>([]);
  const [dualIRResult, setDualIRResult] = useState<DualIRResult | null>(null);
  const [fourIRResult, setFourIRResult] = useState<FourIRResult | null>(null);
  const fusionPerIRPeaks = useMemo(() => {
    if (fusionDatasets.length === 0) return [];
    return fusionDatasets.map(ds => {
      const directIdx = findDirectArrival(ds.irData);
      const pks = detectPeaks(
        ds.irData, directIdx,
        settings.earlyWindowMs,
        settings.peakThresholdDb,
        settings.smoothingMs,
        settings.speedOfSound,
        settings.earlyStartMs,
        settings.minSepMs,
        settings.noiseFloorMarginDb
      );
      return { label: ds.label, peaks: pks };
    });
  }, [fusionDatasets, settings.earlyWindowMs, settings.peakThresholdDb, settings.smoothingMs, settings.speedOfSound, settings.earlyStartMs, settings.minSepMs, settings.noiseFloorMarginDb]);
  const canonicalPeaks = useMemo(() => {
    const hasFusion = fusionOverlayPeaks.length > 0 || fusionPerIRPeaks.length > 0;
    if (!hasFusion) return matchedPeaks;
    const mainLabel = fusionPerIRPeaks.length > 0 ? fusionPerIRPeaks[0].label : 'Primary';
    return mergeAndDeduplicatePeaks(
      matchedPeaks,
      fusionOverlayPeaks.length > 0 ? fusionOverlayPeaks : undefined,
      fusionPerIRPeaks.length > 0 ? fusionPerIRPeaks : undefined,
      mainLabel
    ).map(m => m.peak);
  }, [matchedPeaks, fusionOverlayPeaks, fusionPerIRPeaks]);

  const [surfaceWeights, setSurfaceWeights] = useState<Record<string, number>>(() => {
    const weights: Record<string, number> = {};
    for (const [surface, material] of Object.entries(DEFAULT_SURFACE_MATERIALS)) {
      weights[surface] = MATERIAL_PRESETS[material] ?? 0.903;
    }
    return weights;
  });
  const [surfaceMaterials, setSurfaceMaterials] = useState<Record<string, string>>({ ...DEFAULT_SURFACE_MATERIALS });
  const [roomObjects, setRoomObjects] = useState<RoomObject[]>([]);
  const [ceiling, setCeiling] = useState<CeilingConfig>({ ...DEFAULT_CEILING });
  const [hasRun, setHasRun] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const reportCaptureRef = useRef<ReportCaptureHandle>(null);

  const handleFileLoaded = useCallback(async (file: File) => {
    setIsLoading(true);
    try {
      const data = await parseIRFile(file);
      setIrData(data);
      setHasRun(false);
      setMatchedPeaks([]);
      setSurfaceSummaries([]);
      setPredictedReflections([]);
      setModalResult(null);

      const directIdx = findDirectArrival(data);
      const etc = computeETC(data, settings.smoothingMs, directIdx);
      setEtcData(etc);

      toast({
        title: "File loaded",
        description: `${data.filename} - ${data.sampleRate} Hz, ${data.samples.length} samples`,
      });
    } catch (err: any) {
      toast({
        title: "Error loading file",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [settings.smoothingMs, toast]);

  const handleClearFile = useCallback(() => {
    setIrData(null);
    setEtcData([]);
    setPeaks([]);
    setMatchedPeaks([]);
    setSurfaceSummaries([]);
    setPredictedReflections([]);
    setHasRun(false);
    setModalResult(null);
  }, []);

  const runAnalysis = useCallback(() => {
    if (!irData) {
      toast({ title: "No file loaded", description: "Please upload an IR file first.", variant: "destructive" });
      return;
    }

    try {
      const directIdx = findDirectArrival(irData);
      const etc = computeETC(irData, settings.smoothingMs, directIdx);
      setEtcData(etc);
      const directLength = settings.mode === 'geometry'
        ? Math.sqrt(
            Math.pow(speakers[0].position.x - micPosition.x, 2) +
            Math.pow(speakers[0].position.y - micPosition.y, 2) +
            Math.pow(speakers[0].position.z - micPosition.z, 2)
          )
        : undefined;

      const detectedPeaks = detectPeaks(
        irData, directIdx,
        settings.earlyWindowMs,
        settings.peakThresholdDb,
        settings.smoothingMs,
        settings.speedOfSound,
        settings.earlyStartMs,
        settings.minSepMs,
        settings.noiseFloorMarginDb,
        directLength
      );
      setPeaks(detectedPeaks);

      if (settings.mode === 'geometry') {
        const roomSurfaces = getRoomSurfaces(room, surfaceWeights, surfaceMaterials, ceiling);
        const objectSurfaces = settings.enableObjects && roomObjects.length > 0
          ? getObjectSurfaces(roomObjects) : [];
        const surfaces = [...roomSurfaces, ...objectSurfaces];
        
        const allReflections: PredictedReflection[] = [];
        for (const spk of speakers) {
          const refs = computeAllReflections(
            spk, micPosition, room, surfaces,
            settings.speedOfSound,
            settings.enableOrder2,
            settings.maxPredictedReflections,
            settings.strictBounds,
            ceiling
          );
          allReflections.push(...refs);
        }
        setPredictedReflections(allReflections);

        const matched = matchPeaksToReflections(
          detectedPeaks, allReflections, settings.peakMatchTolerance, settings.strictBounds
        );
        setMatchedPeaks(matched);

        const summaries = computeSurfaceSummaries(matched);
        setSurfaceSummaries(summaries);
      } else {
        const irOnlyMatched: MatchedPeak[] = detectedPeaks.map(p => ({
          peak: p,
          confidence: 0,
          timeError: 0,
          assigned: false,
        }));
        setMatchedPeaks(irOnlyMatched);
        setSurfaceSummaries([]);
        setPredictedReflections([]);
      }

      setHasRun(true);
      toast({ title: "Analysis complete", description: `Found ${detectedPeaks.length} peaks.` });
    } catch (err: any) {
      toast({ title: "Analysis error", description: err.message, variant: "destructive" });
    }
  }, [irData, settings, room, speakers, micPosition, surfaceWeights, surfaceMaterials, roomObjects, ceiling, toast]);

  const handleSaveProject = useCallback(() => {
    const project: ProjectData = {
      name: irData?.filename || 'Untitled Project',
      room,
      speakers,
      micPosition,
      mic2Position,
      settings,
      surfaceWeights,
      surfaceMaterials,
      roomObjects: roomObjects.length > 0 ? roomObjects : undefined,
      ceiling: ceiling.type !== 'flat' ? ceiling : undefined,
    };
    const json = saveProjectToJSON(project);
    downloadFile(json, 'reflection-project.json');
    toast({ title: "Project saved" });
  }, [room, speakers, micPosition, mic2Position, settings, surfaceWeights, surfaceMaterials, roomObjects, ceiling, irData, toast]);

  const handleLoadProject = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const project = loadProjectFromJSON(text);
        setRoom(project.room);
        setSpeakers(project.speakers);
        setMicPosition(project.micPosition);
        setMic2Position(project.mic2Position || null);
        setSettings(project.settings);
        setSurfaceWeights(project.surfaceWeights);
        setSurfaceMaterials(project.surfaceMaterials);
        setRoomObjects(project.roomObjects || []);
        setCeiling(project.ceiling || { ...DEFAULT_CEILING });
        toast({ title: "Project loaded", description: project.name });
      } catch (err: any) {
        toast({ title: "Error loading project", description: err.message, variant: "destructive" });
      }
    };
    input.click();
  }, [toast]);

  const getReportData = useCallback(() => ({
    irData,
    settings,
    room,
    speakers,
    micPosition,
    mic2Position,
    matchedPeaks,
    surfaceSummaries,
    surfaceMaterials,
    surfaceWeights,
    fusionDatasets: fusionDatasets.length > 0 ? fusionDatasets : undefined,
    fusionOverlayPeaks: fusionOverlayPeaks.length > 0 ? fusionOverlayPeaks : undefined,
    fusionPerIRPeaks: fusionPerIRPeaks.length > 0 ? fusionPerIRPeaks : undefined,
    ceiling: ceiling.type !== 'flat' ? ceiling : undefined,
    roomObjects: settings.enableObjects && roomObjects.length > 0 ? roomObjects : undefined,
    dualIRResult: dualIRResult ?? undefined,
    fourIRResult: fourIRResult ?? undefined,
  }), [irData, settings, room, speakers, micPosition, mic2Position, matchedPeaks, surfaceSummaries, surfaceMaterials, surfaceWeights, fusionDatasets, fusionOverlayPeaks, fusionPerIRPeaks, ceiling, roomObjects, dualIRResult, fourIRResult]);

  const captureReportImages = useCallback(async (): Promise<CapturedImages> => {
    const handle = reportCaptureRef.current;
    if (!handle) return {};
    await new Promise(r => setTimeout(r, 100));

    const entries: [string, () => HTMLElement | null][] = [
      ['etcChart', handle.getEtcElement],
      ['roomTop', handle.getRoomTopElement],
      ['roomSide', handle.getRoomSideElement],
      ['roomSurface', handle.getRoomSurfaceElement],
      ['peakTable', handle.getPeakTableElement],
      ['surfaceTable', handle.getSurfaceTableElement],
      ['decayChart', handle.getDecayChartElement],
      ['frequencyChart', handle.getFrequencyChartElement],
      ['scorecardImage', handle.getScorecardElement],
      ['clarityImage', handle.getClarityElement],
      ['heatmapGrid', handle.getHeatmapElement],
      ['criticalZoneGrid', handle.getCriticalZoneElement],
      ['modalImage', handle.getModalElement],
      ['modalFreqResponseImage', handle.getModalFreqResponseElement],
      ['modalMapsImage', handle.getModalMapsElement],
      ['modalCriticalMapsImage', handle.getModalCriticalMapsElement],
      ['modalGlobalImage', handle.getModalGlobalElement],
      ['modalSeatImage', handle.getModalSeatElement],
    ];

    const captured = await batchCapture(entries, 3);
    const images: CapturedImages = {};
    const dims: Record<string, { width: number; height: number }> = {};
    for (const [key, result] of Object.entries(captured)) {
      (images as any)[key] = result.dataUrl;
      dims[key] = { width: result.width, height: result.height };
    }
    images._dims = dims;
    return images;
  }, []);

  const handleExportWord = useCallback(async () => {
    setIsExporting(true);
    try {
      const images = await captureReportImages();
      await generateWordReport(getReportData(), images);
      toast({ title: "Word report generated", description: "reflection-report.docx downloaded." });
    } catch (err: any) {
      toast({ title: "Report error", description: err.message, variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }, [getReportData, captureReportImages, toast]);

  const handleExportPdf = useCallback(async () => {
    setIsExporting(true);
    try {
      const images = await captureReportImages();
      await generatePdfReport(getReportData(), images);
      toast({ title: "PDF report generated", description: "reflection-report.pdf downloaded." });
    } catch (err: any) {
      toast({ title: "Report error", description: err.message, variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }, [getReportData, captureReportImages, toast]);

  const modeLabel = settings.mode === 'geometry' ? 'Geometry Mode' : 'IR-Only Mode';

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b shrink-0">
        <div className="flex items-center gap-2.5">
          <Activity className="w-5 h-5 text-primary" />
          <h1 className="text-base font-semibold tracking-tight">Reflection Analyzer</h1>
          <Badge variant="secondary" className="text-[10px]" data-testid="badge-mode">{modeLabel}</Badge>
        </div>
        <div className="flex items-center gap-1.5">
          {hasRun && (
            <>
              <Button variant="ghost" size="sm" onClick={handleExportWord} disabled={isExporting} data-testid="button-export-word">
                <FileText className="w-3.5 h-3.5 mr-1" /> {isExporting ? 'Exporting...' : 'Word'}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleExportPdf} disabled={isExporting} data-testid="button-export-pdf">
                <FileDown className="w-3.5 h-3.5 mr-1" /> {isExporting ? 'Exporting...' : 'PDF'}
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={handleSaveProject} data-testid="button-save-project">
            <Save className="w-3.5 h-3.5 mr-1" /> Save
          </Button>
          <Button variant="ghost" size="sm" onClick={handleLoadProject} data-testid="button-load-project">
            <FolderOpen className="w-3.5 h-3.5 mr-1" /> Load
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 border-r shrink-0 flex flex-col bg-card/50">
          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">Impulse Response</Label>
                <FileUpload
                  onFileLoaded={handleFileLoaded}
                  isLoading={isLoading}
                  loadedFilename={irData?.filename}
                  onClear={handleClearFile}
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">Analysis Mode</Label>
                <div className="flex items-center gap-2 p-2 rounded-md bg-muted/40">
                  <Label className="text-xs flex-1 cursor-pointer" htmlFor="mode-toggle">
                    {settings.mode === 'ir-only' ? 'IR-Only' : 'Geometry'}
                  </Label>
                  <Switch
                    id="mode-toggle"
                    checked={settings.mode === 'geometry'}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, mode: checked ? 'geometry' : 'ir-only' })
                    }
                    data-testid="switch-mode"
                  />
                </div>
              </div>

              {settings.mode === 'geometry' && (
                <>
                  <Separator />
                  <GeometryPanel
                    room={room}
                    onRoomChange={setRoom}
                    speakers={speakers}
                    onSpeakersChange={setSpeakers}
                    micPosition={micPosition}
                    onMicChange={setMicPosition}
                    mic2Position={mic2Position}
                    onMic2Change={setMic2Position}
                    settings={settings}
                    onSettingsChange={setSettings}
                    surfaceWeights={surfaceWeights}
                    onSurfaceWeightsChange={setSurfaceWeights}
                    surfaceMaterials={surfaceMaterials}
                    onSurfaceMaterialsChange={setSurfaceMaterials}
                    roomObjects={roomObjects}
                    onRoomObjectsChange={setRoomObjects}
                    ceiling={ceiling}
                    onCeilingChange={setCeiling}
                  />
                </>
              )}

              {settings.mode === 'ir-only' && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <Settings2 className="w-3 h-3" /> Detection Settings
                    </Label>
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Speed of sound (m/s)</Label>
                        <input
                          type="number"
                          value={settings.speedOfSound}
                          onChange={(e) => setSettings({ ...settings, speedOfSound: parseFloat(e.target.value) || 343 })}
                          className="w-full h-8 px-2 text-sm bg-background border rounded-md"
                          data-testid="input-sos-ironly"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Early window (ms)</Label>
                        <input
                          type="number"
                          value={settings.earlyWindowMs}
                          onChange={(e) => setSettings({ ...settings, earlyWindowMs: parseFloat(e.target.value) || 50 })}
                          className="w-full h-8 px-2 text-sm bg-background border rounded-md"
                          data-testid="input-ew-ironly"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Early start (ms)</Label>
                        <input
                          type="number"
                          value={settings.earlyStartMs}
                          onChange={(e) => setSettings({ ...settings, earlyStartMs: parseFloat(e.target.value) || 0.3 })}
                          className="w-full h-8 px-2 text-sm bg-background border rounded-md"
                          step="0.1"
                          data-testid="input-es-ironly"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Peak threshold (dB)</Label>
                        <input
                          type="number"
                          value={settings.peakThresholdDb}
                          onChange={(e) => setSettings({ ...settings, peakThresholdDb: parseFloat(e.target.value) || -25 })}
                          className="w-full h-8 px-2 text-sm bg-background border rounded-md"
                          data-testid="input-pt-ironly"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Min peak separation (ms)</Label>
                        <input
                          type="number"
                          value={settings.minSepMs}
                          onChange={(e) => setSettings({ ...settings, minSepMs: parseFloat(e.target.value) || 1.0 })}
                          className="w-full h-8 px-2 text-sm bg-background border rounded-md"
                          step="0.1"
                          data-testid="input-ms-ironly"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Noise floor margin (dB)</Label>
                        <input
                          type="number"
                          value={settings.noiseFloorMarginDb}
                          onChange={(e) => setSettings({ ...settings, noiseFloorMarginDb: parseFloat(e.target.value) || 6 })}
                          className="w-full h-8 px-2 text-sm bg-background border rounded-md"
                          data-testid="input-nf-ironly"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Smoothing (ms)</Label>
                        <input
                          type="number"
                          value={settings.smoothingMs}
                          onChange={(e) => setSettings({ ...settings, smoothingMs: parseFloat(e.target.value) || 0.8 })}
                          className="w-full h-8 px-2 text-sm bg-background border rounded-md"
                          step="0.05"
                          data-testid="input-sm-ironly"
                        />
                      </div>
                    </div>
                  </div>
                </>
              )}

              <Separator />

              <Button
                className="w-full"
                onClick={runAnalysis}
                disabled={!irData}
                data-testid="button-run-analysis"
              >
                <Play className="w-3.5 h-3.5 mr-1.5" /> Run Analysis
              </Button>
            </div>
          </ScrollArea>
        </aside>

        <main className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-auto">
            <div className="p-4 space-y-4">
              {!irData && !hasRun && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Activity className="w-8 h-8 text-primary" />
                  </div>
                  <h2 className="text-lg font-semibold mb-1">Welcome to Reflection Analyzer</h2>
                  <p className="text-sm text-muted-foreground max-w-md mb-4">
                    Upload a Room EQ Wizard impulse response file to analyze early reflections.
                    Switch between IR-Only and Geometry modes.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg w-full">
                    <Card className="p-3">
                      <div className="flex items-start gap-2">
                        <BarChart3 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-medium">IR-Only Mode</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Detect peaks, compute delay, ΔL, and equivalent distance.
                            No geometry needed.
                          </p>
                        </div>
                      </div>
                    </Card>
                    <Card className="p-3">
                      <div className="flex items-start gap-2">
                        <Box className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-medium">Geometry Mode</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Assign peaks to room surfaces using image-source method.
                            Shows reflection paths.
                          </p>
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>
              )}

              {(irData || hasRun) && (
                <Tabs defaultValue="etc" className="w-full">
                  <TabsList className="mb-3 flex-wrap h-auto gap-1">
                    <TabsTrigger value="etc" className="text-xs" data-testid="tab-etc">
                      <BarChart3 className="w-3.5 h-3.5 mr-1" /> ETC
                    </TabsTrigger>
                    {settings.mode === 'geometry' && (
                      <TabsTrigger value="room" className="text-xs" data-testid="tab-room">
                        <Eye className="w-3.5 h-3.5 mr-1" /> Room
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="results" className="text-xs" data-testid="tab-results">
                      <Activity className="w-3.5 h-3.5 mr-1" /> Results
                    </TabsTrigger>
                    {hasRun && (
                      <>
                        <TabsTrigger value="scorecard" className="text-xs" data-testid="tab-scorecard">
                          <Shield className="w-3.5 h-3.5 mr-1" /> Scorecard
                        </TabsTrigger>
                        <TabsTrigger value="decay" className="text-xs" data-testid="tab-decay">
                          <Clock className="w-3.5 h-3.5 mr-1" /> Decay
                        </TabsTrigger>
                        <TabsTrigger value="clarity" className="text-xs" data-testid="tab-clarity">
                          <Volume2 className="w-3.5 h-3.5 mr-1" /> Clarity
                        </TabsTrigger>
                        <TabsTrigger value="frequency" className="text-xs" data-testid="tab-frequency">
                          <Waves className="w-3.5 h-3.5 mr-1" /> Frequency
                        </TabsTrigger>
                        {settings.mode === 'geometry' && (
                          <>
                            <TabsTrigger value="unassigned" className="text-xs" data-testid="tab-unassigned">
                              <Search className="w-3.5 h-3.5 mr-1" /> Unassigned
                            </TabsTrigger>
                            <TabsTrigger value="heatmaps" className="text-xs" data-testid="tab-heatmaps">
                              <Flame className="w-3.5 h-3.5 mr-1" /> Heatmaps
                            </TabsTrigger>
                            <TabsTrigger value="modal" className="text-xs" data-testid="tab-modal">
                              <AudioLines className="w-3.5 h-3.5 mr-1" /> Modal
                            </TabsTrigger>
                          </>
                        )}
                        {settings.mode === 'geometry' && (
                          <>
                            <TabsTrigger value="dual-ir" className="text-xs" data-testid="tab-dual-ir">
                              <Layers className="w-3.5 h-3.5 mr-1" /> Dual IR
                            </TabsTrigger>
                            <TabsTrigger value="four-ir" className="text-xs" data-testid="tab-four-ir">
                              <Boxes className="w-3.5 h-3.5 mr-1" /> 4-IR
                            </TabsTrigger>
                          </>
                        )}
                      </>
                    )}
                  </TabsList>

                  <TabsContent value="etc">
                    <Card className="p-4">
                      <ETCChart
                        etcData={etcData}
                        matchedPeaks={matchedPeaks}
                        earlyWindowMs={settings.earlyWindowMs}
                        thresholdDb={settings.peakThresholdDb}
                        mode={settings.mode}
                        fusionDatasets={fusionDatasets.length > 0 ? fusionDatasets : undefined}
                        fusionPerIRPeaks={fusionPerIRPeaks.length > 0 ? fusionPerIRPeaks : undefined}
                      />
                    </Card>
                  </TabsContent>

                  {settings.mode === 'geometry' && (
                    <TabsContent value="room">
                      <Card className="p-4">
                        <RoomView
                          room={room}
                          speakers={speakers}
                          micPosition={micPosition}
                          mic2Position={mic2Position}
                          matchedPeaks={matchedPeaks}
                          fusionOverlayPeaks={fusionOverlayPeaks}
                          roomObjects={settings.enableObjects ? roomObjects : undefined}
                          ceiling={ceiling}
                          peakMatchTolerance={settings.peakMatchTolerance}
                          speedOfSound={settings.speedOfSound}
                        />
                      </Card>
                    </TabsContent>
                  )}

                  <TabsContent value="results">
                    <Card className="p-4">
                      <ResultsTables
                        matchedPeaks={matchedPeaks}
                        surfaceSummaries={surfaceSummaries}
                        mode={settings.mode}
                        speedOfSound={settings.speedOfSound}
                        fusionOverlayPeaks={fusionOverlayPeaks.length > 0 ? fusionOverlayPeaks : undefined}
                        fusionPerIRPeaks={fusionPerIRPeaks.length > 0 ? fusionPerIRPeaks : undefined}
                      />
                    </Card>
                  </TabsContent>

                  {hasRun && (
                    <>
                      <TabsContent value="scorecard">
                        <Card className="p-4">
                          <ScorecardPanel
                            matchedPeaks={matchedPeaks}
                            fusionMatchedPeaks={fusionMatchedPeaks.length > 0 ? fusionMatchedPeaks : undefined}
                            fusionOverlayPeaks={fusionOverlayPeaks.length > 0 ? fusionOverlayPeaks : undefined}
                            fusionPerIRPeaks={fusionPerIRPeaks.length > 0 ? fusionPerIRPeaks : undefined}
                          />
                        </Card>
                      </TabsContent>

                      <TabsContent value="decay">
                        <Card className="p-4">
                          {irData && (
                            <DecayPanel
                              irData={irData}
                              fusionDatasets={fusionDatasets.length > 0 ? fusionDatasets : undefined}
                            />
                          )}
                        </Card>
                      </TabsContent>

                      <TabsContent value="clarity">
                        <Card className="p-4">
                          {irData && (
                            <ClarityPanel
                              irData={irData}
                              fusionDatasets={fusionDatasets.length > 0 ? fusionDatasets : undefined}
                            />
                          )}
                        </Card>
                      </TabsContent>

                      <TabsContent value="frequency">
                        <Card className="p-4">
                          {irData && (
                            <FrequencyPanel
                              irData={irData}
                              matchedPeaks={matchedPeaks}
                              fusionDatasets={fusionDatasets.length > 0 ? fusionDatasets : undefined}
                            />
                          )}
                        </Card>
                      </TabsContent>

                      {settings.mode === 'geometry' && (
                        <>
                          <TabsContent value="unassigned">
                            <Card className="p-4">
                              <UnassignedPanel
                                matchedPeaks={canonicalPeaks}
                                room={room}
                                speakerPos={speakers[0].position}
                                micPos={micPosition}
                                speedOfSound={settings.speedOfSound}
                                surfaceWeights={surfaceWeights}
                                surfaceMaterials={surfaceMaterials}
                                toleranceMs={settings.peakMatchTolerance}
                                ceiling={ceiling}
                                roomObjects={settings.enableObjects ? roomObjects : undefined}
                              />
                            </Card>
                          </TabsContent>

                          <TabsContent value="heatmaps">
                            <Card className="p-4">
                              <HeatmapPanel
                                matchedPeaks={matchedPeaks}
                                fusionOverlayPeaks={fusionOverlayPeaks}
                                room={room}
                                speedOfSound={settings.speedOfSound}
                                toleranceMs={settings.peakMatchTolerance}
                                ceiling={ceiling}
                              />
                            </Card>
                          </TabsContent>

                          <TabsContent value="modal">
                            <Card className="p-4">
                              {irData && (
                                <ModalPanel
                                  room={room}
                                  ceiling={ceiling}
                                  speakers={speakers}
                                  micPos={micPosition}
                                  mic2Position={mic2Position}
                                  irData={irData}
                                  speedOfSound={settings.speedOfSound}
                                  fusionDatasets={fusionDatasets.length > 0 ? fusionDatasets : undefined}
                                  onResult={setModalResult}
                                />
                              )}
                              {!irData && (
                                <div className="text-center text-sm text-muted-foreground py-8">
                                  Load an IR file to run modal analysis.
                                </div>
                              )}
                            </Card>
                          </TabsContent>

                          <TabsContent value="dual-ir">
                            <Card className="p-4">
                              <DualIRPanel
                                room={room}
                                speakers={speakers}
                                micPosition={micPosition}
                                settings={settings}
                                surfaceWeights={surfaceWeights}
                                surfaceMaterials={surfaceMaterials}
                                mainIrData={irData}
                                ceiling={ceiling}
                                roomObjects={roomObjects}
                                onFusionResult={setFusionOverlayPeaks}
                                onFusionDatasets={(datasets, peaks) => {
                                  setFusionDatasets(datasets);
                                  setFusionMatchedPeaks(peaks);
                                }}
                                onDualIRResult={(res) => { setDualIRResult(res); setFourIRResult(null); }}
                              />
                            </Card>
                          </TabsContent>

                          <TabsContent value="four-ir">
                            <Card className="p-4">
                              <FourIRPanel
                                room={room}
                                speakers={speakers}
                                micPosition={micPosition}
                                mic2Position={mic2Position}
                                settings={settings}
                                surfaceWeights={surfaceWeights}
                                surfaceMaterials={surfaceMaterials}
                                ceiling={ceiling}
                                roomObjects={roomObjects}
                                onFusionResult={setFusionOverlayPeaks}
                                onFusionDatasets={(datasets, peaks) => {
                                  setFusionDatasets(datasets);
                                  setFusionMatchedPeaks(peaks);
                                }}
                                onFourIRResult={(res) => { setFourIRResult(res); setDualIRResult(null); }}
                              />
                            </Card>
                          </TabsContent>
                        </>
                      )}
                    </>
                  )}
                </Tabs>
              )}

              {hasRun && (
                <Card className="p-3">
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="text-[11px] text-muted-foreground leading-relaxed">
                      {settings.mode === 'ir-only' ? (
                        <p>
                          <strong>IR-Only Mode:</strong> Distance values are "equivalent distance" (ΔL/2),
                          not the actual mic-to-surface distance. From the impulse response alone,
                          the true mic→surface distance is not uniquely solvable.
                        </p>
                      ) : (
                        <p>
                          <strong>Geometry Mode:</strong> Surface assignments use the image-source method, which
                          enforces equal-angle reflection automatically. Unassigned peaks are likely caused by
                          furniture, equipment, or higher-order reflections not modeled by 1st-order specular geometry.
                          Confidence = clamp(1 - timeError/tolerance). Strict bounds require P* within surface rectangle.
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </div>
        </main>
      </div>

      {hasRun && (
        <ReportCapture
          ref={reportCaptureRef}
          etcData={etcData}
          matchedPeaks={matchedPeaks}
          surfaceSummaries={surfaceSummaries}
          earlyWindowMs={settings.earlyWindowMs}
          thresholdDb={settings.peakThresholdDb}
          room={room}
          speakers={speakers}
          micPosition={micPosition}
          speedOfSound={settings.speedOfSound}
          mode={settings.mode}
          peakMatchTolerance={settings.peakMatchTolerance}
          irData={irData}
          surfaceWeights={surfaceWeights}
          surfaceMaterials={surfaceMaterials}
          fusionDatasets={fusionDatasets.length > 0 ? fusionDatasets : undefined}
          fusionOverlayPeaks={fusionOverlayPeaks.length > 0 ? fusionOverlayPeaks : undefined}
          fusionMatchedPeaks={fusionMatchedPeaks.length > 0 ? fusionMatchedPeaks : undefined}
          fusionPerIRPeaks={fusionPerIRPeaks.length > 0 ? fusionPerIRPeaks : undefined}
          mic2Position={mic2Position}
          ceiling={ceiling}
          roomObjects={settings.enableObjects ? roomObjects : undefined}
          modalResult={modalResult}
        />
      )}
    </div>
  );
}
