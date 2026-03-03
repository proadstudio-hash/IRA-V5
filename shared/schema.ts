import { sql } from "drizzle-orm";
import { pgTable, text, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

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

export interface Surface {
  label: string;
  normal: Point3D;
  point: Point3D;
  weight: number;
  material: string;
}

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
};

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
