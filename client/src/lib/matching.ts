import type { Peak, PredictedReflection, MatchedPeak, SurfaceSummary } from "@shared/schema";

export function matchPeaksToReflections(
  peaks: Peak[],
  reflections: PredictedReflection[],
  toleranceMs: number = 0.35,
  strictBounds: boolean = true
): MatchedPeak[] {
  const results: MatchedPeak[] = [];

  for (const peak of peaks) {
    let bestRef: PredictedReflection | undefined;
    let bestTimeErr = Infinity;

    for (const ref of reflections) {
      const timeErr = Math.abs(peak.delay_ms - ref.delay_ms);

      if (timeErr > toleranceMs) continue;

      if (strictBounds && !ref.insideSurfaceBounds) continue;

      if (timeErr < bestTimeErr) {
        bestTimeErr = timeErr;
        bestRef = ref;
      }
    }

    if (bestRef) {
      const confidence = Math.max(0, Math.min(1, 1 - bestTimeErr / toleranceMs));

      results.push({
        peak,
        reflection: bestRef,
        confidence,
        timeError: bestTimeErr,
        assigned: true,
      });
    } else {
      results.push({
        peak,
        confidence: 0,
        timeError: 0,
        assigned: false,
      });
    }
  }

  results.sort((a, b) => a.peak.delay_ms - b.peak.delay_ms);
  return results;
}

export function computeSurfaceSummaries(matchedPeaks: MatchedPeak[]): SurfaceSummary[] {
  const surfaceMap = new Map<string, {
    peakCount: number;
    worstSeverity: number;
    earliestTime: number;
    totalSeverity: number;
  }>();

  for (const mp of matchedPeaks) {
    if (!mp.assigned || !mp.reflection) continue;

    const label = mp.reflection.surfaceLabel;
    const existing = surfaceMap.get(label);

    if (existing) {
      existing.peakCount++;
      existing.worstSeverity = Math.max(existing.worstSeverity, mp.peak.severity);
      existing.earliestTime = Math.min(existing.earliestTime, mp.peak.delay_ms);
      existing.totalSeverity += mp.peak.severity;
    } else {
      surfaceMap.set(label, {
        peakCount: 1,
        worstSeverity: mp.peak.severity,
        earliestTime: mp.peak.delay_ms,
        totalSeverity: mp.peak.severity,
      });
    }
  }

  return Array.from(surfaceMap.entries())
    .map(([label, data]) => ({
      surfaceLabel: label,
      ...data,
    }))
    .sort((a, b) => b.totalSeverity - a.totalSeverity);
}

export function exportPeaksCSV(matchedPeaks: MatchedPeak[], mode: 'ir-only' | 'geometry', speedOfSound: number): string {
  if (mode === 'ir-only') {
    const header = [
      'Rank', 'Delay (ms)', 'Rel Level (dB)', 'Severity',
      'ΔL (m)', 'L_refl_target (m)', 'Equiv Distance (m)'
    ].join(',');

    const rows = matchedPeaks.map((mp, i) => [
      i + 1,
      mp.peak.delay_ms.toFixed(3),
      mp.peak.rel_dB.toFixed(1),
      mp.peak.severity.toFixed(3),
      (mp.peak.extraPathLength ?? ((mp.peak.delay_ms / 1000) * speedOfSound)).toFixed(3),
      (mp.peak.targetReflectedLength ?? 0).toFixed(3),
      (mp.peak.equivalentDistance ?? 0).toFixed(3),
    ].join(','));

    return [header, ...rows].join('\n');
  }

  const header = [
    'Rank', 'Delay (ms)', 'Rel Level (dB)', 'ΔL (m)', 'L_refl_target (m)', 'Severity',
    'Surface', 'Order', 'Predicted Delay (ms)',
    'Time Error (ms)', 'Confidence',
    'Ref Point X', 'Ref Point Y', 'Ref Point Z',
    '|S-P*| (m)', '|P*-M| (m)',
    'insideSurfaceBounds', 'uInSegment'
  ].join(',');

  const rows = matchedPeaks.map((mp, i) => [
    i + 1,
    mp.peak.delay_ms.toFixed(3),
    mp.peak.rel_dB.toFixed(1),
    (mp.peak.extraPathLength ?? ((mp.peak.delay_ms / 1000) * speedOfSound)).toFixed(3),
    (mp.peak.targetReflectedLength ?? 0).toFixed(3),
    mp.peak.severity.toFixed(3),
    mp.assigned ? mp.reflection!.surfaceLabel : 'Unassigned (likely higher-order or object/furniture)',
    mp.assigned ? mp.reflection!.order : '',
    mp.assigned ? mp.reflection!.delay_ms.toFixed(3) : '',
    mp.assigned ? mp.timeError.toFixed(3) : '',
    mp.confidence.toFixed(3),
    mp.assigned ? mp.reflection!.reflectionPoint.x.toFixed(3) : '',
    mp.assigned ? mp.reflection!.reflectionPoint.y.toFixed(3) : '',
    mp.assigned ? mp.reflection!.reflectionPoint.z.toFixed(3) : '',
    mp.assigned ? mp.reflection!.speakerDistance.toFixed(3) : '',
    mp.assigned ? mp.reflection!.micDistance.toFixed(3) : '',
    mp.assigned ? mp.reflection!.insideSurfaceBounds : '',
    mp.assigned ? mp.reflection!.uInSegment : '',
  ].join(','));

  return [header, ...rows].join('\n');
}

export function exportSurfacesCSV(summaries: SurfaceSummary[]): string {
  const header = ['Surface', 'Peak Count', 'Worst Severity', 'Earliest Time (ms)', 'Total Severity'].join(',');
  const rows = summaries.map(s => [
    s.surfaceLabel,
    s.peakCount,
    s.worstSeverity.toFixed(3),
    s.earliestTime.toFixed(3),
    s.totalSeverity.toFixed(3),
  ].join(','));

  return [header, ...rows].join('\n');
}
