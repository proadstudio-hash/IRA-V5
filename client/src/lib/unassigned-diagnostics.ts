import type { MatchedPeak, PredictedReflection, RoomDimensions, Point3D, Surface, CeilingConfig, RoomObject } from "@shared/schema";
import { reflectPoint, distance, getRoomSurfaces, getObjectSurfaces } from "./geometry";

export type UnassignedClassification =
  | 'likely desk/console/near object'
  | 'likely local object near one speaker'
  | 'likely diffraction'
  | 'likely higher-order reflection'
  | 'likely noise'
  | 'unknown';

export interface SurfaceCandidate {
  surfaceLabel: string;
  predictedDelay_ms: number;
  timeError_ms: number;
  boundsPass: boolean;
  boundsFailReason: string;
  uInSegment: boolean;
  accepted: boolean;
  rejectReason: string;
}

export interface UnassignedPeakDiagnostic {
  peak: MatchedPeak;
  topCandidates: SurfaceCandidate[];
  classification: UnassignedClassification;
  classificationReason: string;
}

function checkBoundsDetailed(
  refPoint: Point3D,
  surfaceLabel: string,
  room: RoomDimensions
): { pass: boolean; reason: string } {
  const reasons: string[] = [];

  switch (surfaceLabel) {
    case 'Front Wall':
    case 'Rear Wall':
      if (refPoint.y < 0) reasons.push(`y=${refPoint.y.toFixed(2)} < 0`);
      if (refPoint.y > room.width) reasons.push(`y=${refPoint.y.toFixed(2)} > width=${room.width}`);
      if (refPoint.z < 0) reasons.push(`z=${refPoint.z.toFixed(2)} < 0`);
      if (refPoint.z > room.height) reasons.push(`z=${refPoint.z.toFixed(2)} > height=${room.height}`);
      break;
    case 'Left Wall':
    case 'Right Wall':
      if (refPoint.x < 0) reasons.push(`x=${refPoint.x.toFixed(2)} < 0`);
      if (refPoint.x > room.length) reasons.push(`x=${refPoint.x.toFixed(2)} > length=${room.length}`);
      if (refPoint.z < 0) reasons.push(`z=${refPoint.z.toFixed(2)} < 0`);
      if (refPoint.z > room.height) reasons.push(`z=${refPoint.z.toFixed(2)} > height=${room.height}`);
      break;
    case 'Floor':
    case 'Ceiling':
      if (refPoint.x < 0) reasons.push(`x=${refPoint.x.toFixed(2)} < 0`);
      if (refPoint.x > room.length) reasons.push(`x=${refPoint.x.toFixed(2)} > length=${room.length}`);
      if (refPoint.y < 0) reasons.push(`y=${refPoint.y.toFixed(2)} < 0`);
      if (refPoint.y > room.width) reasons.push(`y=${refPoint.y.toFixed(2)} > width=${room.width}`);
      break;
  }

  return {
    pass: reasons.length === 0,
    reason: reasons.length > 0 ? reasons.join('; ') : 'OK',
  };
}

function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Point3D, b: Point3D): Point3D {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(p: Point3D, s: number): Point3D {
  return { x: p.x * s, y: p.y * s, z: p.z * s };
}

function computeRefPointForSurface(
  speaker: Point3D,
  mic: Point3D,
  surface: Surface,
  speedOfSound: number
): SurfaceCandidate | null {
  const imageSource = reflectPoint(speaker, surface.point, surface.normal);
  const pathLength = distance(imageSource, mic);
  const directLength = distance(speaker, mic);
  const delay_ms = ((pathLength - directLength) / speedOfSound) * 1000;

  if (delay_ms < 0) return null;

  const denom = dot(surface.normal, sub(mic, imageSource));
  if (Math.abs(denom) < 1e-10) return null;

  const u = dot(surface.normal, sub(surface.point, imageSource)) / denom;
  const refPoint = add(imageSource, scale(sub(mic, imageSource), u));

  return {
    surfaceLabel: surface.label,
    predictedDelay_ms: delay_ms,
    timeError_ms: 0,
    boundsPass: false,
    boundsFailReason: '',
    uInSegment: u >= 0 && u <= 1,
    accepted: false,
    rejectReason: '',
  };
}

function classifyUnassignedPeak(
  mp: MatchedPeak,
  allPeaks: MatchedPeak[],
  candidates: SurfaceCandidate[]
): { classification: UnassignedClassification; reason: string } {
  const delay = mp.peak.delay_ms;
  const relDb = mp.peak.rel_dB;

  if (relDb < -35 && mp.peak.severity < -40) {
    return {
      classification: 'likely noise',
      reason: `Weak peak (${relDb.toFixed(1)} dB) near detection threshold with low severity.`,
    };
  }

  if (delay >= 1 && delay <= 6 && relDb >= -20) {
    return {
      classification: 'likely desk/console/near object',
      reason: `Strong peak (${relDb.toFixed(1)} dB) at short delay (${delay.toFixed(1)} ms) — typical of desk/console bounce.`,
    };
  }

  if (delay >= 4 && delay <= 12) {
    const nearbyPeaks = allPeaks.filter(
      p => Math.abs(p.peak.delay_ms - delay) < 1 && p !== mp
    );
    if (nearbyPeaks.length === 0) {
      return {
        classification: 'likely local object near one speaker',
        reason: `Mid-delay peak (${delay.toFixed(1)} ms) without nearby peaks — may be a stand, screen, or rack near one speaker.`,
      };
    }
  }

  const clustered = allPeaks.filter(
    p => p !== mp && Math.abs(p.peak.delay_ms - delay) < 1.0
  );
  if (clustered.length >= 2) {
    return {
      classification: 'likely diffraction',
      reason: `${clustered.length + 1} peaks clustered within <1 ms — consistent with diffraction/edge effects.`,
    };
  }

  if (candidates.length > 0) {
    const closestError = Math.min(...candidates.map(c => c.timeError_ms));
    if (closestError < 3) {
      return {
        classification: 'likely higher-order reflection',
        reason: `Closest 1st-order surface match has ${closestError.toFixed(2)} ms error — peak may originate from a 2nd+ order path.`,
      };
    }
  }

  return {
    classification: 'unknown',
    reason: 'No clear classification pattern matched.',
  };
}

export function analyzeUnassignedPeaks(
  matchedPeaks: MatchedPeak[],
  room: RoomDimensions,
  speakerPos: Point3D,
  micPos: Point3D,
  speedOfSound: number,
  surfaceWeights: Record<string, number>,
  surfaceMaterials: Record<string, string>,
  toleranceMs: number = 1.0,
  ceiling?: CeilingConfig,
  roomObjects?: RoomObject[]
): UnassignedPeakDiagnostic[] {
  const unassigned = matchedPeaks.filter(mp => !mp.assigned);
  if (unassigned.length === 0) return [];

  const roomSurfaces = getRoomSurfaces(room, surfaceWeights, surfaceMaterials, ceiling);
  const objectSurfaces = roomObjects && roomObjects.length > 0
    ? getObjectSurfaces(roomObjects) : [];
  const surfaces = [...roomSurfaces, ...objectSurfaces];
  const results: UnassignedPeakDiagnostic[] = [];

  for (const mp of unassigned) {
    const candidates: SurfaceCandidate[] = [];

    for (const surface of surfaces) {
      const candidate = computeRefPointForSurface(speakerPos, micPos, surface, speedOfSound);
      if (!candidate) continue;

      candidate.timeError_ms = Math.abs(mp.peak.delay_ms - candidate.predictedDelay_ms);

      const imageSource = reflectPoint(speakerPos, surface.point, surface.normal);
      const denom = dot(surface.normal, sub(micPos, imageSource));
      if (Math.abs(denom) < 1e-10) continue;

      const u = dot(surface.normal, sub(surface.point, imageSource)) / denom;
      const refPoint = add(imageSource, scale(sub(micPos, imageSource), u));

      const boundsCheck = checkBoundsDetailed(refPoint, surface.label, room);
      candidate.boundsPass = boundsCheck.pass;
      candidate.boundsFailReason = boundsCheck.reason;

      const reasons: string[] = [];
      if (!candidate.boundsPass) reasons.push('bounds fail');
      if (!candidate.uInSegment) reasons.push('u outside [0,1]');
      if (candidate.timeError_ms > toleranceMs) reasons.push(`time error ${candidate.timeError_ms.toFixed(2)} ms > ${toleranceMs} ms tolerance`);
      candidate.accepted = reasons.length === 0;
      candidate.rejectReason = reasons.join('; ');

      candidates.push(candidate);
    }

    candidates.sort((a, b) => a.timeError_ms - b.timeError_ms);
    const topCandidates = candidates.slice(0, 3);

    const { classification, reason } = classifyUnassignedPeak(mp, matchedPeaks, topCandidates);

    results.push({
      peak: mp,
      topCandidates,
      classification,
      classificationReason: reason,
    });
  }

  return results;
}
