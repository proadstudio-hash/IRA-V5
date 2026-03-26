import type { Point3D, RoomDimensions, Surface, SpeakerConfig, PredictedReflection, RoomObject, SurfaceBounds, CeilingConfig } from "@shared/schema";

export function dot(a: Point3D, b: Point3D): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function sub(a: Point3D, b: Point3D): Point3D {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function add(a: Point3D, b: Point3D): Point3D {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scale(p: Point3D, s: number): Point3D {
  return { x: p.x * s, y: p.y * s, z: p.z * s };
}

export function length(p: Point3D): number {
  return Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
}

export function normalize(p: Point3D): Point3D {
  const l = length(p);
  if (l === 0) return { x: 0, y: 0, z: 0 };
  return { x: p.x / l, y: p.y / l, z: p.z / l };
}

export function distance(a: Point3D, b: Point3D): number {
  return length(sub(a, b));
}

export function reflectPoint(S: Point3D, planePoint: Point3D, planeNormal: Point3D): Point3D {
  const v = sub(S, planePoint);
  const dist = dot(v, planeNormal);
  return sub(S, scale(planeNormal, 2 * dist));
}

export function getRoomSurfaces(room: RoomDimensions, weights: Record<string, number>, materials: Record<string, string>, ceiling?: CeilingConfig): Surface[] {
  const surfaces: Surface[] = [
    {
      label: 'Front Wall',
      normal: { x: 1, y: 0, z: 0 },
      point: { x: 0, y: 0, z: 0 },
      weight: weights['Front Wall'] ?? 0.903,
      material: materials['Front Wall'] ?? 'Drywall',
    },
    {
      label: 'Rear Wall',
      normal: { x: -1, y: 0, z: 0 },
      point: { x: room.length, y: 0, z: 0 },
      weight: weights['Rear Wall'] ?? 0.903,
      material: materials['Rear Wall'] ?? 'Drywall',
    },
    {
      label: 'Right Wall',
      normal: { x: 0, y: 1, z: 0 },
      point: { x: 0, y: 0, z: 0 },
      weight: weights['Right Wall'] ?? 0.903,
      material: materials['Right Wall'] ?? 'Drywall',
    },
    {
      label: 'Left Wall',
      normal: { x: 0, y: -1, z: 0 },
      point: { x: 0, y: room.width, z: 0 },
      weight: weights['Left Wall'] ?? 0.903,
      material: materials['Left Wall'] ?? 'Drywall',
    },
    {
      label: 'Floor',
      normal: { x: 0, y: 0, z: 1 },
      point: { x: 0, y: 0, z: 0 },
      weight: weights['Floor'] ?? 0.987,
      material: materials['Floor'] ?? 'Tiles (marble/glazed)',
    },
  ];

  const ceilingSurfaces = getCeilingSurfaces(
    room,
    ceiling || { type: 'flat', minHeight: room.height, maxHeight: room.height },
    weights['Ceiling'] ?? 0.903,
    materials['Ceiling'] ?? 'Drywall'
  );
  surfaces.push(...ceilingSurfaces);

  return surfaces;
}

export function getCeilingHeightAt(
  x: number, y: number,
  room: RoomDimensions,
  ceiling: CeilingConfig
): number {
  if (ceiling.type === 'flat') return ceiling.maxHeight;

  const maxH = ceiling.maxHeight;
  const minH = ceiling.minHeight;
  const dH = maxH - minH;

  switch (ceiling.type) {
    case 'slope-x':
      return minH + dH * x / room.length;
    case 'slope-y':
      return minH + dH * y / room.width;
    case 'v-x': {
      const center = room.width / 2;
      const dist = Math.abs(y - center);
      return maxH - dH * dist / center;
    }
    case 'v-y': {
      const center = room.length / 2;
      const dist = Math.abs(x - center);
      return maxH - dH * dist / center;
    }
    case 'vflat-x': {
      const fw = ceiling.flatWidth || 0;
      const halfFlat = fw / 2;
      const center = room.width / 2;
      const dist = Math.abs(y - center);
      if (dist <= halfFlat) return maxH;
      const slopeDist = dist - halfFlat;
      const slopeLen = center - halfFlat;
      if (slopeLen <= 0) return maxH;
      return maxH - dH * slopeDist / slopeLen;
    }
    case 'vflat-y': {
      const fw = ceiling.flatWidth || 0;
      const halfFlat = fw / 2;
      const center = room.length / 2;
      const dist = Math.abs(x - center);
      if (dist <= halfFlat) return maxH;
      const slopeDist = dist - halfFlat;
      const slopeLen = center - halfFlat;
      if (slopeLen <= 0) return maxH;
      return maxH - dH * slopeDist / slopeLen;
    }
    default:
      return maxH;
  }
}

export function getCeilingSurfaces(
  room: RoomDimensions,
  ceiling: CeilingConfig,
  weight: number,
  material: string
): Surface[] {
  if (ceiling.type === 'flat') {
    return [{
      label: 'Ceiling',
      normal: { x: 0, y: 0, z: -1 },
      point: { x: 0, y: 0, z: ceiling.maxHeight },
      weight,
      material,
    }];
  }

  const minH = ceiling.minHeight;
  const maxH = ceiling.maxHeight;
  const dH = maxH - minH;
  const L = room.length;
  const W = room.width;

  if (ceiling.type === 'slope-x') {
    const mag = Math.sqrt(dH * dH + L * L);
    return [{
      label: 'Ceiling',
      normal: { x: dH / mag, y: 0, z: -L / mag },
      point: { x: 0, y: 0, z: minH },
      weight,
      material,
      bounds: {
        center: { x: L / 2, y: W / 2, z: (minH + maxH) / 2 },
        halfExtents: [L / 2, W / 2],
        localU: { x: 1, y: 0, z: 0 },
        localV: { x: 0, y: 1, z: 0 },
      },
    }];
  }

  if (ceiling.type === 'slope-y') {
    const mag = Math.sqrt(dH * dH + W * W);
    return [{
      label: 'Ceiling',
      normal: { x: 0, y: dH / mag, z: -W / mag },
      point: { x: 0, y: 0, z: minH },
      weight,
      material,
      bounds: {
        center: { x: L / 2, y: W / 2, z: (minH + maxH) / 2 },
        halfExtents: [L / 2, W / 2],
        localU: { x: 1, y: 0, z: 0 },
        localV: { x: 0, y: 1, z: 0 },
      },
    }];
  }

  if (ceiling.type === 'v-x') {
    const halfW = W / 2;
    const magR = Math.sqrt(dH * dH + halfW * halfW);
    const magL = magR;
    return [
      {
        label: 'Ceiling (R)',
        normal: { x: 0, y: dH / magR, z: -halfW / magR },
        point: { x: 0, y: 0, z: minH },
        weight, material,
        bounds: {
          center: { x: L / 2, y: halfW / 2, z: (minH + maxH) / 2 },
          halfExtents: [L / 2, halfW / 2],
          localU: { x: 1, y: 0, z: 0 },
          localV: { x: 0, y: 1, z: 0 },
        },
      },
      {
        label: 'Ceiling (L)',
        normal: { x: 0, y: -dH / magL, z: -halfW / magL },
        point: { x: 0, y: W, z: minH },
        weight, material,
        bounds: {
          center: { x: L / 2, y: W - halfW / 2, z: (minH + maxH) / 2 },
          halfExtents: [L / 2, halfW / 2],
          localU: { x: 1, y: 0, z: 0 },
          localV: { x: 0, y: 1, z: 0 },
        },
      },
    ];
  }

  if (ceiling.type === 'v-y') {
    const halfL = L / 2;
    const mag = Math.sqrt(dH * dH + halfL * halfL);
    return [
      {
        label: 'Ceiling (F)',
        normal: { x: dH / mag, y: 0, z: -halfL / mag },
        point: { x: 0, y: 0, z: minH },
        weight, material,
        bounds: {
          center: { x: halfL / 2, y: W / 2, z: (minH + maxH) / 2 },
          halfExtents: [halfL / 2, W / 2],
          localU: { x: 1, y: 0, z: 0 },
          localV: { x: 0, y: 1, z: 0 },
        },
      },
      {
        label: 'Ceiling (R)',
        normal: { x: -dH / mag, y: 0, z: -halfL / mag },
        point: { x: L, y: 0, z: minH },
        weight, material,
        bounds: {
          center: { x: L - halfL / 2, y: W / 2, z: (minH + maxH) / 2 },
          halfExtents: [halfL / 2, W / 2],
          localU: { x: 1, y: 0, z: 0 },
          localV: { x: 0, y: 1, z: 0 },
        },
      },
    ];
  }

  if (ceiling.type === 'vflat-x') {
    const fw = ceiling.flatWidth || 0;
    const halfFlat = fw / 2;
    const slopeW = W / 2 - halfFlat;
    if (slopeW <= 0) {
      return [{
        label: 'Ceiling',
        normal: { x: 0, y: 0, z: -1 },
        point: { x: 0, y: 0, z: maxH },
        weight, material,
      }];
    }
    const mag = Math.sqrt(dH * dH + slopeW * slopeW);
    return [
      {
        label: 'Ceiling (R)',
        normal: { x: 0, y: dH / mag, z: -slopeW / mag },
        point: { x: 0, y: 0, z: minH },
        weight, material,
        bounds: {
          center: { x: L / 2, y: slopeW / 2, z: (minH + maxH) / 2 },
          halfExtents: [L / 2, slopeW / 2],
          localU: { x: 1, y: 0, z: 0 },
          localV: { x: 0, y: 1, z: 0 },
        },
      },
      {
        label: 'Ceiling (C)',
        normal: { x: 0, y: 0, z: -1 },
        point: { x: 0, y: 0, z: maxH },
        weight, material,
        bounds: {
          center: { x: L / 2, y: W / 2, z: maxH },
          halfExtents: [L / 2, halfFlat],
          localU: { x: 1, y: 0, z: 0 },
          localV: { x: 0, y: 1, z: 0 },
        },
      },
      {
        label: 'Ceiling (L)',
        normal: { x: 0, y: -dH / mag, z: -slopeW / mag },
        point: { x: 0, y: W, z: minH },
        weight, material,
        bounds: {
          center: { x: L / 2, y: W - slopeW / 2, z: (minH + maxH) / 2 },
          halfExtents: [L / 2, slopeW / 2],
          localU: { x: 1, y: 0, z: 0 },
          localV: { x: 0, y: 1, z: 0 },
        },
      },
    ];
  }

  if (ceiling.type === 'vflat-y') {
    const fw = ceiling.flatWidth || 0;
    const halfFlat = fw / 2;
    const slopeL = L / 2 - halfFlat;
    if (slopeL <= 0) {
      return [{
        label: 'Ceiling',
        normal: { x: 0, y: 0, z: -1 },
        point: { x: 0, y: 0, z: maxH },
        weight, material,
      }];
    }
    const mag = Math.sqrt(dH * dH + slopeL * slopeL);
    return [
      {
        label: 'Ceiling (F)',
        normal: { x: dH / mag, y: 0, z: -slopeL / mag },
        point: { x: 0, y: 0, z: minH },
        weight, material,
        bounds: {
          center: { x: slopeL / 2, y: W / 2, z: (minH + maxH) / 2 },
          halfExtents: [slopeL / 2, W / 2],
          localU: { x: 1, y: 0, z: 0 },
          localV: { x: 0, y: 1, z: 0 },
        },
      },
      {
        label: 'Ceiling (C)',
        normal: { x: 0, y: 0, z: -1 },
        point: { x: 0, y: 0, z: maxH },
        weight, material,
        bounds: {
          center: { x: L / 2, y: W / 2, z: maxH },
          halfExtents: [halfFlat, W / 2],
          localU: { x: 1, y: 0, z: 0 },
          localV: { x: 0, y: 1, z: 0 },
        },
      },
      {
        label: 'Ceiling (R)',
        normal: { x: -dH / mag, y: 0, z: -slopeL / mag },
        point: { x: L, y: 0, z: minH },
        weight, material,
        bounds: {
          center: { x: L - slopeL / 2, y: W / 2, z: (minH + maxH) / 2 },
          halfExtents: [slopeL / 2, W / 2],
          localU: { x: 1, y: 0, z: 0 },
          localV: { x: 0, y: 1, z: 0 },
        },
      },
    ];
  }

  return [{
    label: 'Ceiling',
    normal: { x: 0, y: 0, z: -1 },
    point: { x: 0, y: 0, z: maxH },
    weight, material,
  }];
}

export function getObjectSurfaces(objects: RoomObject[]): Surface[] {
  const surfaces: Surface[] = [];

  for (const obj of objects) {
    const rad = (obj.angle * Math.PI) / 180;
    const cosA = Math.cos(rad);
    const sinA = Math.sin(rad);

    const localX: Point3D = { x: cosA, y: sinA, z: 0 };
    const localY: Point3D = { x: -sinA, y: cosA, z: 0 };
    const localZ: Point3D = { x: 0, y: 0, z: 1 };

    const pos = obj.position;
    const w = obj.width;
    const d = obj.depth;
    const h = obj.height;

    if (obj.type === 'desk') {
      surfaces.push({
        label: `${obj.label} (top)`,
        normal: { x: 0, y: 0, z: 1 },
        point: { ...pos },
        weight: obj.weight,
        material: obj.material,
        bounds: { center: { ...pos }, halfExtents: [d / 2, w / 2], localU: localX, localV: localY },
      });
    } else if (obj.type === 'monitor') {
      surfaces.push({
        label: `${obj.label} (surface)`,
        normal: localX,
        point: { ...pos },
        weight: obj.weight,
        material: obj.material,
        bounds: { center: { ...pos }, halfExtents: [w / 2, h / 2], localU: localY, localV: localZ },
      });
    } else if (obj.type === 'parallelepiped') {
      const topC = add(pos, scale(localZ, h / 2));
      const botC = add(pos, scale(localZ, -h / 2));
      surfaces.push({
        label: `${obj.label} (top)`,
        normal: localZ, point: topC, weight: obj.weight, material: obj.material,
        bounds: { center: topC, halfExtents: [d / 2, w / 2], localU: localX, localV: localY },
      });
      surfaces.push({
        label: `${obj.label} (bottom)`,
        normal: scale(localZ, -1), point: botC, weight: obj.weight, material: obj.material,
        bounds: { center: botC, halfExtents: [d / 2, w / 2], localU: localX, localV: localY },
      });
      const frontC = add(pos, scale(localX, d / 2));
      const backC = add(pos, scale(localX, -d / 2));
      surfaces.push({
        label: `${obj.label} (front)`,
        normal: localX, point: frontC, weight: obj.weight, material: obj.material,
        bounds: { center: frontC, halfExtents: [w / 2, h / 2], localU: localY, localV: localZ },
      });
      surfaces.push({
        label: `${obj.label} (back)`,
        normal: scale(localX, -1), point: backC, weight: obj.weight, material: obj.material,
        bounds: { center: backC, halfExtents: [w / 2, h / 2], localU: localY, localV: localZ },
      });
      const rightC = add(pos, scale(localY, w / 2));
      const leftC = add(pos, scale(localY, -w / 2));
      surfaces.push({
        label: `${obj.label} (right)`,
        normal: localY, point: rightC, weight: obj.weight, material: obj.material,
        bounds: { center: rightC, halfExtents: [d / 2, h / 2], localU: localX, localV: localZ },
      });
      surfaces.push({
        label: `${obj.label} (left)`,
        normal: scale(localY, -1), point: leftC, weight: obj.weight, material: obj.material,
        bounds: { center: leftC, halfExtents: [d / 2, h / 2], localU: localX, localV: localZ },
      });
    }
  }

  return surfaces;
}

export function isPointInsideRoom(
  p: Point3D,
  room: RoomDimensions,
  ceiling?: CeilingConfig,
  tol: number = 0.15
): boolean {
  if (p.x < -tol || p.x > room.length + tol) return false;
  if (p.y < -tol || p.y > room.width + tol) return false;
  if (p.z < -tol) return false;
  const maxZ = ceiling && ceiling.type !== 'flat'
    ? getCeilingHeightAt(p.x, p.y, room, ceiling)
    : room.height;
  if (p.z > maxZ + tol) return false;
  return true;
}

function doesPathCrossCeiling(
  a: Point3D, b: Point3D,
  room: RoomDimensions,
  ceiling?: CeilingConfig
): boolean {
  if (!ceiling || ceiling.type === 'flat') return false;
  const segLen = distance(a, b);
  const samples = Math.max(5, Math.ceil(segLen / 0.15));
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const px = a.x + t * (b.x - a.x);
    const py = a.y + t * (b.y - a.y);
    const pz = a.z + t * (b.z - a.z);
    const ceilH = getCeilingHeightAt(px, py, room, ceiling);
    if (pz > ceilH + 0.05) return true;
  }
  return false;
}

function computeReflectionPoint(
  imageSource: Point3D,
  mic: Point3D,
  planePoint: Point3D,
  planeNormal: Point3D
): { point: Point3D; uValue: number; uInSegment: boolean; valid: boolean } {
  const denom = dot(planeNormal, sub(mic, imageSource));
  if (Math.abs(denom) < 1e-10) {
    return { point: { x: 0, y: 0, z: 0 }, uValue: -1, uInSegment: false, valid: false };
  }

  const u = dot(planeNormal, sub(planePoint, imageSource)) / denom;
  const refPoint = add(imageSource, scale(sub(mic, imageSource), u));

  return {
    point: refPoint,
    uValue: u,
    uInSegment: u >= 0 && u <= 1,
    valid: u >= -0.01 && u <= 1.01,
  };
}

function isReflectionOnWall(
  refPoint: Point3D,
  surfaceLabel: string,
  room: RoomDimensions,
  strict: boolean = true,
  bounds?: SurfaceBounds,
  ceiling?: CeilingConfig
): boolean {
  if (bounds) {
    const rel = sub(refPoint, bounds.center);
    const u = dot(rel, bounds.localU);
    const v = dot(rel, bounds.localV);
    const tol = strict ? 0 : 0.15;
    return Math.abs(u) <= bounds.halfExtents[0] + tol && Math.abs(v) <= bounds.halfExtents[1] + tol;
  }
  const tol = strict ? 0 : 0.15;
  const maxZ = ceiling && ceiling.type !== 'flat'
    ? getCeilingHeightAt(refPoint.x, refPoint.y, room, ceiling)
    : room.height;
  switch (surfaceLabel) {
    case 'Front Wall':
    case 'Rear Wall':
      return (
        refPoint.y >= -tol && refPoint.y <= room.width + tol &&
        refPoint.z >= -tol && refPoint.z <= maxZ + tol
      );
    case 'Left Wall':
    case 'Right Wall':
      return (
        refPoint.x >= -tol && refPoint.x <= room.length + tol &&
        refPoint.z >= -tol && refPoint.z <= maxZ + tol
      );
    case 'Floor':
    case 'Ceiling':
      return (
        refPoint.x >= -tol && refPoint.x <= room.length + tol &&
        refPoint.y >= -tol && refPoint.y <= room.width + tol
      );
    default:
      return (
        refPoint.x >= -tol && refPoint.x <= room.length + tol &&
        refPoint.y >= -tol && refPoint.y <= room.width + tol &&
        refPoint.z >= -tol && refPoint.z <= maxZ + tol
      );
  }
}

export function computeFirstOrderReflections(
  speaker: Point3D,
  mic: Point3D,
  surfaces: Surface[],
  speedOfSound: number,
  room: RoomDimensions,
  speakerId: string,
  strictBounds: boolean = true,
  ceiling?: CeilingConfig
): PredictedReflection[] {
  const directLength = distance(speaker, mic);
  const reflections: PredictedReflection[] = [];

  for (const surface of surfaces) {
    const imageSource = reflectPoint(speaker, surface.point, surface.normal);
    const pathLength = distance(imageSource, mic);
    const delay_ms = ((pathLength - directLength) / speedOfSound) * 1000;

    if (delay_ms < 0) continue;

    const { point: refPoint, uValue, uInSegment, valid: paramValid } = computeReflectionPoint(
      imageSource, mic, surface.point, surface.normal
    );

    const insideSurfaceBounds = isReflectionOnWall(refPoint, surface.label, room, strictBounds, surface.bounds, ceiling);
    const insideRoom = isPointInsideRoom(refPoint, room, ceiling, strictBounds ? 0 : 0.15);
    const pathOk = !doesPathCrossCeiling(speaker, refPoint, room, ceiling)
                && !doesPathCrossCeiling(refPoint, mic, room, ceiling);
    const valid = paramValid && insideSurfaceBounds && insideRoom && pathOk;

    const micDist = distance(mic, refPoint);
    const spkDist = distance(speaker, refPoint);

    const dirIn = normalize(sub(refPoint, speaker));
    const cosAngle = Math.abs(dot(dirIn, surface.normal));
    const incidenceAngle = Math.acos(Math.min(1, cosAngle)) * (180 / Math.PI);

    reflections.push({
      surfaceLabel: surface.label,
      surfaceLabels: [surface.label],
      order: 1,
      imageSource,
      reflectionPoint: refPoint,
      pathLength,
      directLength,
      delay_ms,
      micDistance: micDist,
      speakerDistance: spkDist,
      valid,
      insideSurfaceBounds,
      uInSegment,
      uValue,
      priorWeight: surface.weight,
      incidenceAngle,
      speakerId,
      speakerPosition: { ...speaker },
    });
  }

  return reflections;
}

export function computeSecondOrderReflections(
  speaker: Point3D,
  mic: Point3D,
  surfaces: Surface[],
  speedOfSound: number,
  room: RoomDimensions,
  speakerId: string,
  maxReflections: number = 48,
  strictBounds: boolean = true,
  ceiling?: CeilingConfig
): PredictedReflection[] {
  const directLength = distance(speaker, mic);
  const reflections: PredictedReflection[] = [];

  const topSurfaces = [...surfaces]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4);

  for (const surfA of topSurfaces) {
    for (const surfB of surfaces) {
      if (surfA.label === surfB.label) continue;
      if (reflections.length >= maxReflections) break;

      const s1 = reflectPoint(speaker, surfA.point, surfA.normal);
      const s2 = reflectPoint(s1, surfB.point, surfB.normal);
      const pathLength = distance(s2, mic);
      const delay_ms = ((pathLength - directLength) / speedOfSound) * 1000;

      if (delay_ms < 0 || delay_ms > 100) continue;

      const { point: refPoint2, uValue, uInSegment, valid: paramValid } = computeReflectionPoint(
        s2, mic, surfB.point, surfB.normal
      );

      const insideSurfaceBounds = isReflectionOnWall(refPoint2, surfB.label, room, strictBounds, surfB.bounds, ceiling);
      const insideRoom2 = isPointInsideRoom(refPoint2, room, ceiling, strictBounds ? 0 : 0.15);

      const { point: refPoint1, valid: paramValid1, uInSegment: uInSegment1 } = computeReflectionPoint(s1, refPoint2, surfA.point, surfA.normal);
      const insideSurfaceBoundsA = isReflectionOnWall(refPoint1, surfA.label, room, strictBounds, surfA.bounds, ceiling);
      const insideRoom1 = isPointInsideRoom(refPoint1, room, ceiling, strictBounds ? 0 : 0.15);

      const pathOk = !doesPathCrossCeiling(speaker, refPoint1, room, ceiling)
                  && !doesPathCrossCeiling(refPoint1, refPoint2, room, ceiling)
                  && !doesPathCrossCeiling(refPoint2, mic, room, ceiling);

      const valid = paramValid && paramValid1 && insideSurfaceBounds && insideRoom2 && insideSurfaceBoundsA && insideRoom1 && pathOk;
      const micDist = distance(mic, refPoint2);
      const combinedWeight = surfA.weight * surfB.weight;

      reflections.push({
        surfaceLabel: `${surfA.label} → ${surfB.label}`,
        surfaceLabels: [surfA.label, surfB.label],
        order: 2,
        imageSource: s2,
        reflectionPoint: refPoint2,
        pathLength,
        directLength,
        delay_ms,
        micDistance: micDist,
        speakerDistance: distance(speaker, refPoint2),
        valid,
        insideSurfaceBounds,
        uInSegment,
        uValue,
        priorWeight: combinedWeight,
        speakerId,
        speakerPosition: { ...speaker },
      });
    }
    if (reflections.length >= maxReflections) break;
  }

  return reflections;
}

export function computeAllReflections(
  speaker: SpeakerConfig,
  mic: Point3D,
  room: RoomDimensions,
  surfaces: Surface[],
  speedOfSound: number,
  enableOrder2: boolean,
  maxReflections: number,
  strictBounds: boolean = true,
  ceiling?: CeilingConfig
): PredictedReflection[] {
  const first = computeFirstOrderReflections(
    speaker.position, mic, surfaces, speedOfSound, room, speaker.id, strictBounds, ceiling
  );
  
  if (!enableOrder2) return first;

  const second = computeSecondOrderReflections(
    speaker.position, mic, surfaces, speedOfSound, room, speaker.id,
    maxReflections - first.length, strictBounds, ceiling
  );

  return [...first, ...second].slice(0, maxReflections);
}
