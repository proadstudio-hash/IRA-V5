import type { MatchedPeak, RoomDimensions, Point3D, SpeakerConfig, IRData, AnalysisSettings, CeilingConfig, RoomObject } from "@shared/schema";
import { getRoomSurfaces, getObjectSurfaces, computeAllReflections } from "./geometry";
import { matchPeaksToReflections, computeSurfaceSummaries } from "./matching";
import { findDirectArrival, detectPeaks } from "./dsp";

export interface FourIRInput {
  ir_S1_M1: IRData;
  ir_S2_M1: IRData;
  ir_S1_M2: IRData;
  ir_S2_M2: IRData;
  speaker1: SpeakerConfig;
  speaker2: SpeakerConfig;
  mic1: Point3D;
  mic2: Point3D;
  room: RoomDimensions;
  settings: AnalysisSettings;
  surfaceWeights: Record<string, number>;
  surfaceMaterials: Record<string, string>;
  ceiling?: CeilingConfig;
  roomObjects?: RoomObject[];
}

export interface IRMeasurement {
  label: string;
  speaker: SpeakerConfig;
  mic: Point3D;
  matchedPeaks: MatchedPeak[];
}

export interface MultiViewHotspot {
  surfaceLabel: string;
  avgX: number;
  avgY: number;
  avgZ: number;
  supportCount: number;
  supportingIRs: string[];
  avgTimeError: number;
  avgRelDb: number;
  confidence: number;
}

export interface SurfaceMultiViewResult {
  surfaceLabel: string;
  hotspots: MultiViewHotspot[];
  disagreements: string[];
  totalPeakCount: number;
}

export interface FourIRResult {
  measurements: IRMeasurement[];
  surfaceResults: SurfaceMultiViewResult[];
  overallSupportSummary: { surfaceLabel: string; maxSupport: number }[];
}

function runPipeline(
  irData: IRData,
  speaker: SpeakerConfig,
  mic: Point3D,
  room: RoomDimensions,
  settings: AnalysisSettings,
  surfaceWeights: Record<string, number>,
  surfaceMaterials: Record<string, string>,
  label: string,
  ceiling?: CeilingConfig,
  roomObjects?: RoomObject[]
): IRMeasurement {
  const directIdx = findDirectArrival(irData);
  const directLength = Math.sqrt(
    (speaker.position.x - mic.x) ** 2 +
    (speaker.position.y - mic.y) ** 2 +
    (speaker.position.z - mic.z) ** 2
  );

  const peaks = detectPeaks(
    irData, directIdx,
    settings.earlyWindowMs, settings.peakThresholdDb,
    settings.smoothingMs, settings.speedOfSound,
    settings.earlyStartMs, settings.minSepMs,
    settings.noiseFloorMarginDb, directLength
  );

  const roomSurfaces = getRoomSurfaces(room, surfaceWeights, surfaceMaterials, ceiling);
  const objectSurfaces = settings.enableObjects && roomObjects && roomObjects.length > 0
    ? getObjectSurfaces(roomObjects) : [];
  const surfaces = [...roomSurfaces, ...objectSurfaces];
  const reflections = computeAllReflections(
    speaker, mic, room, surfaces,
    settings.speedOfSound, settings.enableOrder2,
    settings.maxPredictedReflections, settings.strictBounds, ceiling
  );

  const matched = matchPeaksToReflections(
    peaks, reflections, settings.peakMatchTolerance, settings.strictBounds
  );

  return { label, speaker, mic, matchedPeaks: matched };
}

function clusterPoints(
  points: { x: number; y: number; z: number; irLabel: string; timeError: number; relDb: number }[],
  radius: number
): MultiViewHotspot[] {
  if (points.length === 0) return [];

  const used = new Set<number>();
  const clusters: MultiViewHotspot[] = [];

  const sorted = [...points].sort((a, b) => a.timeError - b.timeError);

  for (let i = 0; i < sorted.length; i++) {
    if (used.has(i)) continue;

    const cluster = [sorted[i]];
    used.add(i);

    for (let j = i + 1; j < sorted.length; j++) {
      if (used.has(j)) continue;
      const dx = sorted[i].x - sorted[j].x;
      const dy = sorted[i].y - sorted[j].y;
      const dz = sorted[i].z - sorted[j].z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist <= radius) {
        cluster.push(sorted[j]);
        used.add(j);
      }
    }

    const avgX = cluster.reduce((s, p) => s + p.x, 0) / cluster.length;
    const avgY = cluster.reduce((s, p) => s + p.y, 0) / cluster.length;
    const avgZ = cluster.reduce((s, p) => s + p.z, 0) / cluster.length;
    const avgTimeError = cluster.reduce((s, p) => s + p.timeError, 0) / cluster.length;
    const avgRelDb = cluster.reduce((s, p) => s + p.relDb, 0) / cluster.length;

    const supportingIRs = [...new Set(cluster.map(p => p.irLabel))];
    const confidence = supportingIRs.length / 4;

    clusters.push({
      surfaceLabel: '',
      avgX: Math.round(avgX * 1000) / 1000,
      avgY: Math.round(avgY * 1000) / 1000,
      avgZ: Math.round(avgZ * 1000) / 1000,
      supportCount: supportingIRs.length,
      supportingIRs,
      avgTimeError: Math.round(avgTimeError * 1000) / 1000,
      avgRelDb: Math.round(avgRelDb * 10) / 10,
      confidence,
    });
  }

  clusters.sort((a, b) => b.supportCount - a.supportCount || a.avgTimeError - b.avgTimeError);
  return clusters;
}

export function computeFourIRFusion(input: FourIRInput): FourIRResult {
  const measurements: IRMeasurement[] = [
    runPipeline(input.ir_S1_M1, input.speaker1, input.mic1, input.room, input.settings, input.surfaceWeights, input.surfaceMaterials, 'S1→M1', input.ceiling, input.roomObjects),
    runPipeline(input.ir_S2_M1, input.speaker2, input.mic1, input.room, input.settings, input.surfaceWeights, input.surfaceMaterials, 'S2→M1', input.ceiling, input.roomObjects),
    runPipeline(input.ir_S1_M2, input.speaker1, input.mic2, input.room, input.settings, input.surfaceWeights, input.surfaceMaterials, 'S1→M2', input.ceiling, input.roomObjects),
    runPipeline(input.ir_S2_M2, input.speaker2, input.mic2, input.room, input.settings, input.surfaceWeights, input.surfaceMaterials, 'S2→M2', input.ceiling, input.roomObjects),
  ];

  const allSurfaceLabels = new Set<string>();
  for (const m of measurements) {
    for (const mp of m.matchedPeaks) {
      if (mp.assigned && mp.reflection) {
        allSurfaceLabels.add(mp.reflection.surfaceLabel);
      }
    }
  }

  const clusterRadius = (input.settings.peakMatchTolerance / 1000) * input.settings.speedOfSound;

  const surfaceResults: SurfaceMultiViewResult[] = [];

  for (const surfaceLabel of allSurfaceLabels) {
    const points: { x: number; y: number; z: number; irLabel: string; timeError: number; relDb: number }[] = [];

    for (const m of measurements) {
      for (const mp of m.matchedPeaks) {
        if (mp.assigned && mp.reflection && mp.reflection.surfaceLabel === surfaceLabel) {
          points.push({
            x: mp.reflection.reflectionPoint.x,
            y: mp.reflection.reflectionPoint.y,
            z: mp.reflection.reflectionPoint.z,
            irLabel: m.label,
            timeError: mp.timeError,
            relDb: mp.peak.rel_dB,
          });
        }
      }
    }

    const hotspots = clusterPoints(points, clusterRadius);
    hotspots.forEach(h => h.surfaceLabel = surfaceLabel);

    const disagreements: string[] = [];
    const irsSeen = new Set(points.map(p => p.irLabel));
    const allIRs = ['S1→M1', 'S2→M1', 'S1→M2', 'S2→M2'];
    const missing = allIRs.filter(ir => !irsSeen.has(ir));
    if (missing.length > 0 && irsSeen.size > 0) {
      disagreements.push(`Not detected in: ${missing.join(', ')}`);
    }

    surfaceResults.push({
      surfaceLabel,
      hotspots,
      disagreements,
      totalPeakCount: points.length,
    });
  }

  surfaceResults.sort((a, b) => {
    const maxA = a.hotspots.length > 0 ? a.hotspots[0].supportCount : 0;
    const maxB = b.hotspots.length > 0 ? b.hotspots[0].supportCount : 0;
    return maxB - maxA;
  });

  const overallSupportSummary = surfaceResults.map(sr => ({
    surfaceLabel: sr.surfaceLabel,
    maxSupport: sr.hotspots.length > 0 ? sr.hotspots[0].supportCount : 0,
  }));

  return {
    measurements,
    surfaceResults,
    overallSupportSummary,
  };
}
