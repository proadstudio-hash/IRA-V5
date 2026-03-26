import { useState } from "react";
import { Plus, Trash2, Thermometer } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import type { RoomDimensions, SpeakerConfig, Point3D, AnalysisSettings, RoomObject, RoomObjectType, CeilingConfig, CeilingType } from "@shared/schema";
import { MATERIAL_PRESETS, CEILING_TYPE_LABELS } from "@shared/schema";
import { computeSpeedOfSound } from "@/lib/dsp";

interface GeometryPanelProps {
  room: RoomDimensions;
  onRoomChange: (room: RoomDimensions) => void;
  speakers: SpeakerConfig[];
  onSpeakersChange: (speakers: SpeakerConfig[]) => void;
  micPosition: Point3D;
  onMicChange: (mic: Point3D) => void;
  mic2Position: Point3D | null;
  onMic2Change: (mic: Point3D | null) => void;
  settings: AnalysisSettings;
  onSettingsChange: (settings: AnalysisSettings) => void;
  surfaceWeights: Record<string, number>;
  onSurfaceWeightsChange: (w: Record<string, number>) => void;
  surfaceMaterials: Record<string, string>;
  onSurfaceMaterialsChange: (m: Record<string, string>) => void;
  roomObjects: RoomObject[];
  onRoomObjectsChange: (objects: RoomObject[]) => void;
  ceiling: CeilingConfig;
  onCeilingChange: (ceiling: CeilingConfig) => void;
}

function NumberInput({ 
  label, value, onChange, min, max, step = 0.1, unit, testId 
}: { 
  label: string; value: number; onChange: (v: number) => void; 
  min?: number; max?: number; step?: number; unit?: string; testId: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}{unit ? ` (${unit})` : ''}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        min={min}
        max={max}
        step={step}
        className="h-8 text-sm"
        data-testid={testId}
      />
    </div>
  );
}

function Point3DInput({ 
  label, value, onChange, prefix 
}: { 
  label: string; value: Point3D; onChange: (p: Point3D) => void; prefix: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      <div className="grid grid-cols-3 gap-1.5">
        <NumberInput
          label="X"
          value={value.x}
          onChange={(v) => onChange({ ...value, x: v })}
          step={0.05}
          unit="m"
          testId={`input-${prefix}-x`}
        />
        <NumberInput
          label="Y"
          value={value.y}
          onChange={(v) => onChange({ ...value, y: v })}
          step={0.05}
          unit="m"
          testId={`input-${prefix}-y`}
        />
        <NumberInput
          label="Z"
          value={value.z}
          onChange={(v) => onChange({ ...value, z: v })}
          step={0.05}
          unit="m"
          testId={`input-${prefix}-z`}
        />
      </div>
    </div>
  );
}

const SURFACE_LABELS = ['Front Wall', 'Rear Wall', 'Right Wall', 'Left Wall', 'Floor', 'Ceiling'];

export function GeometryPanel({
  room, onRoomChange,
  speakers, onSpeakersChange,
  micPosition, onMicChange,
  mic2Position, onMic2Change,
  settings, onSettingsChange,
  surfaceWeights, onSurfaceWeightsChange,
  surfaceMaterials, onSurfaceMaterialsChange,
  roomObjects, onRoomObjectsChange,
  ceiling, onCeilingChange,
}: GeometryPanelProps) {
  const [useTemperature, setUseTemperature] = useState(false);

  const addSpeaker = () => {
    const id = `speaker-${Date.now()}`;
    onSpeakersChange([...speakers, {
      id,
      label: `Speaker ${speakers.length + 1}`,
      position: { x: 0.5, y: room.width - 1.5, z: 1.2 },
    }]);
  };

  const removeSpeaker = (idx: number) => {
    if (speakers.length <= 1) return;
    onSpeakersChange(speakers.filter((_, i) => i !== idx));
  };

  const updateSpeaker = (idx: number, updates: Partial<SpeakerConfig>) => {
    const newSpeakers = [...speakers];
    newSpeakers[idx] = { ...newSpeakers[idx], ...updates };
    onSpeakersChange(newSpeakers);
  };

  const addObject = (type: RoomObjectType) => {
    const id = `obj-${Date.now()}`;
    const defaults: Record<RoomObjectType, Partial<RoomObject>> = {
      desk: { width: 1.5, depth: 1.0, height: 0, angle: 0 },
      monitor: { width: 0.6, depth: 0, height: 0.35, angle: 0 },
      parallelepiped: { width: 0.5, depth: 0.5, height: 0.5, angle: 0 },
    };
    const d = defaults[type];
    const label = type === 'desk' ? `Desk ${roomObjects.filter(o => o.type === 'desk').length + 1}`
      : type === 'monitor' ? `Monitor ${roomObjects.filter(o => o.type === 'monitor').length + 1}`
      : `Object ${roomObjects.filter(o => o.type === 'parallelepiped').length + 1}`;
    onRoomObjectsChange([...roomObjects, {
      id, type, label,
      position: { x: room.length / 2, y: room.width / 2, z: type === 'desk' ? 0.75 : type === 'monitor' ? 1.2 : 0.5 },
      width: d.width!, depth: d.depth!, height: d.height!, angle: d.angle!,
      material: type === 'monitor' ? 'Glass (6mm plate)' : 'Solid wood (panel/door)',
      weight: type === 'monitor' ? MATERIAL_PRESETS['Glass (6mm plate)'] : MATERIAL_PRESETS['Solid wood (panel/door)'],
    }]);
  };

  const removeObject = (idx: number) => {
    onRoomObjectsChange(roomObjects.filter((_, i) => i !== idx));
  };

  const updateObject = (idx: number, updates: Partial<RoomObject>) => {
    const newObjects = [...roomObjects];
    newObjects[idx] = { ...newObjects[idx], ...updates };
    onRoomObjectsChange(newObjects);
  };

  const objectTypeLabels: Record<RoomObjectType, string> = {
    desk: 'Desk (horizontal)',
    monitor: 'Monitor (vertical)',
    parallelepiped: 'Box (3D)',
  };

  return (
    <Accordion type="multiple" defaultValue={["room", "positions", "physics"]} className="space-y-0">
      <AccordionItem value="room" className="border-none">
        <AccordionTrigger className="py-2 text-sm font-medium hover:no-underline" data-testid="accordion-room">
          Room Dimensions
        </AccordionTrigger>
        <AccordionContent className="pb-3">
          <div className="grid grid-cols-3 gap-2">
            <NumberInput
              label="Length (X)"
              value={room.length}
              onChange={(v) => onRoomChange({ ...room, length: v })}
              min={0.5}
              max={100}
              unit="m"
              testId="input-room-length"
            />
            <NumberInput
              label="Width (Y)"
              value={room.width}
              onChange={(v) => onRoomChange({ ...room, width: v })}
              min={0.5}
              max={100}
              unit="m"
              testId="input-room-width"
            />
            <NumberInput
              label={ceiling.type !== 'flat' ? 'Max Height (Z)' : 'Height (Z)'}
              value={room.height}
              onChange={(v) => {
                onRoomChange({ ...room, height: v });
                if (ceiling.type !== 'flat') {
                  onCeilingChange({ ...ceiling, maxHeight: v, minHeight: Math.min(ceiling.minHeight, v) });
                }
              }}
              min={0.5}
              max={50}
              unit="m"
              testId="input-room-height"
            />
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">
            Origin (0,0,0): Front-Right-Floor corner. X: front→rear (depth), Y: right→left (width), Z: floor→ceiling (height). Speaker faces rear wall.
          </p>
        </AccordionContent>
      </AccordionItem>

      <Separator />

      <AccordionItem value="ceiling" className="border-none">
        <AccordionTrigger className="py-2 text-sm font-medium hover:no-underline" data-testid="accordion-ceiling">
          Ceiling Shape
        </AccordionTrigger>
        <AccordionContent className="pb-3 space-y-2">
          <div>
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select
              value={ceiling.type}
              onValueChange={(val) => {
                const newType = val as CeilingType;
                if (newType === 'flat') {
                  onCeilingChange({ type: 'flat', minHeight: room.height, maxHeight: room.height });
                } else {
                  const newCeiling: CeilingConfig = {
                    type: newType,
                    minHeight: ceiling.type === 'flat' ? room.height * 0.7 : ceiling.minHeight,
                    maxHeight: ceiling.type === 'flat' ? room.height : ceiling.maxHeight,
                  };
                  if (newType === 'vflat-x' || newType === 'vflat-y') {
                    newCeiling.flatWidth = ceiling.flatWidth || 1.0;
                  }
                  onCeilingChange(newCeiling);
                  onRoomChange({ ...room, height: newCeiling.maxHeight });
                }
              }}
            >
              <SelectTrigger className="h-7 text-xs mt-1" data-testid="select-ceiling-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CEILING_TYPE_LABELS) as CeilingType[]).map(t => (
                  <SelectItem key={t} value={t} className="text-xs">{CEILING_TYPE_LABELS[t]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {ceiling.type !== 'flat' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <NumberInput
                  label="Min Height"
                  value={ceiling.minHeight}
                  onChange={(v) => {
                    onCeilingChange({ ...ceiling, minHeight: Math.min(v, ceiling.maxHeight) });
                  }}
                  min={0.5}
                  max={50}
                  unit="m"
                  testId="input-ceiling-min-height"
                />
                <NumberInput
                  label="Max Height"
                  value={ceiling.maxHeight}
                  onChange={(v) => {
                    onCeilingChange({ ...ceiling, maxHeight: Math.max(v, ceiling.minHeight) });
                    onRoomChange({ ...room, height: Math.max(v, ceiling.minHeight) });
                  }}
                  min={0.5}
                  max={50}
                  unit="m"
                  testId="input-ceiling-max-height"
                />
              </div>

              {(ceiling.type === 'vflat-x' || ceiling.type === 'vflat-y') && (
                <NumberInput
                  label="Flat section width"
                  value={ceiling.flatWidth || 1.0}
                  onChange={(v) => onCeilingChange({ ...ceiling, flatWidth: v })}
                  min={0.1}
                  max={ceiling.type === 'vflat-x' ? room.width * 0.9 : room.length * 0.9}
                  step={0.1}
                  unit="m"
                  testId="input-ceiling-flat-width"
                />
              )}

              <p className="text-[10px] text-muted-foreground">
                {ceiling.type === 'slope-x' && 'Min height at Front Wall, max at Rear Wall.'}
                {ceiling.type === 'slope-y' && 'Min height at Right Wall, max at Left Wall.'}
                {ceiling.type === 'v-x' && 'Ridge along X (front→rear). Min at Left & Right walls, max at center.'}
                {ceiling.type === 'v-y' && 'Ridge along Y (right→left). Min at Front & Rear walls, max at center.'}
                {ceiling.type === 'vflat-x' && 'Flat strip along X at max height. Slopes down to min at Left & Right walls.'}
                {ceiling.type === 'vflat-y' && 'Flat strip along Y at max height. Slopes down to min at Front & Rear walls.'}
              </p>
            </>
          )}
        </AccordionContent>
      </AccordionItem>

      <Separator />

      <AccordionItem value="positions" className="border-none">
        <AccordionTrigger className="py-2 text-sm font-medium hover:no-underline" data-testid="accordion-positions">
          Source & Mic Positions
        </AccordionTrigger>
        <AccordionContent className="pb-3 space-y-3">
          {speakers.map((spk, i) => (
            <div key={spk.id} className="space-y-1.5">
              <div className="flex items-center gap-1">
                <Input
                  value={spk.label}
                  onChange={(e) => updateSpeaker(i, { label: e.target.value })}
                  className="h-7 text-xs flex-1"
                  data-testid={`input-speaker-label-${i}`}
                />
                {speakers.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => removeSpeaker(i)}
                    data-testid={`button-remove-speaker-${i}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
              <Point3DInput
                label=""
                value={spk.position}
                onChange={(p) => updateSpeaker(i, { position: p })}
                prefix={`speaker-${i}`}
              />
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={addSpeaker}
            className="w-full"
            data-testid="button-add-speaker"
          >
            <Plus className="w-3 h-3 mr-1" /> Add Speaker
          </Button>

          <Separator />

          <Point3DInput
            label="Microphone 1"
            value={micPosition}
            onChange={onMicChange}
            prefix="mic"
          />

          <Separator />

          {mic2Position ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Microphone 2</Label>
                <Button variant="ghost" size="icon" className="h-6 w-6"
                  onClick={() => onMic2Change(null)} data-testid="button-remove-mic2">
                  <Trash2 className="w-3 h-3 text-destructive" />
                </Button>
              </div>
              <Point3DInput
                label=""
                value={mic2Position}
                onChange={(p) => onMic2Change(p)}
                prefix="mic2"
              />
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onMic2Change({ x: micPosition.x, y: micPosition.y + 0.5, z: micPosition.z })}
              className="w-full"
              data-testid="button-add-mic2"
            >
              <Plus className="w-3 h-3 mr-1" /> Add Mic 2
            </Button>
          )}
        </AccordionContent>
      </AccordionItem>

      <Separator />

      <AccordionItem value="objects" className="border-none">
        <AccordionTrigger className="py-2 text-sm font-medium hover:no-underline" data-testid="accordion-objects">
          Room Objects
        </AccordionTrigger>
        <AccordionContent className="pb-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Enable room objects</Label>
            <Switch
              checked={settings.enableObjects}
              onCheckedChange={(checked) => onSettingsChange({ ...settings, enableObjects: checked })}
              data-testid="switch-enable-objects"
            />
          </div>

          {settings.enableObjects && (
            <>
              {roomObjects.map((obj, i) => (
                <div key={obj.id} className="space-y-1.5 p-2 rounded-md bg-muted/30 border">
                  <div className="flex items-center gap-1">
                    <Input
                      value={obj.label}
                      onChange={(e) => updateObject(i, { label: e.target.value })}
                      className="h-7 text-xs flex-1"
                      data-testid={`input-obj-label-${i}`}
                    />
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => removeObject(i)}
                      data-testid={`button-remove-obj-${i}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>

                  <div className="text-[10px] text-muted-foreground font-medium">
                    {objectTypeLabels[obj.type]}
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <NumberInput
                      label="Width (Y)"
                      value={obj.width}
                      onChange={(v) => updateObject(i, { width: v })}
                      min={0.01} step={0.05} unit="m"
                      testId={`input-obj-width-${i}`}
                    />
                    {(obj.type === 'desk' || obj.type === 'parallelepiped') && (
                      <NumberInput
                        label="Depth (X)"
                        value={obj.depth}
                        onChange={(v) => updateObject(i, { depth: v })}
                        min={0.01} step={0.05} unit="m"
                        testId={`input-obj-depth-${i}`}
                      />
                    )}
                    {(obj.type === 'monitor' || obj.type === 'parallelepiped') && (
                      <NumberInput
                        label="Height (Z)"
                        value={obj.height}
                        onChange={(v) => updateObject(i, { height: v })}
                        min={0.01} step={0.05} unit="m"
                        testId={`input-obj-height-${i}`}
                      />
                    )}
                    <NumberInput
                      label="Angle"
                      value={obj.angle}
                      onChange={(v) => updateObject(i, { angle: v })}
                      min={-180} max={180} step={1} unit="deg"
                      testId={`input-obj-angle-${i}`}
                    />
                  </div>

                  <Point3DInput
                    label="Position"
                    value={obj.position}
                    onChange={(p) => updateObject(i, { position: p })}
                    prefix={`obj-${i}`}
                  />

                  <div className="grid grid-cols-[1fr_60px] gap-1.5 items-end">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Material</Label>
                      <Select
                        value={obj.material}
                        onValueChange={(val) => {
                          const w = val !== 'Custom' ? MATERIAL_PRESETS[val] : obj.weight;
                          updateObject(i, { material: val, weight: w });
                        }}
                      >
                        <SelectTrigger className="h-7 text-[11px]" data-testid={`select-obj-material-${i}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.keys(MATERIAL_PRESETS).map(m => (
                            <SelectItem key={m} value={m} className="text-[11px]">
                              {m} ({(MATERIAL_PRESETS[m] * 100).toFixed(1)}%)
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Input
                        type="number"
                        value={obj.weight}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                          updateObject(i, { weight: v, material: 'Custom' });
                        }}
                        min={0} max={1} step={0.01}
                        className="h-7 text-[11px]"
                        data-testid={`input-obj-weight-${i}`}
                      />
                    </div>
                  </div>
                </div>
              ))}

              <div className="grid grid-cols-3 gap-1">
                <Button variant="outline" size="sm" onClick={() => addObject('desk')} className="text-[10px] h-7" data-testid="button-add-desk">
                  <Plus className="w-3 h-3 mr-0.5" /> Desk
                </Button>
                <Button variant="outline" size="sm" onClick={() => addObject('monitor')} className="text-[10px] h-7" data-testid="button-add-monitor">
                  <Plus className="w-3 h-3 mr-0.5" /> Monitor
                </Button>
                <Button variant="outline" size="sm" onClick={() => addObject('parallelepiped')} className="text-[10px] h-7" data-testid="button-add-box">
                  <Plus className="w-3 h-3 mr-0.5" /> Box
                </Button>
              </div>
            </>
          )}
        </AccordionContent>
      </AccordionItem>

      <Separator />

      <AccordionItem value="physics" className="border-none">
        <AccordionTrigger className="py-2 text-sm font-medium hover:no-underline" data-testid="accordion-physics">
          Physics & Detection
        </AccordionTrigger>
        <AccordionContent className="pb-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Use temperature</Label>
            <Switch
              checked={useTemperature}
              onCheckedChange={(checked) => {
                setUseTemperature(checked);
                if (!checked) {
                  onSettingsChange({ ...settings, speedOfSound: 343, temperature: undefined });
                }
              }}
              data-testid="switch-temperature"
            />
          </div>

          {useTemperature ? (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground flex items-center gap-1">
                <Thermometer className="w-3 h-3" /> Temperature (°C)
              </Label>
              <Input
                type="number"
                value={settings.temperature ?? 20}
                onChange={(e) => {
                  const t = parseFloat(e.target.value) || 20;
                  onSettingsChange({
                    ...settings,
                    temperature: t,
                    speedOfSound: computeSpeedOfSound(t),
                  });
                }}
                className="h-8 text-sm"
                data-testid="input-temperature"
              />
              <p className="text-[10px] text-muted-foreground">
                c = {settings.speedOfSound.toFixed(1)} m/s
              </p>
            </div>
          ) : (
            <NumberInput
              label="Speed of sound"
              value={settings.speedOfSound}
              onChange={(v) => onSettingsChange({ ...settings, speedOfSound: v })}
              min={300}
              max={400}
              step={0.5}
              unit="m/s"
              testId="input-speed-of-sound"
            />
          )}

          <NumberInput
            label="Peak match tolerance"
            value={settings.peakMatchTolerance}
            onChange={(v) => onSettingsChange({ ...settings, peakMatchTolerance: v })}
            min={0.05}
            max={5}
            step={0.05}
            unit="ms"
            testId="input-tolerance"
          />

          <NumberInput
            label="Early window"
            value={settings.earlyWindowMs}
            onChange={(v) => onSettingsChange({ ...settings, earlyWindowMs: v })}
            min={5}
            max={200}
            step={5}
            unit="ms"
            testId="input-early-window"
          />

          <NumberInput
            label="Early start"
            value={settings.earlyStartMs}
            onChange={(v) => onSettingsChange({ ...settings, earlyStartMs: v })}
            min={0}
            max={5}
            step={0.1}
            unit="ms"
            testId="input-early-start"
          />

          <NumberInput
            label="Peak threshold (rel. to direct)"
            value={settings.peakThresholdDb}
            onChange={(v) => onSettingsChange({ ...settings, peakThresholdDb: v })}
            min={-60}
            max={0}
            step={1}
            unit="dB"
            testId="input-threshold"
          />

          <NumberInput
            label="Min peak separation"
            value={settings.minSepMs}
            onChange={(v) => onSettingsChange({ ...settings, minSepMs: v })}
            min={0.1}
            max={10}
            step={0.1}
            unit="ms"
            testId="input-min-sep"
          />

          <NumberInput
            label="Noise floor margin"
            value={settings.noiseFloorMarginDb}
            onChange={(v) => onSettingsChange({ ...settings, noiseFloorMarginDb: v })}
            min={0}
            max={30}
            step={1}
            unit="dB"
            testId="input-noise-margin"
          />

          <NumberInput
            label="ETC smoothing"
            value={settings.smoothingMs}
            onChange={(v) => onSettingsChange({ ...settings, smoothingMs: v })}
            min={0}
            max={5}
            step={0.05}
            unit="ms"
            testId="input-smoothing"
          />

          <Separator />

          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Strict surface bounds</Label>
            <Switch
              checked={settings.strictBounds}
              onCheckedChange={(checked) => onSettingsChange({ ...settings, strictBounds: checked })}
              data-testid="switch-strict-bounds"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">2nd order reflections</Label>
            <Switch
              checked={settings.enableOrder2}
              onCheckedChange={(checked) => onSettingsChange({ ...settings, enableOrder2: checked })}
              data-testid="switch-order2"
            />
          </div>

          {settings.enableOrder2 && (
            <NumberInput
              label="Max predicted reflections"
              value={settings.maxPredictedReflections}
              onChange={(v) => onSettingsChange({ ...settings, maxPredictedReflections: v })}
              min={6}
              max={200}
              step={1}
              testId="input-max-reflections"
            />
          )}
        </AccordionContent>
      </AccordionItem>

      <Separator />

      <AccordionItem value="surfaces" className="border-none">
        <AccordionTrigger className="py-2 text-sm font-medium hover:no-underline" data-testid="accordion-surfaces">
          Surface Properties
        </AccordionTrigger>
        <AccordionContent className="pb-3 space-y-2">
          {SURFACE_LABELS.map((label) => (
            <div key={label} className="space-y-1">
              <Label className="text-[10px] text-muted-foreground font-medium">{label}</Label>
              <div className="grid grid-cols-[1fr_70px] gap-1.5 items-end">
                <div>
                  <Select
                    value={surfaceMaterials[label] || 'Drywall'}
                    onValueChange={(val) => {
                      onSurfaceMaterialsChange({ ...surfaceMaterials, [label]: val });
                      if (val !== 'Custom') {
                        onSurfaceWeightsChange({ ...surfaceWeights, [label]: MATERIAL_PRESETS[val] });
                      }
                    }}
                  >
                    <SelectTrigger className="h-7 text-[11px]" data-testid={`select-material-${label}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.keys(MATERIAL_PRESETS).map(m => (
                        <SelectItem key={m} value={m} className="text-[11px]">
                          {m} ({(MATERIAL_PRESETS[m] * 100).toFixed(1)}%)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Input
                    type="number"
                    value={surfaceWeights[label] ?? 0.903}
                    onChange={(e) => {
                      const v = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                      onSurfaceWeightsChange({ ...surfaceWeights, [label]: v });
                      onSurfaceMaterialsChange({ ...surfaceMaterials, [label]: 'Custom' });
                    }}
                    min={0}
                    max={1}
                    step={0.01}
                    className="h-7 text-[11px]"
                    data-testid={`input-weight-${label}`}
                  />
                </div>
              </div>
            </div>
          ))}
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
