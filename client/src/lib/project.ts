import type { ProjectData, RoomDimensions, SpeakerConfig, Point3D, AnalysisSettings } from "@shared/schema";
import { DEFAULT_SETTINGS, DEFAULT_ROOM, DEFAULT_SPEAKER, DEFAULT_MIC } from "@shared/schema";

export function createDefaultProject(): ProjectData {
  return {
    name: 'Untitled Project',
    room: { ...DEFAULT_ROOM },
    speakers: [{ ...DEFAULT_SPEAKER }],
    micPosition: { ...DEFAULT_MIC },
    mic2Position: null,
    settings: { ...DEFAULT_SETTINGS },
    surfaceWeights: {},
    surfaceMaterials: {},
  };
}

export function saveProjectToJSON(project: ProjectData): string {
  return JSON.stringify(project, null, 2);
}

export function loadProjectFromJSON(json: string): ProjectData {
  const data = JSON.parse(json);
  return {
    name: data.name || 'Imported Project',
    room: data.room || { ...DEFAULT_ROOM },
    speakers: data.speakers || [{ ...DEFAULT_SPEAKER }],
    micPosition: data.micPosition || { ...DEFAULT_MIC },
    mic2Position: data.mic2Position || null,
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
    surfaceWeights: data.surfaceWeights || {},
    surfaceMaterials: data.surfaceMaterials || {},
    roomObjects: data.roomObjects || [],
    ceiling: data.ceiling || undefined,
  };
}

export function downloadFile(content: string, filename: string, type: string = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
