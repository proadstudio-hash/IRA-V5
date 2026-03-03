# Reflection Analyzer - Acoustic IR Analysis Tool

## Overview
A web-based acoustic impulse response analyzer that detects early reflections from Room EQ Wizard (REW) files. Supports two modes:
- **IR-Only Mode**: Detect peaks, compute delay, path length difference (ΔL), and equivalent distance
- **Geometry Mode**: Uses image-source method to assign peaks to room surfaces, compute reflection points, and visualize ray paths

## Architecture
- **Frontend-only processing**: All DSP and geometry computations run client-side in the browser
- **No database needed**: This is a calculator/analysis tool, no persistent storage required
- **React + TypeScript + Vite + Express** stack

## Coordinate System
- Origin (0,0,0) at Front-Right-Floor corner
- X: front→rear (depth/length), Y: right→left (width), Z: floor→ceiling (height)
- Speaker faces the rear wall direction
- In top-down room view: Front Wall at top, Right Wall on right side of screen (Y=0), Left Wall on left side (Y=width)

## Project Structure
```
client/src/
  lib/
    dsp.ts                    - WAV/text file parsing, ETC computation, peak detection
    geometry.ts               - Image-source method, reflection computation, ray tracing
    matching.ts               - Peak-to-reflection matching, CSV export
    project.ts                - Project save/load as JSON
    report.ts                 - Word (.docx) and PDF report generation with all analysis sections
    capture.ts                - HTML element to image capture utility
    scorecard.ts              - Quality gates: ITDG, RFZ, critical early, time bins, worst offenders
    decay-metrics.ts          - Schroeder backward integration: EDT, T20, T30, RT60
    clarity-metrics.ts        - C50, C80, D50, Ts (centre time) energy-based metrics
    frequency-analysis.ts     - FFT magnitude, comb filter signatures per reflection
    unassigned-diagnostics.ts - Classify unassigned peaks with surface candidate analysis
    surface-heatmaps.ts       - Per-surface treatment target heatmaps with hotspot detection
    fusion-dual-ir.ts         - Dual IR fusion (2 speakers, 1 mic) comparison engine
    fusion-4ir.ts             - 4-IR fusion (2 speakers, 2 mics) cross-position analysis
  components/
    file-upload.tsx           - Drag-and-drop IR file upload
    geometry-panel.tsx        - Room dimensions, speaker/mic positions, surface properties
    etc-chart.tsx             - Energy Time Curve chart (recharts)
    room-view.tsx             - 2D SVG room visualization with reflection rays + surface view
    results-tables.tsx        - Peak-centric and surface-centric results tables
    theme-provider.tsx        - Dark/light mode toggle
    report-capture.tsx        - Off-screen rendering for report image capture
    scorecard-panel.tsx       - Quality gates scorecard UI panel
    decay-panel.tsx           - Decay metrics (Schroeder) UI panel
    clarity-panel.tsx         - Clarity & definition metrics UI panel
    frequency-panel.tsx       - Frequency response & comb filter UI panel
    unassigned-panel.tsx      - Unassigned peaks diagnostics UI panel
    heatmap-panel.tsx         - Surface treatment heatmap UI panel
    dual-ir-panel.tsx         - Dual IR fusion UI panel
    four-ir-panel.tsx         - 4-IR fusion UI panel
  pages/
    analyzer.tsx              - Main analyzer page orchestrating all components and tabs
shared/
  schema.ts                   - All TypeScript types and interfaces
server/
  routes.ts                   - Express API routes (minimal - app is frontend-focused)
```

## Analysis Tabs
1. **ETC** - Energy Time Curve visualization
2. **Room** - 2D room view with reflection rays (geometry mode only)
3. **Results** - Peak and surface results tables
4. **Scorecard** - Quality gates (ITDG, RFZ, critical early, time bins, worst offenders)
5. **Decay** - Schroeder backward integration (EDT, T20, T30, RT60)
6. **Clarity** - C50, C80, D50, Ts metrics
7. **Frequency** - FFT magnitude response and comb filter signatures
8. **Unassigned** - Diagnostics for unmatched peaks (geometry mode only)
9. **Heatmaps** - Per-surface treatment target heatmaps (geometry mode only)
10. **Dual IR** - 2-speaker/1-mic fusion comparison (geometry mode only); reuses main IR as Speaker 1
11. **4-IR** - 2-speaker/2-mic fusion analysis (geometry mode only); uses Mic 2 from geometry settings

## Report Generation
- Word (.docx) and PDF reports include all analysis sections with computed data
- Sections: Input Config, ETC, Room Views, Peak Results, Surface Results, Scorecard, Decay, Clarity, Frequency/Comb, Unassigned, Heatmaps, Multi-Measurement Fusion, Methodology Notes
- Images captured from off-screen rendered components for ETC, room views, tables
- Dynamic section numbering based on available data
- Report detects analysis mode at runtime: SINGLE_IR | DUAL_IR | FUSION_4IR (based on fusionDatasets count)
- Config page shows mode-specific IR file names, speaker/mic coordinates, and IR→position mappings
- ETC section title adapts: "Energy Time Curve – 4 IRs Overlaid" only in FUSION_4IR mode
- Scorecard ALWAYS uses matchedPeaks (same list as Peak Table); bins and offenders are consistent with Peak Table
- Decay metrics: shows fused average + per-IR breakdown when fusion datasets available
- Unassigned peaks table columns: Candidate Surface, Pred Delay, Time Error, BoundsPass, uInSegment, Accepted (Y/N), Reject Reason
- Unassigned reject reasons include: bounds fail, u outside [0,1], time error > tolerance (with values)
- ETC chart shows per-IR peak vertical lines with matching IR colors when multiple IRs analyzed (fusionPerIRPeaks)
- Results table merges peaks from ALL analyzed IRs with deduplication (0.5ms tolerance); adds IR Source column in fusion mode
- mergeAndDeduplicatePeaks() exported from results-tables.tsx for reuse in report-capture and report.ts
- Heatmap labels: "Assigned reflections: X, Support points: Y" distinguishing base vs fusion-combined counts
- Heatmap SVG uses Gaussian blur filter for smooth gradient appearance (no visible pixel grid)
- Report includes explanatory text: Level(dB) definition, delay reference, strict bounds, 2nd order, coordinate system
- Surface severity wording clarified: negative values, least negative = most problematic
- All report text uses ASCII-safe characters (-> instead of arrows, >= instead of ≥, dL instead of Δ, x instead of ×)

## Key Technologies
- Recharts for ETC and chart visualization
- SVG for 2D room view and heatmaps
- Shadcn UI components
- Tailwind CSS with dark mode
- docx and jsPDF for report generation
- html2canvas for element capture

## Running
- `npm run dev` starts the Express server with Vite dev server

## DSP Algorithm
- Direct arrival: max of abs(IR) within first 200ms
- ETC: E[i] = IR[i]^2, smoothed with moving average (prefix-sum), normalized to 0 dB at direct
- Noise floor: median of ETC_dB in last 20% of samples (or last 200ms, whichever smaller)
- Peak detection: local maxima in [t0+startMs, t0+endMs], enforces minSepMs gap
- Peak thresholds: relative-to-direct (default -25 dB) AND noise-floor (default +6 dB above floor)
- Severity: rel_dB - K*log10(1 + delay_ms), K=6

## Specular Geometry Algorithm
- Image source: S' = S - 2*(dot(n, S - P0))*n
- Reflection point: P* = S' + u*(M - S'), where u = dot(n, P0 - S') / dot(n, M - S')
- Predicted delay: Δt_pred = (||S'-M|| - ||S-M||) / c
- Bounds checks: strict (no tolerance) for rectangular room surfaces
- Fields: insideSurfaceBounds (boolean), uInSegment (u in [0,1])

## Matching Algorithm
- Per-peak best match by minimal time error (not greedy assignment)
- Match requires: insideSurfaceBounds=true (when strict mode ON), |Δt_pred - Δt_meas| <= τ_ms
- Confidence = clamp(1 - timeError/τ_ms, 0..1)
- Unassigned peaks labeled "likely higher-order or object/furniture"

## Default Parameters
- smoothingMs: 0.25, earlyWindowMs: 50, earlyStartMs: 0.3
- peakThresholdDb: -40, minSepMs: 1.0, noiseFloorMarginDb: 10
- peakMatchTolerance: 1ms, strictBounds: true

## Mic 2 & Fusion Overlay
- Optional Mic 2 position managed in geometry panel, persisted in project save/load
- Mic 2 rendered as distinct marker (triangle) in room views
- Fusion overlay: diamond markers for fusion-identified peaks in room views and surface panels
- Heatmaps merge fusion peaks with deduplication (by time+surface key)
- Fusion overlay state shared; last fusion run (Dual IR or 4-IR) populates overlay

## Fusion-Aware Analysis Panels
- When Dual IR or 4-IR fusion runs, IR datasets and fusion peaks propagate to analysis tabs
- **Decay Panel**: Shows overlaid Schroeder decay curves for all fusion IRs + fusion-averaged EDT/T20/T30/RT60 metrics with individual breakdowns
- **Frequency Panel**: Shows overlaid frequency response curves for all fusion IRs with legend and tooltips
- **Clarity Panel**: Shows fusion-averaged C50/C80/D50/Ts metrics with individual IR breakdown table
- **Scorecard Panel**: Shows combined fusion scorecard (based on all fusion peaks) with single-IR comparison

## Report Capture & Export
- ReportCapture (report-capture.tsx) renders all analysis panels offscreen for image capture
- Report panels use card-based layouts matching the app's visual style (rounded borders, grid layouts, verdict badges, metric cards)
- Scorecard: 3 cards (ITDG/RFZ/Critical) + 2 cards (Peak Bins/Worst Offenders) matching app layout
- Decay: 4 metric cards (EDT/T20/T30/RT60) + chart in card + slope analysis card
- Clarity: 4 metric cards + interpretation card + reference ranges card
- Frequency: chart in card + comb filter table in card
- Unassigned: individual cards per peak with classification badges and candidate tables
- Heatmap: grid-based red-to-green gradient using reportHeatColor() matching app's heatColor(), SVG sized to fit within 780px container
- html2canvas scale: 2 for sharp image quality, sequential capture, 100ms initial delay
- Unassigned peaks: rendered natively in both PDF (jsPDF autoTable) and Word (docx tables) for full-width, multi-page support — not captured as image
- CapturedImages interface includes: etcChart, roomTop, roomSide, roomSurface, peakTable, surfaceTable, decayChart, frequencyChart, heatmapGrid, scorecardImage, clarityImage, unassignedImage

## Ruler Scales
- All room views (Top, Side, Surface panels) include graduated ruler scales along edges with 0.5m step ticks and 1m labeled ticks
- Applied both in interactive room-view.tsx and report-capture.tsx (for PDF/Word export images)
