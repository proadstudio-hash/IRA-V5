import { useState } from "react";
import { Plus, Trash2, Thermometer } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import type { RoomDimensions, SpeakerConfig, Point3D, AnalysisSettings } from "@shared/schema";
import { MATERIAL_PRESETS } from "@shared/schema";
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
              label="Height (Z)"
              value={room.height}
              onChange={(v) => onRoomChange({ ...room, height: v })}
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
