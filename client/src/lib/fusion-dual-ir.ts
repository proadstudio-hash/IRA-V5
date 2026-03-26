import type { MatchedPeak, RoomDimensions, Point3D, SpeakerConfig, PredictedReflection, Surface, Peak, IRData, AnalysisSettings, CeilingConfig, RoomObject } from "@shared/schema";
import { getRoomSurfaces, getObjectSurfaces, computeAllReflections } from "./geometry";
import { matchPeaksToReflections, computeSurfaceSummaries } from "./matching";
import { findDirectArrival, detectPeaks } from "./dsp";

export interface DualIRInput {
  irLeft: IRData;
  irRight: IRData;
  speakerLeft: SpeakerConfig;
  speakerRight: SpeakerConfig;
  mic: Point3D;
  room: RoomDimensions;
  settings: AnalysisSettings;
  surfaceWeights: Record<string, number>;
  surfaceMaterials: Record<string, string>;
  ceiling?: CeilingConfig;
  roomObjects?: RoomObject[];
}

export interface FusedSurfaceResult {
  surfaceLabel: string;
  leftPeaks: MatchedPeak[];
  rightPeaks: MatchedPeak[];
  stereoConfirmed: boolean;
  fusedCost: number;
  combinedSeverity: number;
}

export interface AsymmetricPeak {
  peak: MatchedPeak;
  source: 'Left' | 'Right';
  reason: string;
}

export interface DualIRResult {
  leftMatchedPeaks: MatchedPeak[];
  rightMatchedPeaks: MatchedPeak[];
  fusedSurfaces: FusedSurfaceResult[];
  asymmetricPeaks: AsymmetricPeak[];
  stereoConsistencyPercent: number;
  surfaceSummariesLeft: ReturnType<typeof computeSurfaceSummaries>;
  surfaceSummariesRight: ReturnType<typeof computeSurfaceSummaries>;
}

function runSingleIRPipeline(
  irData: IRData,
  speaker: SpeakerConfig,
  mic: Point3D,
  room: RoomDimensions,
  settings: AnalysisSettings,
  surfaceWeights: Record<string, number>,
  surfaceMaterials: Record<string, string>,
  ceiling?: CeilingConfig,
  roomObjects?: RoomObject[]
): { matchedPeaks: MatchedPeak[]; reflections: PredictedReflection[] } {
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

  return { matchedPeaks: matched, reflections };
}

export function computeDualIRFusion(input: DualIRInput): DualIRResult {
  const leftResult = runSingleIRPipeline(
    input.irLeft, input.speakerLeft, input.mic,
    input.room, input.settings, input.surfaceWeights, input.surfaceMaterials, input.ceiling, input.roomObjects
  );

  const rightResult = runSingleIRPipeline(
    input.irRight, input.speakerRight, input.mic,
    input.room, input.settings, input.surfaceWeights, input.surfaceMaterials, input.ceiling, input.roomObjects
  );

  const surfaceLabels = new Set<string>();
  for (const mp of [...leftResult.matchedPeaks, ...rightResult.matchedPeaks]) {
    if (mp.assigned && mp.reflection) {
      surfaceLabels.add(mp.reflection.surfaceLabel);
    }
  }

  const fusedSurfaces: FusedSurfaceResult[] = [];
  let stereoConfirmedCount = 0;

  for (const label of surfaceLabels) {
    const leftPeaks = leftResult.matchedPeaks.filter(
      mp => mp.assigned && mp.reflection?.surfaceLabel === label
    );
    const rightPeaks = rightResult.matchedPeaks.filter(
      mp => mp.assigned && mp.reflection?.surfaceLabel === label
    );

    const hasBoth = leftPeaks.length > 0 && rightPeaks.length > 0;

    let fusedCost = 0;
    if (hasBoth) {
      const avgLeftError = leftPeaks.reduce((s, p) => s + p.timeError, 0) / leftPeaks.length;
      const avgRightError = rightPeaks.reduce((s, p) => s + p.timeError, 0) / rightPeaks.length;
      fusedCost = avgLeftError + avgRightError;
      stereoConfirmedCount++;
    } else {
      fusedCost = 999;
    }

    const combinedSeverity =
      leftPeaks.reduce((s, p) => s + p.peak.severity, 0) +
      rightPeaks.reduce((s, p) => s + p.peak.severity, 0);

    fusedSurfaces.push({
      surfaceLabel: label,
      leftPeaks,
      rightPeaks,
      stereoConfirmed: hasBoth,
      fusedCost,
      combinedSeverity,
    });
  }

  fusedSurfaces.sort((a, b) => {
    if (a.stereoConfirmed !== b.stereoConfirmed) return a.stereoConfirmed ? -1 : 1;
    return b.combinedSeverity - a.combinedSeverity;
  });

  const asymmetricPeaks: AsymmetricPeak[] = [];

  for (const mp of leftResult.matchedPeaks) {
    if (!mp.assigned) continue;
    const surface = mp.reflection!.surfaceLabel;
    const hasRight = rightResult.matchedPeaks.some(
      rp => rp.assigned && rp.reflection?.surfaceLabel === surface
    );
    if (!hasRight && mp.peak.rel_dB >= -20) {
      asymmetricPeaks.push({
        peak: mp,
        source: 'Left',
        reason: `Peak at ${mp.peak.delay_ms.toFixed(1)} ms on ${surface} seen only from left speaker — possible local object.`,
      });
    }
  }

  for (const mp of rightResult.matchedPeaks) {
    if (!mp.assigned) continue;
    const surface = mp.reflection!.surfaceLabel;
    const hasLeft = leftResult.matchedPeaks.some(
      lp => lp.assigned && lp.reflection?.surfaceLabel === surface
    );
    if (!hasLeft && mp.peak.rel_dB >= -20) {
      asymmetricPeaks.push({
        peak: mp,
        source: 'Right',
        reason: `Peak at ${mp.peak.delay_ms.toFixed(1)} ms on ${surface} seen only from right speaker — possible local object.`,
      });
    }
  }

  const totalSurfaces = fusedSurfaces.length;
  const stereoConsistencyPercent = totalSurfaces > 0
    ? Math.round((stereoConfirmedCount / totalSurfaces) * 100)
    : 0;

  return {
    leftMatchedPeaks: leftResult.matchedPeaks,
    rightMatchedPeaks: rightResult.matchedPeaks,
    fusedSurfaces,
    asymmetricPeaks,
    stereoConsistencyPercent,
    surfaceSummariesLeft: computeSurfaceSummaries(leftResult.matchedPeaks),
    surfaceSummariesRight: computeSurfaceSummaries(rightResult.matchedPeaks),
  };
}
