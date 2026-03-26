import { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType, ImageRun, PageBreak } from "docx";
import { saveAs } from "file-saver";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { MatchedPeak, SurfaceSummary, AnalysisSettings, RoomDimensions, SpeakerConfig, Point3D, IRData, FusionIRDataset, Peak, CeilingConfig, RoomObject } from "@shared/schema";
import { CEILING_TYPE_LABELS } from "@shared/schema";
import { mergeAndDeduplicatePeaks, type MergedPeak } from "@/components/results-tables";
import { computeSurfaceSummaries } from "./matching";
import coverLogoPath from "@assets/20260225_1006_Image_Generation_simple_compose_01kja0rdn3fjj9e6_1772026643646.png";
import { computeScorecard, type ScorecardResult, type ScorecardPreset } from "./scorecard";
import { computeDecayMetrics, type DecayMetricsResult } from "./decay-metrics";
import { computeClarityMetrics, type ClarityResult } from "./clarity-metrics";
import { computeCombSignatures, type CombSignature } from "./frequency-analysis";
import { analyzeUnassignedPeaks, type UnassignedPeakDiagnostic } from "./unassigned-diagnostics";
import { computeSurfaceHeatmaps, type SurfaceHeatmap } from "./surface-heatmaps";
import { findDirectArrival } from "./dsp";
import type { DualIRResult, FusedSurfaceResult, AsymmetricPeak } from "./fusion-dual-ir";
import type { FourIRResult, SurfaceMultiViewResult, MultiViewHotspot } from "./fusion-4ir";

export type AnalysisModeTag = 'SINGLE_IR' | 'DUAL_IR' | 'FUSION_4IR';

export function detectAnalysisMode(fusionDatasets?: FusionIRDataset[]): AnalysisModeTag {
  if (!fusionDatasets || fusionDatasets.length === 0) return 'SINGLE_IR';
  if (fusionDatasets.length === 2) return 'DUAL_IR';
  if (fusionDatasets.length >= 4) return 'FUSION_4IR';
  return 'SINGLE_IR';
}

export interface ReportData {
  irData: IRData | null;
  settings: AnalysisSettings;
  room: RoomDimensions;
  speakers: SpeakerConfig[];
  micPosition: Point3D;
  mic2Position?: Point3D | null;
  matchedPeaks: MatchedPeak[];
  surfaceSummaries: SurfaceSummary[];
  surfaceMaterials: Record<string, string>;
  surfaceWeights?: Record<string, number>;
  fusionDatasets?: FusionIRDataset[];
  fusionOverlayPeaks?: MatchedPeak[];
  fusionPerIRPeaks?: { label: string; peaks: Peak[] }[];
  ceiling?: CeilingConfig;
  roomObjects?: RoomObject[];
  dualIRResult?: DualIRResult;
  fourIRResult?: FourIRResult;
}

export interface CapturedImages {
  etcChart?: string;
  roomTop?: string;
  roomSide?: string;
  roomSurface?: string;
  peakTable?: string;
  surfaceTable?: string;
  decayChart?: string;
  frequencyChart?: string;
  heatmapGrid?: string;
  criticalZoneGrid?: string;
  scorecardImage?: string;
  clarityImage?: string;
  unassignedImage?: string;
  modalImage?: string;
  modalFreqResponseImage?: string;
  modalMapsImage?: string;
  modalCriticalMapsImage?: string;
  modalGlobalImage?: string;
  modalSeatImage?: string;
  _dims?: Record<string, { width: number; height: number }>;
}

function formatDate(): string {
  return new Date().toLocaleString();
}

function sanitizeArrow(text: string): string {
  return text.replace(/\u2192/g, ' -> ');
}

function computeSurfaceSummariesFromMerged(mergedPeaks: MergedPeak[]): SurfaceSummary[] {
  const assigned = mergedPeaks.map(m => m.peak).filter(mp => mp.assigned && mp.reflection);
  return computeSurfaceSummaries(assigned);
}

function peakTableHeaders(mode: string, hasFusion: boolean): string[] {
  if (mode === 'ir-only') {
    const h = ['#'];
    if (hasFusion) h.push('IR Source');
    h.push('Delay (ms)', 'Level (dB)', 'dL (m)', 'Severity', 'Equiv Dist (m)');
    return h;
  }
  const h = ['#'];
  if (hasFusion) h.push('IR Source');
  h.push('Delay (ms)', 'Level (dB)', 'dL (m)', 'L_refl (m)', 'Severity', 'Surface', 'Pred. Delay', 'Err (ms)', 'Conf.', 'P* (x,y,z)', '|S-P*|', '|P*-M|', 'L_pred (m)', 'Bounds');
  return h;
}

function peakTableRow(merged: MergedPeak, idx: number, mode: string, speedOfSound: number, hasFusion: boolean): string[] {
  const mp = merged.peak;
  const deltaL = mp.peak.extraPathLength ?? ((mp.peak.delay_ms / 1000) * speedOfSound);
  if (mode === 'ir-only') {
    const r = [String(idx + 1)];
    if (hasFusion) r.push(sanitizeArrow(merged.irSources.join(', ')));
    r.push(
      mp.peak.delay_ms.toFixed(2),
      mp.peak.rel_dB.toFixed(1),
      deltaL.toFixed(3),
      mp.peak.severity.toFixed(1),
      (mp.peak.equivalentDistance ?? 0).toFixed(3),
    );
    return r;
  }
  const r = [String(idx + 1)];
  if (hasFusion) r.push(sanitizeArrow(merged.irSources.join(', ')));
  r.push(
    mp.peak.delay_ms.toFixed(2),
    mp.peak.rel_dB.toFixed(1),
    deltaL.toFixed(3),
    (mp.peak.targetReflectedLength ?? 0).toFixed(3),
    mp.peak.severity.toFixed(1),
    mp.assigned ? sanitizeArrow(mp.reflection!.surfaceLabel) : 'Unassigned',
    mp.assigned ? mp.reflection!.delay_ms.toFixed(2) : '-',
    mp.assigned ? mp.timeError.toFixed(3) : '-',
    mp.assigned ? `${(mp.confidence * 100).toFixed(0)}%` : '-',
    mp.assigned ? `(${mp.reflection!.reflectionPoint.x.toFixed(2)}, ${mp.reflection!.reflectionPoint.y.toFixed(2)}, ${mp.reflection!.reflectionPoint.z.toFixed(2)})` : '-',
    mp.assigned ? mp.reflection!.speakerDistance.toFixed(3) : '-',
    mp.assigned ? mp.reflection!.micDistance.toFixed(3) : '-',
    mp.assigned ? (mp.reflection!.speakerDistance + mp.reflection!.micDistance).toFixed(3) : '-',
    mp.assigned ? (mp.reflection!.insideSurfaceBounds ? 'Yes' : 'No') : '-',
  );
  return r;
}

function surfaceTableRow(s: SurfaceSummary): string[] {
  return [sanitizeArrow(s.surfaceLabel), String(s.peakCount), s.worstSeverity.toFixed(1), s.earliestTime.toFixed(2), s.totalSeverity.toFixed(2)];
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getPngDimensions(dataUrl: string): { width: number; height: number } {
  const base64 = dataUrl.split(',')[1];
  if (!base64 || base64.length < 44) return { width: 800, height: 400 };
  const raw = atob(base64.substring(0, 64));
  if (raw.length > 24 && raw.charCodeAt(1) === 0x50 && raw.charCodeAt(2) === 0x4E && raw.charCodeAt(3) === 0x47) {
    const w = (raw.charCodeAt(16) << 24) | (raw.charCodeAt(17) << 16) | (raw.charCodeAt(18) << 8) | raw.charCodeAt(19);
    const h = (raw.charCodeAt(20) << 24) | (raw.charCodeAt(21) << 16) | (raw.charCodeAt(22) << 8) | raw.charCodeAt(23);
    if (w > 0 && h > 0) return { width: w, height: h };
  }
  return { width: 800, height: 400 };
}

function fitToMax(imgW: number, imgH: number, maxW: number, maxH: number): { w: number; h: number } {
  const ratio = imgW / imgH;
  let w = Math.min(maxW, imgW);
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  return { w, h };
}

async function fetchImageAsUint8Array(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function fetchImageAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function generateWordReport(data: ReportData, images: CapturedImages): Promise<void> {
  const { irData, settings, room, speakers, micPosition, matchedPeaks, surfaceSummaries, surfaceMaterials } = data;
  const isGeo = settings.mode === 'geometry';
  const analysisMode = detectAnalysisMode(data.fusionDatasets);
  const reportHasFusion = !!(data.fusionOverlayPeaks && data.fusionOverlayPeaks.length > 0) ||
    !!(data.fusionPerIRPeaks && data.fusionPerIRPeaks.length > 0);
  const reportMainIRLabel = data.fusionPerIRPeaks && data.fusionPerIRPeaks.length > 0
    ? data.fusionPerIRPeaks[0].label : 'Primary';
  const mergedPeaks = mergeAndDeduplicatePeaks(matchedPeaks, data.fusionOverlayPeaks, data.fusionPerIRPeaks, reportMainIRLabel);

  const cellBorder = {
    top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
  };

  const headerShading = { type: ShadingType.SOLID as const, color: "E8E8E8", fill: "E8E8E8" };

  function makeHeaderCell(text: string): TableCell {
    return new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 16, font: "Calibri" })] })],
      borders: cellBorder,
      shading: headerShading,
    });
  }

  function makeCell(text: string, color?: string): TableCell {
    return new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, size: 16, font: "Calibri", bold: !!color, color: color })] })],
      borders: cellBorder,
    });
  }

  function makeDocTable(headers: string[], rows: string[][], cellColorFn?: (rowIdx: number, colIdx: number, value: string) => string | undefined): Table {
    return new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: headers.map(h => makeHeaderCell(h)) }),
        ...rows.map((row, ri) => new TableRow({
          children: row.map((cell, ci) => makeCell(cell, cellColorFn ? cellColorFn(ri, ci, cell) : undefined))
        })),
      ],
    });
  }

  function severityCellColor(val: string): string | undefined {
    const num = parseFloat(val);
    if (isNaN(num)) return undefined;
    if (num >= -5) return "DC2626";
    if (num >= -15) return "EA580C";
    return undefined;
  }

  function heading(text: string, level: typeof HeadingLevel[keyof typeof HeadingLevel]): Paragraph {
    return new Paragraph({ text, heading: level, spacing: { before: 240, after: 120 } });
  }

  function para(text: string): Paragraph {
    return new Paragraph({ children: [new TextRun({ text, size: 20, font: "Calibri" })], spacing: { after: 80 } });
  }

  function italicPara(text: string): Paragraph {
    return new Paragraph({ children: [new TextRun({ text, size: 18, font: "Calibri", italics: true, color: "555555" })], spacing: { after: 80 } });
  }

  function boldPara(label: string, value: string): Paragraph {
    return new Paragraph({
      children: [
        new TextRun({ text: label, bold: true, size: 20, font: "Calibri" }),
        new TextRun({ text: value, size: 20, font: "Calibri" }),
      ],
      spacing: { after: 60 },
    });
  }

  function pageBreakPara(): Paragraph {
    return new Paragraph({ children: [new PageBreak()] });
  }

  const maxDocWidth = 590;
  const maxDocHeight = 700;

  const _d = images._dims || {};
  function imageFromDataUrl(dataUrl: string, dimKey?: string): Paragraph {
    const imgData = dataUrlToUint8Array(dataUrl);
    const dims = (dimKey && _d[dimKey]) ? _d[dimKey] : getPngDimensions(dataUrl);
    const { w, h } = fitToMax(dims.width, dims.height, maxDocWidth, maxDocHeight);
    return new Paragraph({
      children: [
        new ImageRun({
          data: imgData,
          transformation: { width: w, height: h },
          type: "png",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    });
  }

  const sections: any[] = [];

  let coverLogoData: Uint8Array | null = null;
  try {
    coverLogoData = await fetchImageAsUint8Array(coverLogoPath);
  } catch {}

  const coverChildren: any[] = [];
  coverChildren.push(new Paragraph({ spacing: { before: 2400 } }));
  coverChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "IRA - Impulse Reflection Analyzer", size: 56, bold: true, font: "Calibri", color: "FFFFFF" })],
    spacing: { after: 400 },
  }));
  if (coverLogoData) {
    coverChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          data: coverLogoData,
          transformation: { width: 350, height: 350 },
          type: "png",
        }),
      ],
      spacing: { after: 400 },
    }));
  }
  coverChildren.push(new Paragraph({ spacing: { before: 1200 } }));
  coverChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: `Generated: ${formatDate()}`, size: 20, font: "Calibri", color: "AAAAAA" })],
    spacing: { after: 200 },
  }));
  coverChildren.push(new Paragraph({ spacing: { before: 2000 } }));
  coverChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: "PRoadStudio - Cerroni Loris", size: 22, font: "Calibri", color: "AAAAAA" })],
  }));
  sections.push({
    properties: {
      page: {
        background: { color: "000000" },
      },
    },
    children: coverChildren,
  });

  const inputChildren: any[] = [];
  inputChildren.push(heading("1. Input Configuration", HeadingLevel.HEADING_1));
  inputChildren.push(italicPara("This section lists all the parameters and settings used for the acoustic analysis. It includes details about the impulse response file, the analysis mode (IR-Only or Geometry), detection thresholds, and room geometry configuration. These inputs define how the analyzer processes the impulse response and identifies early reflections."));

  const analysisModeLabel = analysisMode === 'FUSION_4IR' ? '4-IR Fusion' : analysisMode === 'DUAL_IR' ? 'Dual IR' : 'Single IR';
  inputChildren.push(boldPara("Analysis Configuration: ", analysisModeLabel));

  if (analysisMode === 'SINGLE_IR' && irData) {
    inputChildren.push(heading("IR File", HeadingLevel.HEADING_3));
    inputChildren.push(boldPara("Filename: ", irData.filename));
    inputChildren.push(boldPara("Sample Rate: ", `${irData.sampleRate} Hz`));
    inputChildren.push(boldPara("Samples: ", String(irData.samples.length)));
  } else if (analysisMode === 'DUAL_IR' && data.fusionDatasets) {
    inputChildren.push(heading("IR Files (Dual IR)", HeadingLevel.HEADING_3));
    for (const ds of data.fusionDatasets) {
      inputChildren.push(boldPara(`${sanitizeArrow(ds.label)}: `, ds.irData.filename));
    }
    if (irData) {
      inputChildren.push(boldPara("Sample Rate: ", `${irData.sampleRate} Hz`));
    }
  } else if (analysisMode === 'FUSION_4IR' && data.fusionDatasets) {
    inputChildren.push(heading("IR Files (4-IR Fusion)", HeadingLevel.HEADING_3));
    const irLabels = ['S1->M1', 'S2->M1', 'S1->M2', 'S2->M2'];
    data.fusionDatasets.forEach((ds, i) => {
      const mapping = irLabels[i] || sanitizeArrow(ds.label);
      inputChildren.push(boldPara(`${sanitizeArrow(ds.label)} (${mapping}): `, ds.irData.filename));
    });
    if (irData) {
      inputChildren.push(boldPara("Sample Rate: ", `${irData.sampleRate} Hz`));
    }
  } else if (irData) {
    inputChildren.push(heading("IR File", HeadingLevel.HEADING_3));
    inputChildren.push(boldPara("Filename: ", irData.filename));
    inputChildren.push(boldPara("Sample Rate: ", `${irData.sampleRate} Hz`));
    inputChildren.push(boldPara("Samples: ", String(irData.samples.length)));
  }

  inputChildren.push(heading("Analysis Settings", HeadingLevel.HEADING_3));
  inputChildren.push(boldPara("Mode: ", settings.mode === 'geometry' ? 'Geometry' : 'IR-Only'));
  inputChildren.push(boldPara("Speed of Sound: ", `${settings.speedOfSound} m/s`));
  inputChildren.push(boldPara("Early Window: ", `${settings.earlyStartMs} - ${settings.earlyWindowMs} ms`));
  inputChildren.push(boldPara("Peak Threshold: ", `${settings.peakThresholdDb} dB (relative to direct)`));
  inputChildren.push(boldPara("Min Peak Separation: ", `${settings.minSepMs} ms`));
  inputChildren.push(boldPara("Noise Floor Margin: ", `${settings.noiseFloorMarginDb} dB`));
  inputChildren.push(boldPara("ETC Smoothing: ", `${settings.smoothingMs} ms`));
  inputChildren.push(boldPara("Match Tolerance: ", `${settings.peakMatchTolerance} ms`));

  if (isGeo) {
    inputChildren.push(heading("Room Dimensions", HeadingLevel.HEADING_3));
    inputChildren.push(boldPara("Length (X): ", `${room.length} m`));
    inputChildren.push(boldPara("Width (Y): ", `${room.width} m`));
    inputChildren.push(boldPara("Height (Z): ", `${room.height} m`));

    inputChildren.push(heading("Positions", HeadingLevel.HEADING_3));
    if (analysisMode === 'FUSION_4IR') {
      const s1 = speakers[0];
      const s2 = speakers.length > 1 ? speakers[1] : speakers[0];
      inputChildren.push(boldPara("Speaker S1: ", `(${s1.position.x}, ${s1.position.y}, ${s1.position.z}) m`));
      inputChildren.push(boldPara("Speaker S2: ", `(${s2.position.x}, ${s2.position.y}, ${s2.position.z}) m`));
      inputChildren.push(boldPara("Microphone M1: ", `(${micPosition.x}, ${micPosition.y}, ${micPosition.z}) m`));
      if (data.mic2Position) {
        inputChildren.push(boldPara("Microphone M2: ", `(${data.mic2Position.x}, ${data.mic2Position.y}, ${data.mic2Position.z}) m`));
      }
    } else if (analysisMode === 'DUAL_IR') {
      for (const spk of speakers) {
        inputChildren.push(boldPara(`${spk.label}: `, `(${spk.position.x}, ${spk.position.y}, ${spk.position.z}) m`));
      }
      inputChildren.push(boldPara("Microphone: ", `(${micPosition.x}, ${micPosition.y}, ${micPosition.z}) m`));
    } else {
      for (const spk of speakers) {
        inputChildren.push(boldPara(`${spk.label}: `, `(${spk.position.x}, ${spk.position.y}, ${spk.position.z}) m`));
      }
      inputChildren.push(boldPara("Microphone: ", `(${micPosition.x}, ${micPosition.y}, ${micPosition.z}) m`));
    }

    inputChildren.push(heading("Surface Materials", HeadingLevel.HEADING_3));
    const surfLabels = ['Front Wall', 'Rear Wall', 'Right Wall', 'Left Wall', 'Floor', 'Ceiling'];
    const matRows = surfLabels.map(l => [l, surfaceMaterials[l] || 'Drywall']);
    inputChildren.push(makeDocTable(['Surface', 'Material'], matRows));
    inputChildren.push(new Paragraph({ text: "" }));
    if (data.ceiling && data.ceiling.type !== 'flat') {
      inputChildren.push(heading("Ceiling Configuration", HeadingLevel.HEADING_3));
      inputChildren.push(boldPara("Type: ", CEILING_TYPE_LABELS[data.ceiling.type] || data.ceiling.type));
      inputChildren.push(boldPara("Min Height: ", `${data.ceiling.minHeight} m`));
      inputChildren.push(boldPara("Max Height: ", `${data.ceiling.maxHeight} m`));
      if (data.ceiling.flatWidth !== undefined && (data.ceiling.type === 'vflat-x' || data.ceiling.type === 'vflat-y')) {
        inputChildren.push(boldPara("Flat Width: ", `${data.ceiling.flatWidth} m`));
      }
    }

    if (data.roomObjects && data.roomObjects.length > 0) {
      inputChildren.push(heading("Room Objects", HeadingLevel.HEADING_3));
      const objHeaders = ['Label', 'Type', 'Position (x,y,z)', 'Dimensions (W×D×H)', 'Material'];
      const objRows = data.roomObjects.map(obj => [
        obj.label,
        obj.type,
        `(${obj.position.x}, ${obj.position.y}, ${obj.position.z})`,
        `${obj.width} × ${obj.depth} × ${obj.height} m`,
        obj.material || 'Generic hard surface',
      ]);
      inputChildren.push(makeDocTable(objHeaders, objRows));
    }

    inputChildren.push(new Paragraph({ text: "" }));
    inputChildren.push(boldPara("Strict Surface Bounds: ", settings.strictBounds ? 'ON' : 'OFF'));
    inputChildren.push(boldPara("2nd Order Reflections: ", settings.enableOrder2 ? 'ON' : 'OFF'));
    inputChildren.push(new Paragraph({ text: "" }));
    inputChildren.push(italicPara("Strict bounds ON: only reflections whose predicted specular point lies within the finite wall rectangle are considered assigned."));
    inputChildren.push(italicPara("2nd order ON: includes two-bounce paths; may still miss reflections caused by furniture/objects."));
    inputChildren.push(italicPara("Coordinates: x front->rear, y right->left, z floor->ceiling."));
  }

  sections.push({ children: inputChildren });

  if (images.etcChart) {
    const etcChildren: any[] = [];
    const etcTitle = analysisMode === 'FUSION_4IR' ? "2. Energy Time Curve – 4 IRs Overlaid" : "2. Energy Time Curve";
    etcChildren.push(heading(etcTitle, HeadingLevel.HEADING_1));
    etcChildren.push(italicPara("The Energy Time Curve (ETC) displays the energy of the impulse response as a function of time, expressed in decibels relative to the direct sound arrival (0 dB). The ETC reveals early reflections as distinct peaks occurring after the direct arrival. The shaded region indicates the early reflection analysis window, and the dashed horizontal line marks the detection threshold. Vertical lines indicate detected peaks: green lines are peaks matched to room surfaces, while yellow dashed lines are unassigned peaks that may originate from furniture, equipment, or higher-order reflections."));
    etcChildren.push(imageFromDataUrl(images.etcChart, 'etcChart'));
    sections.push({ children: etcChildren });
  }

  let sectionNum = 3;

  if (isGeo && images.roomTop) {
    const topChildren: any[] = [];
    topChildren.push(heading(`${sectionNum}. Room View — Top (XY)`, HeadingLevel.HEADING_1));
    topChildren.push(italicPara("This top-down (plan) view shows the room as seen from above, with the Front Wall at the top of the diagram. The coordinate origin (0,0) is at the Front Wall / Right Wall corner. Colored lines represent the reflection paths: from the speaker to the reflection point on the wall surface, and from the reflection point to the microphone. Each color corresponds to a specific room surface. The triangle marker indicates the speaker position and the circle indicates the microphone position."));
    topChildren.push(imageFromDataUrl(images.roomTop, 'roomTop'));
    sections.push({ children: topChildren });
    sectionNum++;
  }

  if (isGeo && images.roomSide) {
    const sideChildren: any[] = [];
    sideChildren.push(heading(`${sectionNum}. Room View — Side (XZ)`, HeadingLevel.HEADING_1));
    sideChildren.push(italicPara("This side (elevation) view shows the room from a lateral perspective, with the Front Wall on the left and the Ceiling at the top. It reveals reflection paths involving the floor and ceiling surfaces that are not visible in the top view. The vertical axis represents room height (Z), allowing visualization of floor bounces and ceiling reflections."));
    sideChildren.push(imageFromDataUrl(images.roomSide, 'roomSide'));
    sections.push({ children: sideChildren });
    sectionNum++;
  }

  if (isGeo && images.roomSurface) {
    const surfViewChildren: any[] = [];
    surfViewChildren.push(heading(`${sectionNum}. Room View — Surfaces (Inside View)`, HeadingLevel.HEADING_1));
    surfViewChildren.push(italicPara("Each panel shows one room surface as seen from inside the room, with the reflection points plotted at their calculated positions on the wall. The semi-transparent zones around each point represent the spatial uncertainty due to the peak match tolerance setting. A larger tolerance means greater uncertainty in the exact reflection point location. The zone radius is derived from the tolerance in milliseconds converted to a distance using the speed of sound. This visualization helps identify which areas of each surface are acoustically active and may benefit from treatment."));
    surfViewChildren.push(imageFromDataUrl(images.roomSurface, 'roomSurface'));
    sections.push({ children: surfViewChildren });
    sectionNum++;
  }

  const peakChildren: any[] = [];
  peakChildren.push(heading(`${sectionNum}. Peak Analysis Results`, HeadingLevel.HEADING_1));
  peakChildren.push(italicPara("This table presents all detected early reflection peaks from the impulse response. Each row represents a peak identified in the Energy Time Curve that exceeds both the relative threshold and the noise floor margin."));
  if (isGeo) {
    peakChildren.push(para("Column definitions:"));
    peakChildren.push(boldPara("Delay (ms): ", "Time delay of the reflection relative to the direct sound arrival. Calculated from the sample offset between the direct peak and the reflection peak."));
    peakChildren.push(boldPara("Level (dB): ", "Amplitude of the reflection in decibels relative to the direct sound (0 dB = same level as direct). More negative values indicate weaker reflections."));
    peakChildren.push(boldPara("dL (m): ", "Extra path length difference. The additional distance the reflected sound travels compared to the direct path, computed as dL = c x dt, where c is the speed of sound and dt is the delay."));
    peakChildren.push(boldPara("L_refl (m): ", "Target total reflected path length. This is the direct distance plus the extra path length (L_dir + dL). For a valid geometric match, this should equal the speaker-to-reflection-point-to-mic distance."));
    peakChildren.push(boldPara("Severity: ", "A composite metric that weights both the reflection level and its arrival time. More negative values indicate less problematic reflections. Early, loud reflections score worst (least negative), as they have the greatest perceptual impact."));
    peakChildren.push(boldPara("Surface Pred.: ", "The room surface assigned to this peak based on geometric analysis. For 2nd-order reflections, shows the two surfaces in sequence (e.g., 'Front Wall -> Rear Wall'). 'Unassigned' means no surface match was found within tolerance — these peaks typically originate from higher-order reflections (multiple surface bounces), diffraction around room objects (furniture, equipment, speaker stands, consoles), or reflections off surfaces not included in the room model. These peaks are analyzed separately in the Unassigned Peaks Analysis section."));
    peakChildren.push(boldPara("Delay Err (ms): ", "The absolute time difference between the measured peak delay and the geometrically predicted delay for the assigned surface. Smaller values indicate a better match."));
    peakChildren.push(boldPara("Conf.: ", "Confidence of the surface assignment, expressed as a percentage. Higher values indicate a closer match between predicted and measured arrival times. Color-coded: green (>=80%) = high confidence, yellow/orange (50-79%) = moderate confidence, red (<50%) = low confidence. Peaks with low confidence should be treated with caution as the surface assignment may be uncertain."));
    peakChildren.push(boldPara("P* (x,y,z): ", "The 3D coordinates (in meters) of the calculated reflection point on the surface. This is the point where the reflected sound path intersects the wall."));
    peakChildren.push(boldPara("|S-P*|: ", "Distance in meters from the speaker to the reflection point P*. This is the first leg of the reflected path."));
    peakChildren.push(boldPara("|P*-M|: ", "Distance in meters from the reflection point P* to the microphone. This is the second leg of the reflected path."));
    peakChildren.push(boldPara("Bounds: ", "'Yes' if the reflection point lies within the physical boundaries of the room surface; 'No' if it falls outside the wall area (which may indicate an invalid match or edge effect)."));
    peakChildren.push(new Paragraph({ text: "" }));
  }
  if (mergedPeaks.length === 0) {
    peakChildren.push(para("No peaks detected."));
  } else {
    peakChildren.push(para(`${mergedPeaks.length} peaks detected${reportHasFusion ? ' (merged from all IRs, duplicates removed)' : ''}.`));
    if (images.peakTable) {
      peakChildren.push(imageFromDataUrl(images.peakTable, 'peakTable'));
    } else {
      const headers = peakTableHeaders(settings.mode, reportHasFusion);
      const rows = mergedPeaks.map((mp, i) => peakTableRow(mp, i, settings.mode, settings.speedOfSound, reportHasFusion));
      const wordSevColIdx = isGeo
        ? (reportHasFusion ? 6 : 5)
        : (reportHasFusion ? 5 : 4);
      peakChildren.push(makeDocTable(headers, rows, (_ri, ci, val) => {
        if (ci === wordSevColIdx) return severityCellColor(val);
        return undefined;
      }));
    }
    peakChildren.push(new Paragraph({ text: "" }));
    peakChildren.push(italicPara("Level(dB) is ETC energy level at the peak time, normalized so direct arrival ≈ 0 dB."));
    peakChildren.push(italicPara("Delays are measured relative to the direct arrival."));
  }
  sections.push({ children: peakChildren });
  sectionNum++;

  const mergedSurfaceSummaries = isGeo
    ? computeSurfaceSummariesFromMerged(mergedPeaks)
    : surfaceSummaries;
  if (isGeo && mergedSurfaceSummaries.length > 0) {
    const surfChildren: any[] = [];
    surfChildren.push(heading(`${sectionNum}. Results By Surface`, HeadingLevel.HEADING_1));
    surfChildren.push(italicPara("This table aggregates the detected reflections by room surface, providing a summary view of which surfaces contribute the most significant early reflections. Severity values are negative; the least negative (closest to 0) values indicate the most problematic reflections."));
    surfChildren.push(para("Column definitions:"));
    surfChildren.push(boldPara("Surface: ", "The name of the room boundary (Front Wall, Rear Wall, Left Wall, Right Wall, Floor, Ceiling)."));
    surfChildren.push(boldPara("Peaks: ", "The number of detected reflection peaks assigned to this surface."));
    surfChildren.push(boldPara("Worst Severity: ", "The highest (least negative) severity value among all peaks assigned to this surface. This identifies the single most problematic reflection from this surface."));
    surfChildren.push(boldPara("Earliest (ms): ", "The arrival time of the first reflection from this surface, in milliseconds after the direct sound. Earlier reflections are generally more perceptually significant."));
    surfChildren.push(boldPara("Total Severity: ", "The sum of all severity values for peaks assigned to this surface. More negative totals indicate more cumulative reflection energy. Surfaces with the least negative totals (closest to 0) have fewer or weaker reflections."));
    surfChildren.push(new Paragraph({ text: "" }));
    if (images.surfaceTable) {
      surfChildren.push(imageFromDataUrl(images.surfaceTable, 'surfaceTable'));
    } else {
      const surfHeaders = ['Surface', 'Peaks', 'Worst Severity', 'Earliest (ms)', 'Total Severity'];
      const surfRows = mergedSurfaceSummaries.map(s => surfaceTableRow(s));
      surfChildren.push(makeDocTable(surfHeaders, surfRows));
    }
    sections.push({ children: surfChildren });
    sectionNum++;
  }

  const scorecardPeaks = mergedPeaks.map(m => m.peak);
  if (irData && scorecardPeaks.length > 0) {
    const scorecard = computeScorecard(scorecardPeaks, 'Mix');
    const scChildren: any[] = [];
    scChildren.push(heading(`${sectionNum}. Quality Gates Scorecard`, HeadingLevel.HEADING_1));
    scChildren.push(italicPara("A compact summary of key acoustic quality indicators. ITDG, RFZ compliance, critical early reflections, peak counts by time bin, and worst offenders."));
    if (images.scorecardImage) {
      scChildren.push(imageFromDataUrl(images.scorecardImage, 'scorecardImage'));
    } else {
      scChildren.push(boldPara("Preset: ", scorecard.preset));
      scChildren.push(boldPara("ITDG: ", `${scorecard.itdg.value_ms === Infinity ? 'N/A' : scorecard.itdg.value_ms.toFixed(1) + ' ms'} — ${scorecard.itdg.verdict}`));
      scChildren.push(boldPara("RFZ (0-20 ms): PASS < -15 dB, WARN -15 to -10 dB, FAIL >= -10 dB: ", scorecard.rfz.verdict));
      if (scorecard.rfz.worstPeak) {
        scChildren.push(para(`  Worst: ${scorecard.rfz.worstPeak.peak.delay_ms.toFixed(1)} ms at ${scorecard.rfz.worstDb.toFixed(1)} dB`));
      }
      scChildren.push(boldPara("Critical Early (0-10 ms): PASS < -12 dB, WARN -12 to -6 dB, FAIL >= -6 dB: ", scorecard.criticalEarly.verdict));
      scChildren.push(boldPara("Peak counts: ", `0-10 ms: ${scorecard.timeBins.bin_0_10}, 10-20 ms: ${scorecard.timeBins.bin_10_20}, 20-50 ms: ${scorecard.timeBins.bin_20_50}`));
      scChildren.push(new Paragraph({ text: "" }));
      scChildren.push(para("Top 3 Worst Offenders:"));
      const woHeaders = ['Delay (ms)', 'Level (dB)', 'Surface', 'Confidence', 'Severity'];
      const woRows = scorecard.worstOffenders.map(wo => [
        wo.delay_ms.toFixed(1), wo.rel_dB.toFixed(1), sanitizeArrow(wo.assignedSurface),
        wo.assignedSurface === 'Unassigned' ? '-' : `${(wo.confidence * 100).toFixed(0)}%`,
        wo.severity.toFixed(1)
      ]);
      scChildren.push(makeDocTable(woHeaders, woRows));
    }
    scChildren.push(new Paragraph({ text: "" }));
    scChildren.push(italicPara(`Scorecard computed from ${mergedPeaks.length} detected peaks (same as Peak Table).`));
    sections.push({ children: scChildren });
    sectionNum++;
  }

  if (irData) {
    const directIdx = findDirectArrival(irData);
    const decayMetrics = computeDecayMetrics(irData, directIdx);
    const dmChildren: any[] = [];
    dmChildren.push(heading(`${sectionNum}. Decay Metrics (Schroeder)`, HeadingLevel.HEADING_1));
    dmChildren.push(italicPara("Reverberation time estimates derived from the Schroeder backward-integrated energy decay curve. Values are relative decay characteristics."));

    if (analysisMode !== 'SINGLE_IR' && data.fusionDatasets && data.fusionDatasets.length > 0) {
      const fusionDecay = data.fusionDatasets.map(ds => {
        const dIdx = findDirectArrival(ds.irData);
        return { label: ds.label, metrics: computeDecayMetrics(ds.irData, dIdx) };
      });
      const avgFn = (vals: (number | null)[]) => {
        const valid = vals.filter((v): v is number => v !== null);
        return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
      };
      const avgEdt = avgFn(fusionDecay.map(f => f.metrics.edt));
      const avgT20 = avgFn(fusionDecay.map(f => f.metrics.t20));
      const avgT30 = avgFn(fusionDecay.map(f => f.metrics.t30));
      const avgRt60 = avgFn(fusionDecay.map(f => f.metrics.rt60));

      dmChildren.push(boldPara("Fused Average EDT: ", avgEdt !== null ? `${avgEdt.toFixed(3)} s` : 'N/A'));
      dmChildren.push(boldPara("Fused Average T20: ", avgT20 !== null ? `${avgT20.toFixed(3)} s` : 'N/A'));
      dmChildren.push(boldPara("Fused Average T30: ", avgT30 !== null ? `${avgT30.toFixed(3)} s` : 'N/A'));
      dmChildren.push(boldPara("Fused Average RT60: ", avgRt60 !== null ? `${avgRt60.toFixed(3)} s` : 'N/A'));
      dmChildren.push(new Paragraph({ text: "" }));
      dmChildren.push(para("Per-IR Breakdown:"));
      for (const fd of fusionDecay) {
        const m = fd.metrics;
        dmChildren.push(para(`${fd.label}: EDT=${m.edt !== null ? m.edt.toFixed(3) : 'N/A'} s, T20=${m.t20 !== null ? m.t20.toFixed(3) : 'N/A'} s, T30=${m.t30 !== null ? m.t30.toFixed(3) : 'N/A'} s, RT60=${m.rt60 !== null ? m.rt60.toFixed(3) : 'N/A'} s`));
      }
    } else {
      dmChildren.push(boldPara("EDT: ", decayMetrics.edt !== null ? `${decayMetrics.edt.toFixed(3)} s` : 'N/A'));
      dmChildren.push(boldPara("T20: ", decayMetrics.t20 !== null ? `${decayMetrics.t20.toFixed(3)} s` : 'N/A'));
      dmChildren.push(boldPara("T30: ", decayMetrics.t30 !== null ? `${decayMetrics.t30.toFixed(3)} s` : 'N/A'));
      dmChildren.push(boldPara("RT60 (est.): ", decayMetrics.rt60 !== null ? `${decayMetrics.rt60.toFixed(3)} s` : 'N/A'));
    }
    dmChildren.push(new Paragraph({ text: "" }));
    dmChildren.push(para(`Early vs Late: ${decayMetrics.slopeInterpretation}`));
    if (images.decayChart) {
      dmChildren.push(imageFromDataUrl(images.decayChart, 'decayChart'));
    }
    sections.push({ children: dmChildren });
    sectionNum++;

    const clarity = computeClarityMetrics(irData, directIdx);
    const clChildren: any[] = [];
    clChildren.push(heading(`${sectionNum}. Clarity & Definition`, HeadingLevel.HEADING_1));
    clChildren.push(italicPara("Energy-based metrics for speech intelligibility and musical clarity."));
    if (images.clarityImage) {
      clChildren.push(imageFromDataUrl(images.clarityImage, 'clarityImage'));
    } else {
      const clHeaders = ['Metric', 'Value', 'Description'];
      const clRows = [
        ['C50', clarity.c50 !== null ? `${clarity.c50.toFixed(2)} dB` : 'N/A', 'Early/late ratio (50 ms) — speech clarity'],
        ['D50', clarity.d50 !== null ? `${clarity.d50.toFixed(1)} %` : 'N/A', 'Early energy fraction — speech definition'],
        ['C80', clarity.c80 !== null ? `${clarity.c80.toFixed(2)} dB` : 'N/A', 'Early/late ratio (80 ms) — musical clarity'],
        ['Ts', clarity.ts_ms !== null ? `${clarity.ts_ms.toFixed(1)} ms` : 'N/A', 'Centre time — perceived distance'],
      ];
      clChildren.push(makeDocTable(clHeaders, clRows));
      clChildren.push(new Paragraph({ text: "" }));
      clChildren.push(para(clarity.interpretation));
    }
    sections.push({ children: clChildren });
    sectionNum++;

    const combSigs = computeCombSignatures(matchedPeaks, 5);
    if (combSigs.length > 0) {
      const frChildren: any[] = [];
      frChildren.push(heading(`${sectionNum}. Frequency Response & Comb Impact`, HeadingLevel.HEADING_1));
      frChildren.push(italicPara("Comb filter signatures of the top reflections, showing their fundamental spacing and first notch frequencies."));
      if (images.frequencyChart) {
        frChildren.push(imageFromDataUrl(images.frequencyChart, 'frequencyChart'));
      }
      const combHeaders = ['Delay (ms)', 'Level (dB)', 'Surface', 'Comb Spacing (Hz)', 'Notch Frequencies (Hz)'];
      const combRows = combSigs.map(s => [
        s.delay_ms.toFixed(2), s.rel_dB.toFixed(1), sanitizeArrow(s.surface),
        String(s.combSpacing_Hz), s.notchFrequencies.slice(0, 5).join(', ')
      ]);
      frChildren.push(makeDocTable(combHeaders, combRows));
      sections.push({ children: frChildren });
      sectionNum++;
    }
  }

  const canonicalPeaksForUnassigned = mergedPeaks.map(m => m.peak);
  if (isGeo && irData && data.surfaceWeights) {
    const unassignedDiags = analyzeUnassignedPeaks(
      canonicalPeaksForUnassigned, room, speakers[0].position, micPosition, settings.speedOfSound,
      data.surfaceWeights, surfaceMaterials, settings.peakMatchTolerance, data.ceiling, data.roomObjects
    );
    if (unassignedDiags.length > 0) {
      const udChildren: any[] = [];
      udChildren.push(heading(`${sectionNum}. Unassigned Peaks Analysis`, HeadingLevel.HEADING_1));
      udChildren.push(italicPara("Diagnostics for peaks that could not be matched to 1st-order specular reflections. Each peak is classified and the top 3 closest surface candidates are listed with rejection reasons."));
      for (const diag of unassignedDiags) {
        udChildren.push(boldPara(`Peak @ ${diag.peak.peak.delay_ms.toFixed(2)} ms: `, `${diag.peak.peak.rel_dB.toFixed(1)} dB  |  severity: ${diag.peak.peak.severity.toFixed(1)}  |  ${diag.classification}`));
        udChildren.push(italicPara(diag.classificationReason));
        if (diag.topCandidates.length > 0) {
          const candHeaders = ['Candidate Surface', 'Pred Delay (ms)', 'Time Error (ms)', 'BoundsPass', 'uInSegment', 'Accepted', 'Reject Reason'];
          const candRows = diag.topCandidates.map(c => {
            return [
              sanitizeArrow(c.surfaceLabel), c.predictedDelay_ms.toFixed(2), c.timeError_ms.toFixed(3),
              c.boundsPass ? 'Y' : 'N', c.uInSegment ? 'Y' : 'N',
              c.accepted ? 'Y' : 'N', c.rejectReason
            ];
          });
          udChildren.push(makeDocTable(candHeaders, candRows));
          udChildren.push(new Paragraph({ text: "" }));
        }
      }
      sections.push({ children: udChildren });
      sectionNum++;
    }

    const fusionHeatmapPeaks = data.fusionOverlayPeaks && data.fusionOverlayPeaks.length > 0
      ? [...matchedPeaks, ...data.fusionOverlayPeaks.filter(fp => {
          const key = `${(fp.peak.delay_ms ?? 0).toFixed(3)}_${fp.reflection?.surfaceLabel || ''}`;
          return !matchedPeaks.some(mp => `${(mp.peak.delay_ms ?? 0).toFixed(3)}_${mp.reflection?.surfaceLabel || ''}` === key);
        })]
      : matchedPeaks;

    const heatmaps = computeSurfaceHeatmaps(matchedPeaks, room, settings.speedOfSound, settings.peakMatchTolerance);
    const hmWithData = heatmaps.filter(h => h.reflectionPoints.length > 0);
    if (hmWithData.length > 0) {
      const hmChildren: any[] = [];
      hmChildren.push(heading(`${sectionNum}. Treatment Target Heatmaps`, HeadingLevel.HEADING_1));
      hmChildren.push(italicPara("Per-surface criticality heatmaps showing where acoustic treatment is most needed. Hotspots indicate areas with concentrated reflection energy."));
      if (images.heatmapGrid) {
        hmChildren.push(imageFromDataUrl(images.heatmapGrid, 'heatmapGrid'));
      }
      const supportHeatmaps = analysisMode !== 'SINGLE_IR' && data.fusionOverlayPeaks
        ? computeSurfaceHeatmaps(fusionHeatmapPeaks, room, settings.speedOfSound, settings.peakMatchTolerance)
        : null;
      for (const hm of hmWithData) {
        const assignedCount = hm.reflectionPoints.length;
        const supportCount = supportHeatmaps
          ? (supportHeatmaps.find(sh => sh.surfaceLabel === hm.surfaceLabel)?.reflectionPoints.length ?? assignedCount)
          : assignedCount;
        hmChildren.push(boldPara(`${hm.surfaceLabel}: `, `Assigned reflections: ${assignedCount}, Support points: ${supportCount}, Hotspots: ${hm.hotspots.length}`));
        if (hm.hotspots.length > 0) {
          for (const hs of hm.hotspots) {
            hmChildren.push(para(`  Hotspot: (${hs.x.toFixed(2)}, ${hs.y.toFixed(2)}, ${hs.z.toFixed(2)}) — intensity: ${(hs.value * 100).toFixed(0)}%`));
          }
        }
      }
      sections.push({ children: hmChildren });
      sectionNum++;
    }

    if (images.criticalZoneGrid) {
      const czChildren: any[] = [];
      czChildren.push(heading(`${sectionNum}. Critical Zones`, HeadingLevel.HEADING_1));
      czChildren.push(italicPara("Critical zone visualization highlighting areas requiring the most urgent acoustic treatment. Red = most critical (highest reflection energy), Yellow = moderate, Green = low priority."));
      czChildren.push(imageFromDataUrl(images.criticalZoneGrid, 'criticalZoneGrid'));
      sections.push({ children: czChildren });
      sectionNum++;
    }

    if (images.modalImage) {
      const modalChildren: any[] = [];
      modalChildren.push(heading(`${sectionNum}. Room Modal Analysis — Room Modes`, HeadingLevel.HEADING_1));
      modalChildren.push(italicPara("Room eigenmode analysis showing predicted standing-wave modes and their correspondence with peaks extracted from the impulse response."));
      modalChildren.push(imageFromDataUrl(images.modalImage, 'modalImage'));
      modalChildren.push(para("The modal analysis identifies the resonant frequencies of the room based on its dimensions. Predicted modes are matched against peaks extracted from the low-frequency portion of the impulse response."));
      sections.push({ children: modalChildren });
      sectionNum++;
    }

    if (images.modalFreqResponseImage) {
      const frChildren: any[] = [];
      frChildren.push(heading(`${sectionNum}. Room Modal Analysis — Frequency Response`, HeadingLevel.HEADING_1));
      frChildren.push(italicPara("Driven room response at the microphone position showing how the combined room modes shape the low-frequency response."));
      frChildren.push(imageFromDataUrl(images.modalFreqResponseImage, 'modalFreqResponseImage'));
      frChildren.push(para("The response is computed by summing the contributions of all matched modes using the driven room model. Green dashed lines mark matched modes; gray lines mark predicted but unmatched modes."));
      sections.push({ children: frChildren });
      sectionNum++;
    }

    if (images.modalMapsImage) {
      const mapsChildren: any[] = [];
      mapsChildren.push(heading(`${sectionNum}. Room Modal Analysis — Pressure Maps (Selected Mode)`, HeadingLevel.HEADING_1));
      mapsChildren.push(italicPara("Pressure distribution maps at the selected mode frequency. Top view shows the XY plane at ear height; side view shows the XZ plane at room centerline."));
      mapsChildren.push(imageFromDataUrl(images.modalMapsImage, 'modalMapsImage'));
      mapsChildren.push(para("Color gradient: Blue indicates cancellation (null zones), Green indicates neutral pressure, Red indicates resonance (high pressure). Speaker (S) and microphone (M) positions are marked."));
      sections.push({ children: mapsChildren });
      sectionNum++;
    }

    if (images.modalCriticalMapsImage) {
      const cmChildren: any[] = [];
      cmChildren.push(heading(`${sectionNum}. Room Modal Analysis — Critical Mode Pressure Maps`, HeadingLevel.HEADING_1));
      cmChildren.push(italicPara("Pressure distribution at the strongest matched room modes, showing where standing-wave patterns create the most significant peaks and nulls."));
      cmChildren.push(imageFromDataUrl(images.modalCriticalMapsImage, 'modalCriticalMapsImage'));
      cmChildren.push(para("These maps show the spatial pressure distribution for the most energetic room modes. Understanding these patterns is essential for targeted bass trap placement and listening position optimization."));
      sections.push({ children: cmChildren });
      sectionNum++;
    }

    if (images.modalGlobalImage) {
      const globalChildren: any[] = [];
      globalChildren.push(heading(`${sectionNum}. Room Modal Analysis — Global Pressure Map`, HeadingLevel.HEADING_1));
      globalChildren.push(italicPara("Broadband average of all predicted modes across the full analysis frequency range. Top 5 seat candidates are marked with stars (★)."));
      globalChildren.push(imageFromDataUrl(images.modalGlobalImage, 'modalGlobalImage'));
      globalChildren.push(para("The global pressure map shows the combined effect of all room modes. Stars indicate the top 5 candidate listening positions ranked by the seat optimizer. #1 (gold) is the optimal position."));
      sections.push({ children: globalChildren });
      sectionNum++;
    }

    if (images.modalSeatImage) {
      const seatChildren: any[] = [];
      seatChildren.push(heading(`${sectionNum}. Room Modal Analysis — Seat Optimizer`, HeadingLevel.HEADING_1));
      seatChildren.push(italicPara("Systematic search for the listening position with the flattest low-frequency response, showing ranked candidates and a frequency response comparison."));
      seatChildren.push(imageFromDataUrl(images.modalSeatImage, 'modalSeatImage'));
      seatChildren.push(para("The optimizer evaluates candidate positions using a multi-objective cost function: Jvar (response variance), Jnull (null penalty), Jpeak (resonance penalty), and Jsym (left-right symmetry). Lower total score is better. The frequency response comparison shows how the optimal position compares to the current mic position."));
      sections.push({ children: seatChildren });
      sectionNum++;
    }

    const fusionChildren: any[] = [];
    fusionChildren.push(heading(`${sectionNum}. Multi-Measurement Fusion (Dual IR & 4-IR)`, HeadingLevel.HEADING_1));

    if (data.dualIRResult) {
      const dr = data.dualIRResult;
      fusionChildren.push(italicPara("Dual IR fusion compares two speaker positions to one microphone, highlighting stereo consistency and asymmetric reflections."));
      fusionChildren.push(boldPara("Stereo Consistency: ", `${dr.stereoConsistencyPercent.toFixed(1)}%`));

      fusionChildren.push(heading(`${sectionNum}.1 Fused Surface Ranking`, HeadingLevel.HEADING_2));
      fusionChildren.push(para("Surfaces ranked by combined severity from both speakers. Stereo-confirmed surfaces show consistent reflections from both positions."));
      const fusedRows = dr.fusedSurfaces
        .sort((a, b) => b.combinedSeverity - a.combinedSeverity)
        .map(s => [
          s.surfaceLabel,
          s.leftPeaks.length.toString(),
          s.rightPeaks.length.toString(),
          s.stereoConfirmed ? "Yes" : "No",
          s.fusedCost.toFixed(2),
          s.combinedSeverity.toFixed(1) + " dB",
        ]);
      fusionChildren.push(makeDocTable(
        ["Surface", "Left Peaks", "Right Peaks", "Stereo Confirmed", "Fused Cost", "Combined Severity"],
        fusedRows,
        (_ri, ci, val) => {
          if (ci === 3) return val === "Yes" ? "16A34A" : "DC2626";
          if (ci === 5) return severityCellColor(val.replace(" dB", ""));
          return undefined;
        }
      ));

      if (dr.asymmetricPeaks.length > 0) {
        fusionChildren.push(heading(`${sectionNum}.2 Asymmetric Peaks`, HeadingLevel.HEADING_2));
        fusionChildren.push(para("Peaks appearing in one speaker's measurement but not the other, indicating asymmetric room behavior."));
        const asymRows = dr.asymmetricPeaks.map(ap => [
          ap.peak.surface || "Unassigned",
          ap.source,
          `${ap.peak.delayMs.toFixed(2)} ms`,
          `${ap.peak.relativeDb.toFixed(1)} dB`,
          ap.reason,
        ]);
        fusionChildren.push(makeDocTable(
          ["Surface", "Source", "Delay", "Level", "Reason"],
          asymRows
        ));
      }
    } else if (data.fourIRResult) {
      const fr = data.fourIRResult;
      fusionChildren.push(italicPara("4-IR fusion compares two speakers × two microphone positions (4 measurements) for cross-position consistency analysis."));

      fusionChildren.push(heading(`${sectionNum}.1 Multi-View Surface Results`, HeadingLevel.HEADING_2));
      fusionChildren.push(para("Each surface is analyzed across all 4 measurement paths. Higher support counts indicate reflections confirmed by multiple speaker/mic combinations."));
      const srRows = fr.surfaceResults
        .sort((a, b) => {
          const aMax = a.hotspots.length > 0 ? Math.max(...a.hotspots.map(h => h.supportCount)) : 0;
          const bMax = b.hotspots.length > 0 ? Math.max(...b.hotspots.map(h => h.supportCount)) : 0;
          return bMax - aMax;
        })
        .map(sr => [
          sr.surfaceLabel,
          sr.totalPeakCount.toString(),
          sr.hotspots.length.toString(),
          sr.hotspots.length > 0 ? Math.max(...sr.hotspots.map(h => h.supportCount)).toString() + "/4" : "0/4",
          sr.disagreements.length > 0 ? sr.disagreements.join("; ") : "None",
        ]);
      fusionChildren.push(makeDocTable(
        ["Surface", "Total Peaks", "Hotspots", "Max Support", "Disagreements"],
        srRows,
        (_ri, ci, val) => {
          if (ci === 3) {
            const n = parseInt(val);
            if (n >= 3) return "16A34A";
            if (n >= 2) return "CA8A04";
            return "DC2626";
          }
          return undefined;
        }
      ));

      const allHotspots = fr.surfaceResults.flatMap(sr => sr.hotspots).filter(h => h.supportCount >= 2);
      if (allHotspots.length > 0) {
        fusionChildren.push(heading(`${sectionNum}.2 3D-Supported Hotspots`, HeadingLevel.HEADING_2));
        fusionChildren.push(para("Reflection hotspots confirmed by 2 or more measurement paths, sorted by support count and confidence."));
        const hsRows = allHotspots
          .sort((a, b) => b.supportCount - a.supportCount || b.confidence - a.confidence)
          .slice(0, 30)
          .map(h => [
            h.surfaceLabel,
            `(${h.avgX.toFixed(2)}, ${h.avgY.toFixed(2)}, ${h.avgZ.toFixed(2)})`,
            `${h.supportCount}/4`,
            h.supportingIRs.join(", "),
            `${h.avgTimeError.toFixed(2)} ms`,
            `${h.avgRelDb.toFixed(1)} dB`,
            `${(h.confidence * 100).toFixed(0)}%`,
          ]);
        fusionChildren.push(makeDocTable(
          ["Surface", "Position (m)", "Support", "Supporting IRs", "Avg Time Error", "Avg Level", "Confidence"],
          hsRows,
          (_ri, ci, val) => {
            if (ci === 2) {
              const n = parseInt(val);
              if (n >= 3) return "16A34A";
              if (n >= 2) return "CA8A04";
              return undefined;
            }
            return undefined;
          }
        ));
      }
    } else {
      fusionChildren.push(italicPara("Multi-measurement fusion analysis requires additional impulse response measurements captured from different speaker/microphone positions. These features are available in the interactive UI tabs (Dual IR and 4-IR) when multiple measurements are loaded."));
      fusionChildren.push(boldPara("Dual IR Fusion: ", "Compares two speakers to one mic position. Overlaps matched surfaces and highlights symmetric/asymmetric behavior, aiding stereo speaker placement decisions."));
      fusionChildren.push(boldPara("4-IR Fusion: ", "Compares two speakers × two mic positions (4 measurements total). Provides cross-position consistency analysis and surface-level agreement matrices for comprehensive room treatment planning."));
      fusionChildren.push(para("To include detailed fusion results in a report, run the Dual IR or 4-IR analysis from the interactive tabs."));
    }

    sections.push({ children: fusionChildren });
    sectionNum++;
  }

  const notesChildren: any[] = [];
  notesChildren.push(heading(`${sectionNum}. Methodology Notes`, HeadingLevel.HEADING_1));
  notesChildren.push(italicPara("This section describes the general approach and principles behind the analysis."));
  if (!isGeo) {
    notesChildren.push(para("This analysis examines the impulse response (IR) of the room to identify early reflections. The IR is converted into an Energy Time Curve (ETC), which shows how acoustic energy decays over time after the direct sound arrives. Peaks in the ETC correspond to discrete reflections arriving at the measurement position."));
    notesChildren.push(para("Each detected peak is characterized by its arrival time (delay relative to the direct sound), its energy level (in dB relative to the direct sound), and a severity rating that accounts for both the level and the timing of the reflection. Earlier and louder reflections receive higher severity ratings, as they have a greater perceptual impact on sound quality, imaging, and speech intelligibility."));
    notesChildren.push(para("Without room geometry, exact surface assignments are not possible. Instead, the equivalent distance is provided, representing half the extra path length traveled by the reflected sound compared to the direct path. This gives a practical estimate of how far away the reflecting surface might be."));
  } else {
    notesChildren.push(para("This analysis combines measured impulse response data with the known room geometry to identify and attribute early reflections to specific room surfaces. The room is modeled as a rectangular enclosure defined by its length, width, and height, with the speaker and microphone positions specified within this space."));
    notesChildren.push(para("For each room surface, the system predicts the expected arrival time and reflection point of specular (mirror-like) reflections based on well-established principles of geometric acoustics. These predicted reflections are then compared against the peaks detected in the Energy Time Curve (ETC) of the measured impulse response."));
    notesChildren.push(para("A peak is assigned to a surface when its measured arrival time closely matches the predicted arrival time within the user-specified tolerance. Each assignment includes a confidence score indicating how closely the measured and predicted values agree. When multiple surfaces could explain a peak, the best geometric match is selected."));
    notesChildren.push(para("Peaks that cannot be matched to any predicted surface reflection within tolerance are labeled 'Unassigned'. These typically arise from reflections off furniture, equipment, or other objects not represented in the simplified room model, as well as from higher-order reflections involving multiple surface bounces."));
    notesChildren.push(para("Each peak is assigned a severity rating that weights both the reflection level and its arrival time. Earlier and louder reflections receive higher severity scores, reflecting their greater perceptual significance for critical listening, mixing, and broadcast applications."));
  }
  sections.push({ children: notesChildren });

  const doc = new Document({ sections });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, "reflection-report.docx");
}

export async function generatePdfReport(data: ReportData, images: CapturedImages): Promise<void> {
  const { irData, settings, room, speakers, micPosition, matchedPeaks, surfaceSummaries, surfaceMaterials } = data;

  const isGeo = settings.mode === 'geometry';
  const analysisMode = detectAnalysisMode(data.fusionDatasets);
  const reportHasFusion = !!(data.fusionOverlayPeaks && data.fusionOverlayPeaks.length > 0) ||
    !!(data.fusionPerIRPeaks && data.fusionPerIRPeaks.length > 0);
  const reportMainIRLabel = data.fusionPerIRPeaks && data.fusionPerIRPeaks.length > 0
    ? data.fusionPerIRPeaks[0].label : 'Primary';
  const mergedPeaks = mergeAndDeduplicatePeaks(matchedPeaks, data.fusionOverlayPeaks, data.fusionPerIRPeaks, reportMainIRLabel);
  const doc = new jsPDF({ orientation: isGeo ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 15;

  function addTitle(text: string, fontSize = 16) {
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", "bold");
    doc.text(text, pageWidth / 2, y, { align: "center" });
    y += fontSize * 0.5 + 2;
  }

  function addHeading(text: string) {
    if (y > pageHeight - 30) { doc.addPage(); y = 15; }
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(text, 14, y);
    y += 6;
  }

  function addSubHeading(text: string) {
    if (y > pageHeight - 30) { doc.addPage(); y = 15; }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(text, 14, y);
    y += 5;
  }

  function addText(text: string) {
    if (y > pageHeight - 20) { doc.addPage(); y = 15; }
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(text, pageWidth - 28);
    doc.text(lines, 14, y);
    y += lines.length * 4;
  }

  function addItalicText(text: string) {
    if (y > pageHeight - 20) { doc.addPage(); y = 15; }
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(100, 100, 100);
    const lines = doc.splitTextToSize(text, pageWidth - 28);
    doc.text(lines, 14, y);
    y += lines.length * 3.5 + 2;
    doc.setTextColor(0, 0, 0);
  }

  function addField(label: string, value: string) {
    if (y > pageHeight - 20) { doc.addPage(); y = 15; }
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text(label, 14, y);
    doc.setFont("helvetica", "normal");
    doc.text(value, 14 + doc.getTextWidth(label) + 1, y);
    y += 5;
  }

  function newPage() {
    doc.addPage();
    y = 15;
  }

  const _dp = images._dims || {};
  function addImageToPage(dataUrl: string, dimKey?: string) {
    const dims = (dimKey && _dp[dimKey]) ? _dp[dimKey] : getPngDimensions(dataUrl);
    const maxW = pageWidth - 28;
    const maxH = pageHeight - y - 15;
    const { w, h } = fitToMax(dims.width, dims.height, maxW, maxH);
    const x = (pageWidth - w) / 2;
    doc.addImage(dataUrl, 'PNG', x, y, w, h);
    y += h + 8;
  }

  doc.setFillColor(0, 0, 0);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  let coverLogoDataUrl: string | null = null;
  try {
    coverLogoDataUrl = await fetchImageAsDataUrl(coverLogoPath);
  } catch {}

  doc.setTextColor(255, 255, 255);
  y = 40;
  doc.setFontSize(28);
  doc.setFont("helvetica", "bold");
  doc.text("IRA - Impulse Reflection Analyzer", pageWidth / 2, y, { align: "center" });
  y += 20;

  if (coverLogoDataUrl) {
    const logoSize = 80;
    const logoX = (pageWidth - logoSize) / 2;
    const logoY = (pageHeight - logoSize) / 2 - 10;
    doc.addImage(coverLogoDataUrl, 'PNG', logoX, logoY, logoSize, logoSize);
  }

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(170, 170, 170);
  doc.text(`Generated: ${formatDate()}`, pageWidth / 2, pageHeight - 30, { align: "center" });

  doc.setFontSize(10);
  doc.text("PRoadStudio - Cerroni Loris", pageWidth / 2, pageHeight - 15, { align: "center" });

  doc.setTextColor(0, 0, 0);

  newPage();
  addHeading("1. Input Configuration");
  addItalicText("This section lists all the parameters and settings used for the acoustic analysis, including the impulse response file, analysis mode, detection thresholds, and room geometry.");

  const pdfModeLabel = analysisMode === 'FUSION_4IR' ? '4-IR Fusion' : analysisMode === 'DUAL_IR' ? 'Dual IR' : 'Single IR';
  addField("Analysis Configuration: ", pdfModeLabel);
  y += 1;

  if (analysisMode === 'SINGLE_IR' && irData) {
    addField("IR File: ", irData.filename);
    addField("Sample Rate: ", `${irData.sampleRate} Hz`);
    addField("Samples: ", String(irData.samples.length));
    y += 2;
  } else if (analysisMode === 'DUAL_IR' && data.fusionDatasets) {
    for (const ds of data.fusionDatasets) {
      addField(`${sanitizeArrow(ds.label)}: `, ds.irData.filename);
    }
    if (irData) addField("Sample Rate: ", `${irData.sampleRate} Hz`);
    y += 2;
  } else if (analysisMode === 'FUSION_4IR' && data.fusionDatasets) {
    const irLabels = ['S1->M1', 'S2->M1', 'S1->M2', 'S2->M2'];
    data.fusionDatasets.forEach((ds, i) => {
      const mapping = irLabels[i] || sanitizeArrow(ds.label);
      addField(`${sanitizeArrow(ds.label)} (${mapping}): `, ds.irData.filename);
    });
    if (irData) addField("Sample Rate: ", `${irData.sampleRate} Hz`);
    y += 2;
  } else if (irData) {
    addField("IR File: ", irData.filename);
    addField("Sample Rate: ", `${irData.sampleRate} Hz`);
    addField("Samples: ", String(irData.samples.length));
    y += 2;
  }

  addField("Mode: ", isGeo ? 'Geometry' : 'IR-Only');
  addField("Speed of Sound: ", `${settings.speedOfSound} m/s`);
  addField("Early Window: ", `${settings.earlyStartMs} - ${settings.earlyWindowMs} ms`);
  addField("Peak Threshold: ", `${settings.peakThresholdDb} dB`);
  addField("Min Separation: ", `${settings.minSepMs} ms`);
  addField("Noise Floor Margin: ", `${settings.noiseFloorMarginDb} dB`);
  addField("Smoothing: ", `${settings.smoothingMs} ms`);
  addField("Tolerance: ", `${settings.peakMatchTolerance} ms`);
  y += 2;

  if (isGeo) {
    addField("Room (LxWxH): ", `${room.length} x ${room.width} x ${room.height} m`);
    if (analysisMode === 'FUSION_4IR') {
      const s1 = speakers[0];
      const s2 = speakers.length > 1 ? speakers[1] : speakers[0];
      addField("Speaker S1: ", `(${s1.position.x}, ${s1.position.y}, ${s1.position.z}) m`);
      addField("Speaker S2: ", `(${s2.position.x}, ${s2.position.y}, ${s2.position.z}) m`);
      addField("Microphone M1: ", `(${micPosition.x}, ${micPosition.y}, ${micPosition.z}) m`);
      if (data.mic2Position) {
        addField("Microphone M2: ", `(${data.mic2Position.x}, ${data.mic2Position.y}, ${data.mic2Position.z}) m`);
      }
    } else {
      for (const spk of speakers) {
        addField(`${spk.label}: `, `(${spk.position.x}, ${spk.position.y}, ${spk.position.z}) m`);
      }
      addField("Microphone: ", `(${micPosition.x}, ${micPosition.y}, ${micPosition.z}) m`);
    }
    const surfLabels = ['Front Wall', 'Rear Wall', 'Right Wall', 'Left Wall', 'Floor', 'Ceiling'];
    addField("Surface Materials: ", surfLabels.map(l => `${l}: ${surfaceMaterials[l] || 'Drywall'}`).join(', '));

    if (data.ceiling && data.ceiling.type !== 'flat') {
      y += 2;
      addText("Ceiling Configuration:");
      addField("  Type: ", CEILING_TYPE_LABELS[data.ceiling.type] || data.ceiling.type);
      addField("  Min Height: ", `${data.ceiling.minHeight} m`);
      addField("  Max Height: ", `${data.ceiling.maxHeight} m`);
      if (data.ceiling.flatWidth !== undefined && (data.ceiling.type === 'vflat-x' || data.ceiling.type === 'vflat-y')) {
        addField("  Flat Width: ", `${data.ceiling.flatWidth} m`);
      }
    }

    if (data.roomObjects && data.roomObjects.length > 0) {
      y += 2;
      addText("Room Objects:");
      const objHeaders = ['Label', 'Type', 'Position', 'W×D×H (m)', 'Material'];
      const objRows = data.roomObjects.map(obj => [
        obj.label,
        obj.type,
        `(${obj.position.x}, ${obj.position.y}, ${obj.position.z})`,
        `${obj.width}×${obj.depth}×${obj.height}`,
        obj.material || 'Generic',
      ]);
      autoTable(doc, {
        startY: y,
        head: [objHeaders], body: objRows,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [80, 80, 80], textColor: [255, 255, 255], fontStyle: "bold" },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 4;
    }

    addField("Strict Bounds: ", settings.strictBounds ? 'ON' : 'OFF');
    addField("2nd Order: ", settings.enableOrder2 ? 'ON' : 'OFF');
    y += 2;
    addItalicText("Strict bounds ON: only reflections whose predicted specular point lies within the finite wall rectangle are considered assigned.");
    addItalicText("2nd order ON: includes two-bounce paths; may still miss reflections caused by furniture/objects.");
    addItalicText("Coordinates: x front->rear, y right->left, z floor->ceiling.");
  }

  let secNum = 2;

  if (images.etcChart) {
    newPage();
    const pdfEtcTitle = analysisMode === 'FUSION_4IR' ? `${secNum}. Energy Time Curve – 4 IRs Overlaid` : `${secNum}. Energy Time Curve`;
    addHeading(pdfEtcTitle);
    addItalicText("The ETC displays energy vs. time in dB relative to the direct sound. Peaks above the threshold indicate early reflections. Green vertical lines show peaks matched to room surfaces; yellow dashed lines show unassigned peaks.");
    y += 4;
    addImageToPage(images.etcChart, 'etcChart');
    secNum++;
  }

  if (isGeo && images.roomTop) {
    newPage();
    addHeading(`${secNum}. Room View - Top (XY)`);
    addItalicText("Top-down view of the room with Front Wall at top. Colored lines show reflection paths from speaker to wall surface to microphone. Origin (0,0) is at the Front-Right corner.");
    y += 4;
    addImageToPage(images.roomTop, 'roomTop');
    secNum++;
  }

  if (isGeo && images.roomSide) {
    newPage();
    addHeading(`${secNum}. Room View - Side (XZ)`);
    addItalicText("Side elevation view with Front Wall at left and Ceiling at top. This reveals floor and ceiling reflection paths not visible in the top view.");
    y += 4;
    addImageToPage(images.roomSide, 'roomSide');
    secNum++;
  }

  if (isGeo && images.roomSurface) {
    newPage();
    addHeading(`${secNum}. Room View - Surfaces (Inside View)`);
    addItalicText("Each panel shows one room surface as seen from inside the room. Reflection points are plotted at their calculated positions. The semi-transparent zones represent spatial uncertainty based on the peak match tolerance setting.");
    y += 4;
    addImageToPage(images.roomSurface, 'roomSurface');
    secNum++;
  }

  newPage();
  addHeading(`${secNum}. Peak Analysis Results`);
  addItalicText("All detected early reflection peaks from the impulse response. Each row represents a peak exceeding both the relative threshold and the noise floor margin.");

  if (isGeo) {
    y += 2;
    addText("Column guide:");
    addText("Delay = time after direct arrival (ms)");
    addText("Level = amplitude relative to direct (dB)");
    addText("DL = extra path length (m)");
    addText("L_refl = total reflected path (m)");
    addText("Severity = composite perceptual metric");
    addText("Surface = assigned wall. 'Unassigned' = no geometric match found — likely higher-order reflections, diffraction from objects (furniture, consoles, speaker stands), or reflections off surfaces not in the room model. These carry higher uncertainty.");
    addText("Pred. Delay = predicted geometric delay (ms)");
    addText("Err = time error of match (ms)");
    addText("Conf. = match confidence (%). Color-coded: green (>=80%) high, orange (50-79%) moderate, red (<50%) low confidence");
    addText("P* = reflection point coordinates (x,y,z)");
    addText("|S-P*| = speaker-to-point distance (m)");
    addText("|P*-M| = point-to-mic distance (m)");
    addText("Bounds = within wall area (Yes/No)");
    y += 2;
  }

  if (mergedPeaks.length > 0) {
    addText(`${mergedPeaks.length} peaks detected${reportHasFusion ? ' (merged from all IRs, duplicates removed)' : ''}.`);
    y += 2;

    const headers = peakTableHeaders(settings.mode, reportHasFusion);
    const rows = mergedPeaks.map((mp, i) => peakTableRow(mp, i, settings.mode, settings.speedOfSound, reportHasFusion));

    const confColIdx = isGeo ? (reportHasFusion ? 10 : 9) : -1;
    const sevColIdx = isGeo
      ? (reportHasFusion ? 6 : 5)
      : (reportHasFusion ? 5 : 4);
    autoTable(doc, {
      startY: y,
      head: [headers],
      body: rows,
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [80, 80, 80], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      margin: { left: 14, right: 14 },
      didParseCell: (data: any) => {
        if (data.section === 'body' && data.column.index === confColIdx && isGeo) {
          const cellText = String(data.cell.raw || '');
          if (cellText !== '-') {
            const confVal = parseFloat(cellText) / 100;
            if (confVal >= 0.8) {
              data.cell.styles.textColor = [22, 163, 74];
              data.cell.styles.fontStyle = 'bold';
            } else if (confVal >= 0.5) {
              data.cell.styles.textColor = [202, 138, 4];
              data.cell.styles.fontStyle = 'bold';
            } else {
              data.cell.styles.textColor = [220, 38, 38];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        }
        if (data.section === 'body' && data.column.index === sevColIdx) {
          const sevVal = parseFloat(String(data.cell.raw || ''));
          if (!isNaN(sevVal)) {
            if (sevVal >= -5) {
              data.cell.styles.textColor = [220, 38, 38];
              data.cell.styles.fontStyle = 'bold';
            } else if (sevVal >= -15) {
              data.cell.styles.textColor = [234, 88, 12];
              data.cell.styles.fontStyle = 'bold';
            }
          }
        }
      },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
    y += 2;
    addItalicText("Level(dB) is ETC energy level at the peak time, normalized so direct arrival ≈ 0 dB.");
    addItalicText("Delays are measured relative to the direct arrival.");
  } else {
    addText("No peaks detected.");
  }
  secNum++;

  const pdfMergedSurfaceSummaries = isGeo
    ? computeSurfaceSummariesFromMerged(mergedPeaks)
    : surfaceSummaries;
  if (isGeo && pdfMergedSurfaceSummaries.length > 0) {
    newPage();
    addHeading(`${secNum}. Results By Surface`);
    addItalicText("Aggregated reflection data per surface. Severity values are negative; least negative = most problematic. Surfaces with more peaks and less negative worst severity are typically highest priority for treatment.");

    const surfHeaders = ['Surface', 'Peaks', 'Worst Severity', 'Earliest (ms)', 'Total Severity'];
    const surfRows = pdfMergedSurfaceSummaries.map(s => surfaceTableRow(s));

    autoTable(doc, {
      startY: y,
      head: [surfHeaders],
      body: surfRows,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [80, 80, 80], textColor: [255, 255, 255], fontStyle: "bold" },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      margin: { left: 14, right: 14 },
    });
    y = (doc as any).lastAutoTable.finalY + 8;
    secNum++;
  }

  const pdfScorecardPeaks = mergedPeaks.map(m => m.peak);
  if (irData && pdfScorecardPeaks.length > 0) {
    newPage();
    const scorecard = computeScorecard(pdfScorecardPeaks, 'Mix');
    addHeading(`${secNum}. Quality Gates Scorecard`);
    addItalicText("Compact quality indicators: ITDG, RFZ compliance, critical early reflections, peak counts, and worst offenders.");
    if (images.scorecardImage) {
      y += 4;
      addImageToPage(images.scorecardImage, 'scorecardImage');
    } else {
      y += 2;
      addField("Preset: ", scorecard.preset);
      addField("ITDG: ", `${scorecard.itdg.value_ms === Infinity ? 'N/A' : scorecard.itdg.value_ms.toFixed(1) + ' ms'} - ${scorecard.itdg.verdict}`);
      addField("RFZ (0-20 ms): PASS < -15 dB, WARN -15 to -10 dB, FAIL >= -10 dB: ", scorecard.rfz.verdict);
      addField("Critical Early (0-10 ms): PASS < -12 dB, WARN -12 to -6 dB, FAIL >= -6 dB: ", scorecard.criticalEarly.verdict);
      addField("Peaks 0-10 ms: ", String(scorecard.timeBins.bin_0_10));
      addField("Peaks 10-20 ms: ", String(scorecard.timeBins.bin_10_20));
      addField("Peaks 20-50 ms: ", String(scorecard.timeBins.bin_20_50));
      y += 3;
      addText("Top 3 Worst Offenders:");
      const woHeaders = ['Delay (ms)', 'Level (dB)', 'Surface', 'Confidence', 'Severity'];
      const woRows = scorecard.worstOffenders.map(wo => [
        wo.delay_ms.toFixed(1), wo.rel_dB.toFixed(1), sanitizeArrow(wo.assignedSurface),
        wo.assignedSurface === 'Unassigned' ? '-' : `${(wo.confidence * 100).toFixed(0)}%`,
        wo.severity.toFixed(1)
      ]);
      autoTable(doc, {
        startY: y,
        head: [woHeaders], body: woRows,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [80, 80, 80], textColor: [255, 255, 255], fontStyle: "bold" },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
    }
    y += 2;
    addItalicText(`Scorecard computed from ${mergedPeaks.length} detected peaks (same as Peak Table).`);
    secNum++;
  }

  if (irData) {
    const directIdx = findDirectArrival(irData);

    newPage();
    const decayMetrics = computeDecayMetrics(irData, directIdx);
    addHeading(`${secNum}. Decay Metrics (Schroeder)`);
    addItalicText("Reverberation time estimates from the Schroeder backward-integrated energy decay curve.");
    y += 2;

    if (analysisMode !== 'SINGLE_IR' && data.fusionDatasets && data.fusionDatasets.length > 0) {
      const fusionDecayPdf = data.fusionDatasets.map(ds => {
        const dIdx = findDirectArrival(ds.irData);
        return { label: ds.label, metrics: computeDecayMetrics(ds.irData, dIdx) };
      });
      const avgFnPdf = (vals: (number | null)[]) => {
        const valid = vals.filter((v): v is number => v !== null);
        return valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
      };
      const aEdt = avgFnPdf(fusionDecayPdf.map(f => f.metrics.edt));
      const aT20 = avgFnPdf(fusionDecayPdf.map(f => f.metrics.t20));
      const aT30 = avgFnPdf(fusionDecayPdf.map(f => f.metrics.t30));
      const aRt60 = avgFnPdf(fusionDecayPdf.map(f => f.metrics.rt60));
      addField("Fused Average EDT: ", aEdt !== null ? `${aEdt.toFixed(3)} s` : 'N/A');
      addField("Fused Average T20: ", aT20 !== null ? `${aT20.toFixed(3)} s` : 'N/A');
      addField("Fused Average T30: ", aT30 !== null ? `${aT30.toFixed(3)} s` : 'N/A');
      addField("Fused Average RT60: ", aRt60 !== null ? `${aRt60.toFixed(3)} s` : 'N/A');
      y += 2;
      addText("Per-IR Breakdown:");
      for (const fd of fusionDecayPdf) {
        const m = fd.metrics;
        addText(`${fd.label}: EDT=${m.edt !== null ? m.edt.toFixed(3) : 'N/A'} s, T20=${m.t20 !== null ? m.t20.toFixed(3) : 'N/A'} s, T30=${m.t30 !== null ? m.t30.toFixed(3) : 'N/A'} s, RT60=${m.rt60 !== null ? m.rt60.toFixed(3) : 'N/A'} s`);
      }
    } else {
      addField("EDT: ", decayMetrics.edt !== null ? `${decayMetrics.edt.toFixed(3)} s` : 'N/A');
      addField("T20: ", decayMetrics.t20 !== null ? `${decayMetrics.t20.toFixed(3)} s` : 'N/A');
      addField("T30: ", decayMetrics.t30 !== null ? `${decayMetrics.t30.toFixed(3)} s` : 'N/A');
      addField("RT60 (est.): ", decayMetrics.rt60 !== null ? `${decayMetrics.rt60.toFixed(3)} s` : 'N/A');
    }
    y += 2;
    addText(decayMetrics.slopeInterpretation);
    if (images.decayChart) { y += 4; addImageToPage(images.decayChart, 'decayChart'); }
    secNum++;

    newPage();
    const clarity = computeClarityMetrics(irData, directIdx);
    addHeading(`${secNum}. Clarity & Definition`);
    addItalicText("Energy-based metrics for speech intelligibility and musical clarity.");
    if (images.clarityImage) {
      y += 4;
      addImageToPage(images.clarityImage, 'clarityImage');
    } else {
      y += 2;
      const clHeaders = ['Metric', 'Value', 'Description'];
      const clRows = [
        ['C50', clarity.c50 !== null ? `${clarity.c50.toFixed(2)} dB` : 'N/A', 'Speech clarity (50 ms)'],
        ['D50', clarity.d50 !== null ? `${clarity.d50.toFixed(1)} %` : 'N/A', 'Speech definition'],
        ['C80', clarity.c80 !== null ? `${clarity.c80.toFixed(2)} dB` : 'N/A', 'Musical clarity (80 ms)'],
        ['Ts', clarity.ts_ms !== null ? `${clarity.ts_ms.toFixed(1)} ms` : 'N/A', 'Centre time'],
      ];
      autoTable(doc, {
        startY: y,
        head: [clHeaders], body: clRows,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [80, 80, 80], textColor: [255, 255, 255], fontStyle: "bold" },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 5;
      addText(clarity.interpretation);
    }
    secNum++;

    const combSigs = computeCombSignatures(matchedPeaks, 5);
    if (combSigs.length > 0) {
      newPage();
      addHeading(`${secNum}. Frequency Response & Comb Impact`);
      addItalicText("Comb filter signatures of top reflections.");
      if (images.frequencyChart) { y += 4; addImageToPage(images.frequencyChart, 'frequencyChart'); }
      y += 2;
      const combHeaders = ['Delay (ms)', 'Level (dB)', 'Surface', 'Comb (Hz)', 'Notches (Hz)'];
      const combRows = combSigs.map(s => [
        s.delay_ms.toFixed(2), s.rel_dB.toFixed(1), sanitizeArrow(s.surface),
        String(s.combSpacing_Hz), s.notchFrequencies.slice(0, 5).join(', ')
      ]);
      autoTable(doc, {
        startY: y,
        head: [combHeaders], body: combRows,
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [80, 80, 80], textColor: [255, 255, 255], fontStyle: "bold" },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 8;
      secNum++;
    }
  }

  const canonicalPeaksForUnassigned = mergedPeaks.map(m => m.peak);
  if (isGeo && irData && data.surfaceWeights) {
    const unassignedDiags = analyzeUnassignedPeaks(
      canonicalPeaksForUnassigned, room, speakers[0].position, micPosition, settings.speedOfSound,
      data.surfaceWeights, surfaceMaterials, settings.peakMatchTolerance, data.ceiling, data.roomObjects
    );
    if (unassignedDiags.length > 0) {
      newPage();
      addHeading(`${secNum}. Unassigned Peaks Analysis`);
      addItalicText("Diagnostics for peaks that could not be matched to 1st-order specular reflections. Each peak is classified and the top 3 closest surface candidates are listed with rejection reasons.");
      y += 2;
      for (const diag of unassignedDiags) {
        if (y > pageHeight - 50) newPage();
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text(`Peak @ ${diag.peak.peak.delay_ms.toFixed(2)} ms`, 14, y);
        doc.setFont("helvetica", "normal");
        doc.text(`${diag.peak.peak.rel_dB.toFixed(1)} dB  |  severity: ${diag.peak.peak.severity.toFixed(1)}  |  ${diag.classification}`, 14 + doc.getTextWidth(`Peak @ ${diag.peak.peak.delay_ms.toFixed(2)} ms`) + 3, y);
        y += 5;
        doc.setFontSize(8);
        doc.setFont("helvetica", "italic");
        doc.setTextColor(100, 100, 100);
        const reasonLines = doc.splitTextToSize(diag.classificationReason, pageWidth - 28);
        doc.text(reasonLines, 14, y);
        y += reasonLines.length * 3.5 + 1;
        doc.setTextColor(0, 0, 0);
        if (diag.topCandidates.length > 0) {
          const candHeaders = ['Candidate Surface', 'Pred Delay (ms)', 'Time Error (ms)', 'BoundsPass', 'uInSegment', 'Accepted', 'Reject Reason'];
          const candRows = diag.topCandidates.map(c => {
            return [
              sanitizeArrow(c.surfaceLabel), c.predictedDelay_ms.toFixed(2), c.timeError_ms.toFixed(3),
              c.boundsPass ? 'Y' : 'N', c.uInSegment ? 'Y' : 'N',
              c.accepted ? 'Y' : 'N', c.rejectReason
            ];
          });
          autoTable(doc, {
            startY: y,
            head: [candHeaders],
            body: candRows,
            styles: { fontSize: 7, cellPadding: 1.5 },
            headStyles: { fillColor: [80, 80, 80], textColor: [255, 255, 255], fontStyle: "bold" },
            alternateRowStyles: { fillColor: [245, 245, 245] },
            margin: { left: 14, right: 14 },
          });
          y = (doc as any).lastAutoTable.finalY + 6;
        }
        y += 2;
      }
      secNum++;
    }

    const pdfFusionHeatmapPeaks = data.fusionOverlayPeaks && data.fusionOverlayPeaks.length > 0
      ? [...matchedPeaks, ...data.fusionOverlayPeaks.filter(fp => {
          const key = `${(fp.peak.delay_ms ?? 0).toFixed(3)}_${fp.reflection?.surfaceLabel || ''}`;
          return !matchedPeaks.some(mp => `${(mp.peak.delay_ms ?? 0).toFixed(3)}_${mp.reflection?.surfaceLabel || ''}` === key);
        })]
      : matchedPeaks;

    const heatmaps = computeSurfaceHeatmaps(matchedPeaks, room, settings.speedOfSound, settings.peakMatchTolerance);
    const hmWithData = heatmaps.filter(h => h.reflectionPoints.length > 0);
    if (hmWithData.length > 0) {
      newPage();
      addHeading(`${secNum}. Treatment Target Heatmaps`);
      addItalicText("Per-surface criticality heatmaps showing where treatment is most needed.");
      if (images.heatmapGrid) { y += 4; addImageToPage(images.heatmapGrid, 'heatmapGrid'); }
      y += 2;
      const pdfSupportHeatmaps = analysisMode !== 'SINGLE_IR' && data.fusionOverlayPeaks
        ? computeSurfaceHeatmaps(pdfFusionHeatmapPeaks, room, settings.speedOfSound, settings.peakMatchTolerance)
        : null;
      for (const hm of hmWithData) {
        const assignedCnt = hm.reflectionPoints.length;
        const supportCnt = pdfSupportHeatmaps
          ? (pdfSupportHeatmaps.find(sh => sh.surfaceLabel === hm.surfaceLabel)?.reflectionPoints.length ?? assignedCnt)
          : assignedCnt;
        addField(`${hm.surfaceLabel}: `, `Assigned reflections: ${assignedCnt}, Support points: ${supportCnt}, Hotspots: ${hm.hotspots.length}`);
        for (const hs of hm.hotspots) {
          addText(`  Hotspot: (${hs.x.toFixed(2)}, ${hs.y.toFixed(2)}, ${hs.z.toFixed(2)}) — intensity: ${(hs.value * 100).toFixed(0)}%`);
        }
      }
      secNum++;
    }

    if (images.criticalZoneGrid) {
      newPage();
      addHeading(`${secNum}. Critical Zones`);
      addItalicText("Critical zone visualization highlighting areas requiring the most urgent treatment. Red = most critical, Yellow = moderate, Green = low priority.");
      y += 4;
      addImageToPage(images.criticalZoneGrid, 'criticalZoneGrid');
      secNum++;
    }

    if (images.modalImage) {
      newPage();
      addHeading(`${secNum}. Room Modal Analysis — Room Modes`);
      addItalicText("Room eigenmode analysis: predicted modes and their correspondence with peaks extracted from the IR.");
      y += 4;
      addImageToPage(images.modalImage, 'modalImage');
      y += 2;
      addText("The modal analysis identifies room resonant frequencies from dimensions and matches them against measured IR peaks.");
      secNum++;
    }

    if (images.modalFreqResponseImage) {
      newPage();
      addHeading(`${secNum}. Room Modal Analysis — Frequency Response`);
      addItalicText("Driven room response at the microphone position showing how combined room modes shape the low-frequency response.");
      y += 4;
      addImageToPage(images.modalFreqResponseImage, 'modalFreqResponseImage');
      y += 2;
      addText("Green dashed lines mark matched modes; gray lines mark predicted but unmatched modes.");
      secNum++;
    }

    if (images.modalMapsImage) {
      newPage();
      addHeading(`${secNum}. Room Modal Analysis — Pressure Maps (Selected Mode)`);
      addItalicText("Pressure distribution maps at the selected mode frequency. Top view (XY at ear height) and side view (XZ at centerline).");
      y += 4;
      addImageToPage(images.modalMapsImage, 'modalMapsImage');
      y += 2;
      addText("Blue = cancellation (null), Green = neutral, Red = resonance (high pressure). Speaker and microphone positions are marked.");
      secNum++;
    }

    if (images.modalCriticalMapsImage) {
      newPage();
      addHeading(`${secNum}. Room Modal Analysis — Critical Mode Pressure Maps`);
      addItalicText("Pressure distribution at the strongest matched room modes.");
      y += 4;
      addImageToPage(images.modalCriticalMapsImage, 'modalCriticalMapsImage');
      y += 2;
      addText("These maps show spatial pressure distribution for the most energetic room modes, essential for targeted bass trap placement and listening position optimization.");
      secNum++;
    }

    if (images.modalGlobalImage) {
      newPage();
      addHeading(`${secNum}. Room Modal Analysis — Global Pressure Map`);
      addItalicText("Broadband average of all modes. Top 5 seat candidates marked with stars (★).");
      y += 4;
      addImageToPage(images.modalGlobalImage, 'modalGlobalImage');
      y += 2;
      addText("The global pressure map shows the combined effect of all room modes. Stars indicate top 5 candidate listening positions; #1 (gold) is optimal.");
      secNum++;
    }

    if (images.modalSeatImage) {
      newPage();
      addHeading(`${secNum}. Room Modal Analysis — Seat Optimizer`);
      addItalicText("Ranked listening position candidates and frequency response comparison between mic position and optimal seat.");
      y += 4;
      addImageToPage(images.modalSeatImage, 'modalSeatImage');
      y += 2;
      addText("The optimizer evaluates positions using Jvar (variance), Jnull (null penalty), Jpeak (resonance penalty), and Jsym (symmetry). Lower total score is better.");
      secNum++;
    }

    newPage();
    addHeading(`${secNum}. Multi-Measurement Fusion (Dual IR & 4-IR)`);

    if (data.dualIRResult) {
      const dr = data.dualIRResult;
      addItalicText("Dual IR fusion compares two speaker positions to one microphone, highlighting stereo consistency and asymmetric reflections.");
      y += 2;
      addField("Stereo Consistency: ", `${dr.stereoConsistencyPercent.toFixed(1)}%`);
      y += 4;

      addSubHeading(`${secNum}.1 Fused Surface Ranking`);
      addText("Surfaces ranked by combined severity from both speakers.");
      const fusedSorted = [...dr.fusedSurfaces].sort((a, b) => b.combinedSeverity - a.combinedSeverity);
      autoTable(doc, {
        startY: y,
        head: [["Surface", "L Peaks", "R Peaks", "Stereo", "Cost", "Severity"]],
        body: fusedSorted.map(s => [
          s.surfaceLabel,
          s.leftPeaks.length.toString(),
          s.rightPeaks.length.toString(),
          s.stereoConfirmed ? "Yes" : "No",
          s.fusedCost.toFixed(2),
          s.combinedSeverity.toFixed(1) + " dB",
        ]),
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [80, 80, 80] },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 6;

      if (dr.asymmetricPeaks.length > 0) {
        if (y > pageHeight - 60) { newPage(); }
        addSubHeading(`${secNum}.2 Asymmetric Peaks`);
        addText("Peaks appearing in only one speaker's measurement.");
        autoTable(doc, {
          startY: y,
          head: [["Surface", "Source", "Delay", "Level", "Reason"]],
          body: dr.asymmetricPeaks.map(ap => [
            ap.peak.surface || "Unassigned",
            ap.source,
            `${ap.peak.delayMs.toFixed(2)} ms`,
            `${ap.peak.relativeDb.toFixed(1)} dB`,
            ap.reason,
          ]),
          styles: { fontSize: 7, cellPadding: 1.5 },
          headStyles: { fillColor: [80, 80, 80] },
          margin: { left: 14, right: 14 },
        });
        y = (doc as any).lastAutoTable.finalY + 6;
      }
    } else if (data.fourIRResult) {
      const fr = data.fourIRResult;
      addItalicText("4-IR fusion compares two speakers x two microphone positions for cross-position consistency analysis.");
      y += 4;

      addSubHeading(`${secNum}.1 Multi-View Surface Results`);
      addText("Each surface analyzed across all 4 measurement paths.");
      const srSorted = [...fr.surfaceResults].sort((a, b) => {
        const aMax = a.hotspots.length > 0 ? Math.max(...a.hotspots.map(h => h.supportCount)) : 0;
        const bMax = b.hotspots.length > 0 ? Math.max(...b.hotspots.map(h => h.supportCount)) : 0;
        return bMax - aMax;
      });
      autoTable(doc, {
        startY: y,
        head: [["Surface", "Peaks", "Hotspots", "Max Support", "Disagreements"]],
        body: srSorted.map(sr => [
          sr.surfaceLabel,
          sr.totalPeakCount.toString(),
          sr.hotspots.length.toString(),
          sr.hotspots.length > 0 ? Math.max(...sr.hotspots.map(h => h.supportCount)).toString() + "/4" : "0/4",
          sr.disagreements.length > 0 ? sr.disagreements.join("; ") : "None",
        ]),
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [80, 80, 80] },
        margin: { left: 14, right: 14 },
      });
      y = (doc as any).lastAutoTable.finalY + 6;

      const allHotspots = fr.surfaceResults.flatMap(sr => sr.hotspots).filter(h => h.supportCount >= 2);
      if (allHotspots.length > 0) {
        if (y > pageHeight - 60) { newPage(); }
        addSubHeading(`${secNum}.2 3D-Supported Hotspots`);
        addText("Reflection hotspots confirmed by 2+ measurement paths.");
        const hsSorted = [...allHotspots].sort((a, b) => b.supportCount - a.supportCount || b.confidence - a.confidence).slice(0, 30);
        autoTable(doc, {
          startY: y,
          head: [["Surface", "Position (m)", "Support", "IRs", "Time Err", "Level", "Conf"]],
          body: hsSorted.map(h => [
            h.surfaceLabel,
            `(${h.avgX.toFixed(2)}, ${h.avgY.toFixed(2)}, ${h.avgZ.toFixed(2)})`,
            `${h.supportCount}/4`,
            h.supportingIRs.join(", "),
            `${h.avgTimeError.toFixed(2)} ms`,
            `${h.avgRelDb.toFixed(1)} dB`,
            `${(h.confidence * 100).toFixed(0)}%`,
          ]),
          styles: { fontSize: 6, cellPadding: 1.5 },
          headStyles: { fillColor: [80, 80, 80] },
          margin: { left: 14, right: 14 },
        });
        y = (doc as any).lastAutoTable.finalY + 6;
      }
    } else {
      addItalicText("Multi-measurement fusion analysis requires additional IR measurements from different speaker/microphone positions.");
      y += 2;
      addField("Dual IR Fusion: ", "Compares two speakers to one mic for stereo placement decisions.");
      addField("4-IR Fusion: ", "Compares two speakers x two mic positions for comprehensive room analysis.");
      addText("To include detailed fusion results, run the analysis from the interactive tabs.");
    }

    secNum++;
  }

  if (y > pageHeight - 60) { newPage(); }
  y += 4;
  addHeading(`${secNum}. Methodology Notes`);
  addItalicText("General approach and principles behind the analysis.");
  if (!isGeo) {
    addText("This analysis examines the impulse response (IR) of the room to identify early reflections. The IR is converted into an Energy Time Curve (ETC), which shows how acoustic energy decays over time. Peaks in the ETC correspond to discrete reflections arriving at the measurement position.");
    addText("Each detected peak is characterized by its arrival time, energy level, and a severity rating. Earlier and louder reflections receive higher severity ratings, reflecting their greater perceptual impact on sound quality and imaging.");
    addText("Without room geometry, exact surface assignments are not possible. The equivalent distance is provided as an estimate of how far away the reflecting surface might be.");
  } else {
    addText("This analysis combines measured impulse response data with room geometry to identify and attribute early reflections to specific surfaces. The room is modeled as a rectangular enclosure with speaker and microphone positions specified within the space.");
    addText("For each surface, the system predicts expected arrival times based on geometric acoustics. A peak is assigned to a surface when its measured arrival time closely matches the prediction within the specified tolerance. Confidence scores indicate match quality.");
    addText("Unassigned peaks typically arise from furniture, equipment, or other objects not in the room model, as well as higher-order reflections. Severity ratings weight both reflection level and arrival time, highlighting the most perceptually significant reflections for treatment prioritization.");
  }

  doc.save("reflection-report.pdf");
}
