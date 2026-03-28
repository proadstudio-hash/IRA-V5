import { z } from "zod";

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface RoomDimensions {
  length: number;
  width: number;
  height: number;
}

export interface SurfaceBounds {
  center: Point3D;
  halfExtents: [number, number];
  localU: Point3D;
  localV: Point3D;
}

export interface Surface {
  label: string;
  normal: Point3D;
  point: Point3D;
  weight: number;
  material: string;
  bounds?: SurfaceBounds;
}

export type RoomObjectType = 'desk' | 'monitor' | 'parallelepiped';

export interface RoomObject {
  id: string;
  type: RoomObjectType;
  label: string;
  position: Point3D;
  width: number;
  depth: number;
  height: number;
  angle: number;
  material: string;
  weight: number;
}

export type CeilingType = 'flat' | 'slope-x' | 'slope-y' | 'v-x' | 'v-y' | 'vflat-x' | 'vflat-y';

export interface CeilingConfig {
  type: CeilingType;
  minHeight: number;
  maxHeight: number;
  flatWidth?: number;
}

export const DEFAULT_CEILING: CeilingConfig = {
  type: 'flat',
  minHeight: 3,
  maxHeight: 3,
};

export const CEILING_TYPE_LABELS: Record<CeilingType, string> = {
  'flat': 'Flat',
  'slope-x': 'Slope along X',
  'slope-y': 'Slope along Y',
  'v-x': 'V-Shape along X',
  'v-y': 'V-Shape along Y',
  'vflat-x': 'V-Flat along X',
  'vflat-y': 'V-Flat along Y',
};

export interface SpeakerConfig {
  id: string;
  label: string;
  position: Point3D;
}

export interface IRData {
  sampleRate: number;
  samples: Float64Array;
  filename: string;
}

export interface FusionIRDataset {
  label: string;
  irData: IRData;
}

export interface ETCPoint {
  time: number;
  level: number;
}

export interface Peak {
  index: number;
  delay_ms: number;
  rel_dB: number;
  severity: number;
  equivalentDistance?: number;
  extraPathLength?: number;
  targetReflectedLength?: number;
}

export interface PredictedReflection {
  surfaceLabel: string;
  surfaceLabels: string[];
  order: number;
  imageSource: Point3D;
  reflectionPoint: Point3D;
  pathLength: number;
  directLength: number;
  delay_ms: number;
  micDistance: number;
  speakerDistance: number;
  valid: boolean;
  insideSurfaceBounds: boolean;
  uInSegment: boolean;
  uValue: number;
  priorWeight: number;
  incidenceAngle?: number;
  speakerId: string;
  speakerPosition: Point3D;
}

export interface MatchedPeak {
  peak: Peak;
  reflection?: PredictedReflection;
  confidence: number;
  timeError: number;
  assigned: boolean;
  targetMicIndex?: number;
}

export interface SurfaceSummary {
  surfaceLabel: string;
  peakCount: number;
  worstSeverity: number;
  earliestTime: number;
  totalSeverity: number;
}

export type AnalysisMode = 'ir-only' | 'geometry';

export interface AnalysisSettings {
  mode: AnalysisMode;
  speedOfSound: number;
  temperature?: number;
  peakMatchTolerance: number;
  smoothingMs: number;
  earlyWindowMs: number;
  earlyStartMs: number;
  peakThresholdDb: number;
  minSepMs: number;
  noiseFloorMarginDb: number;
  enableOrder2: boolean;
  maxPredictedReflections: number;
  strictBounds: boolean;
  enableObjects: boolean;
}

export interface ProjectData {
  name: string;
  room: RoomDimensions;
  speakers: SpeakerConfig[];
  micPosition: Point3D;
  mic2Position?: Point3D | null;
  settings: AnalysisSettings;
  surfaceWeights: Record<string, number>;
  surfaceMaterials: Record<string, string>;
  roomObjects?: RoomObject[];
  ceiling?: CeilingConfig;
}

export const MATERIAL_PRESETS: Record<string, number> = {
  'Tiles (marble/glazed)': 0.987,
  'MLV (vinyl/linoleum on concrete)': 0.973,
  'Aluminium panel': 0.950,
  'Concrete (unpainted)': 0.948,
  'Half aluminium / half window': 0.946,
  'Parquet on concrete': 0.943,
  'High-density MDF': 0.943,
  'MDF': 0.943,
  'Diffuser panel (wood)': 0.943,
  'Solid wood (panel/door)': 0.943,
  'Glass (6mm plate)': 0.942,
  'Half wall / half window': 0.923,
  'Plasterboard (suspended)': 0.918,
  'Drywall': 0.903,
  'Steel / reinforced metal': 0.898,
  'Plywood (19mm)': 0.858,
  'Baltic birch plywood': 0.858,
  'Felt (5mm on concrete)': 0.845,
  'Carpet (thin)': 0.843,
  'PET panel 12mm': 0.540,
  'Curtain (heavy, pleated)': 0.488,
  'PET panel 24mm': 0.450,
  'Office ceiling panels': 0.383,
  'Perforated metal absorber': 0.225,
  'Absorber panel (50mm fiberglass)': 0.183,
  'Custom': 1.0,
};

export const DEFAULT_SURFACE_MATERIALS: Record<string, string> = {
  'Front Wall': 'Drywall',
  'Rear Wall': 'Drywall',
  'Right Wall': 'Drywall',
  'Left Wall': 'Drywall',
  'Floor': 'Tiles (marble/glazed)',
  'Ceiling': 'Drywall',
};

export const DEFAULT_SETTINGS: AnalysisSettings = {
  mode: 'ir-only',
  speedOfSound: 343,
  peakMatchTolerance: 1,
  smoothingMs: 0.25,
  earlyWindowMs: 50,
  earlyStartMs: 0.3,
  peakThresholdDb: -40,
  minSepMs: 1.0,
  noiseFloorMarginDb: 10,
  enableOrder2: false,
  maxPredictedReflections: 48,
  strictBounds: true,
  enableObjects: false,
};

export type ModeType = 'axial' | 'tangential' | 'oblique';

export interface RoomMode {
  n: number;
  m: number;
  l: number;
  frequency: number;
  type: ModeType;
  Q: number;
  T60: number;
  amplitude: number;
  matched: boolean;
  measuredFreq?: number;
  measuredQ?: number;
  measuredAmplitude?: number;
  modeShape?: Float64Array;
}

export interface ModalPeak {
  frequency: number;
  amplitude: number;
  Q: number;
  T60: number;
  matchedModeIndex: number;
}

export interface PressureMapData {
  grid: number[][];
  gridWidth: number;
  gridHeight: number;
  uRange: [number, number];
  vRange: [number, number];
  uAxis: string;
  vAxis: string;
  minVal: number;
  maxVal: number;
}

export interface SeatCandidate {
  x: number;
  y: number;
  z: number;
  score: number;
  Jvar: number;
  Jnull: number;
  Jpeak: number;
  Jspatial: number;
  Jsymmetry: number;
  responseCurve: { freq: number; dB: number }[];
}

export interface ModalAnalysisResult {
  modes: RoomMode[];
  measuredPeaks: ModalPeak[];
  schroederFreq: number;
  pressureMapTop?: PressureMapData;
  pressureMapSide?: PressureMapData;
  globalPressureMapTop?: PressureMapData;
  globalPressureMapSide?: PressureMapData;
  seatCandidates: SeatCandidate[];
  bestSeat?: SeatCandidate;
  currentSeatResponse?: { freq: number; dB: number }[];
  selectedModeIndex: number;
  fMin: number;
  fMax: number;
}

export const DEFAULT_ROOM: RoomDimensions = {
  length: 6,
  width: 5,
  height: 3,
};

export const DEFAULT_SPEAKER: SpeakerConfig = {
  id: 'speaker-1',
  label: 'Speaker L',
  position: { x: 0.5, y: 1.5, z: 1.2 },
};

export const DEFAULT_MIC: Point3D = {
  x: 3.0,
  y: 2.5,
  z: 1.2,
};
