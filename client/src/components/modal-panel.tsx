import { useState, useMemo, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Target, MapPin, TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Legend, Tooltip } from "recharts";
import type { RoomDimensions, Point3D, CeilingConfig, IRData, ModalAnalysisResult, PressureMapData, FusionIRDataset, SeatCandidate, SpeakerConfig } from "@shared/schema";
import { runModalAnalysis, computePressureMap, computeDrivenResponse } from "@/lib/modal-analysis";

interface ModalPanelProps {
  room: RoomDimensions;
  ceiling?: CeilingConfig;
  speakers: SpeakerConfig[];
  micPos: Point3D;
  mic2Position?: Point3D | null;
  irData: IRData;
  speedOfSound: number;
  fusionDatasets?: FusionIRDataset[];
  onResult?: (result: ModalAnalysisResult) => void;
}

function pressureColor(dB: number, minDB: number, maxDB: number): string {
  if (dB <= -998) return 'rgba(200,200,200,0.3)';
  const range = maxDB - minDB || 1;
  const t = Math.max(0, Math.min(1, (dB - minDB) / range));
  let r: number, g: number, b: number;
  if (t < 0.5) {
    const s = t / 0.5;
    r = 0;
    g = Math.round(255 * s);
    b = Math.round(255 * (1 - s));
  } else {
    const s = (t - 0.5) / 0.5;
    r = Math.round(255 * s);
    g = Math.round(255 * (1 - s));
    b = 0;
  }
  return `rgb(${r},${g},${b})`;
}

function PressureMapSVG({ data, title, room, speakers, micPos, mic2Position, ceiling, bestSeat, seatCandidates, selectedCandidateIdx }: {
  data: PressureMapData;
  title: string;
  room: RoomDimensions;
  speakers: SpeakerConfig[];
  micPos?: Point3D;
  mic2Position?: Point3D | null;
  ceiling?: CeilingConfig;
  bestSeat?: SeatCandidate;
  seatCandidates?: SeatCandidate[];
  selectedCandidateIdx?: number;
}) {
  const padL = 44;
  const padR = 30;
  const padT = 22;
  const padB = 32;
  const maxDrawW = 260;
  const maxDrawH = 200;

  const uLen = data.uRange[1] - data.uRange[0];
  const vLen = data.vRange[1] - data.vRange[0];
  const isTop = title.includes('Top');

  const displayAspect = isTop ? vLen / uLen : uLen / vLen;

  let drawW: number, drawH: number;
  if (displayAspect >= 1) {
    drawW = maxDrawW;
    drawH = maxDrawW / displayAspect;
    if (drawH > maxDrawH) { drawH = maxDrawH; drawW = maxDrawH * displayAspect; }
  } else {
    drawH = maxDrawH;
    drawW = maxDrawH * displayAspect;
    if (drawW > maxDrawW) { drawW = maxDrawW; drawH = maxDrawW / displayAspect; }
  }

  const svgWidth = padL + drawW + padR;
  const svgHeight = padT + drawH + padB;

  const toScreenX = isTop
    ? (y: number) => padL + (1 - (y - data.vRange[0]) / vLen) * drawW
    : (x: number) => padL + ((x - data.uRange[0]) / uLen) * drawW;
  const toScreenY = isTop
    ? (x: number) => padT + ((x - data.uRange[0]) / uLen) * drawH
    : (z: number) => padT + (1 - (z - data.vRange[0]) / vLen) * drawH;

  const cellWTop = drawW / data.gridHeight;
  const cellHTop = drawH / data.gridWidth;
  const cellWSide = drawW / data.gridWidth;
  const cellHSide = drawH / data.gridHeight;

  return (
    <svg width={svgWidth} height={svgHeight} className="border rounded" data-testid={`pressure-map-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <text x={padL + drawW / 2} y={14} textAnchor="middle" fontSize="10" fontWeight="bold" fill="currentColor">
        {title}
      </text>

      {data.grid.map((row, j) =>
        row.map((cell, i) => {
          const rx = isTop ? padL + (data.gridHeight - 1 - j) * cellWTop : padL + i * cellWSide;
          const ry = isTop ? padT + i * cellHTop : padT + (data.gridHeight - 1 - j) * cellHSide;
          const rw = isTop ? cellWTop + 0.5 : cellWSide + 0.5;
          const rh = isTop ? cellHTop + 0.5 : cellHSide + 0.5;
          return (
            <rect
              key={`${j}-${i}`}
              x={rx} y={ry}
              width={rw} height={rh}
              fill={pressureColor(cell, data.minVal, data.maxVal)}
            />
          );
        })
      )}

      <rect x={padL} y={padT} width={drawW} height={drawH} fill="none" stroke="currentColor" strokeWidth="1" strokeOpacity="0.3" />

      {isTop && (
        <>
          {speakers.map((spk, si) => (
            <g key={spk.id}>
              <circle cx={toScreenX(spk.position.y)} cy={toScreenY(spk.position.x)} r="5" fill="#e74c3c" stroke="#fff" strokeWidth="1" />
              <text x={toScreenX(spk.position.y) + 7} y={toScreenY(spk.position.x) + 3} fontSize="7" fill="#e74c3c" fontWeight="bold">
                {speakers.length > 1 ? `S${si + 1}` : 'S'}
              </text>
            </g>
          ))}
          {micPos && (
            <>
              <circle cx={toScreenX(micPos.y)} cy={toScreenY(micPos.x)} r="4" fill="#3498db" stroke="#fff" strokeWidth="1" />
              <text x={toScreenX(micPos.y) + 7} y={toScreenY(micPos.x) + 3} fontSize="7" fill="#3498db" fontWeight="bold">M1</text>
            </>
          )}
          {mic2Position && (
            <>
              <circle cx={toScreenX(mic2Position.y)} cy={toScreenY(mic2Position.x)} r="4" fill="#8e44ad" stroke="#fff" strokeWidth="1" />
              <text x={toScreenX(mic2Position.y) + 7} y={toScreenY(mic2Position.x) + 3} fontSize="7" fill="#8e44ad" fontWeight="bold">M2</text>
            </>
          )}
        </>
      )}
      {title.includes('Side') && (
        <>
          {speakers.map((spk, si) => (
            <g key={spk.id}>
              <circle cx={toScreenX(spk.position.x)} cy={toScreenY(spk.position.z)} r="5" fill="#e74c3c" stroke="#fff" strokeWidth="1" />
              <text x={toScreenX(spk.position.x) + 7} y={toScreenY(spk.position.z) + 3} fontSize="7" fill="#e74c3c" fontWeight="bold">
                {speakers.length > 1 ? `S${si + 1}` : 'S'}
              </text>
            </g>
          ))}
          {micPos && (
            <>
              <circle cx={toScreenX(micPos.x)} cy={toScreenY(micPos.z)} r="4" fill="#3498db" stroke="#fff" strokeWidth="1" />
              <text x={toScreenX(micPos.x) + 7} y={toScreenY(micPos.z) + 3} fontSize="7" fill="#3498db" fontWeight="bold">M1</text>
            </>
          )}
          {mic2Position && (
            <>
              <circle cx={toScreenX(mic2Position.x)} cy={toScreenY(mic2Position.z)} r="4" fill="#8e44ad" stroke="#fff" strokeWidth="1" />
              <text x={toScreenX(mic2Position.x) + 7} y={toScreenY(mic2Position.z) + 3} fontSize="7" fill="#8e44ad" fontWeight="bold">M2</text>
            </>
          )}
        </>
      )}

      {seatCandidates && seatCandidates.length > 0 && isTop && seatCandidates.slice(0, 5).map((cand, ci) => {
        const sx = toScreenX(cand.y);
        const sy = toScreenY(cand.x);
        const isSelected = ci === (selectedCandidateIdx ?? 0);
        const starR = isSelected ? 8 : 5;
        const pts = Array.from({ length: 10 }, (_, i) => {
          const angle = -Math.PI / 2 + (i * Math.PI / 5);
          const r = i % 2 === 0 ? starR : starR * 0.4;
          return `${sx + r * Math.cos(angle)},${sy + r * Math.sin(angle)}`;
        }).join(' ');
        return (
          <g key={`seat-top-${ci}`}>
            <polygon points={pts}
              fill={isSelected ? '#ffd700' : 'none'}
              stroke={isSelected ? '#b8860b' : '#b8860b'}
              strokeWidth={isSelected ? 1.5 : 1}
              opacity={isSelected ? 1 : 0.6} />
            <text x={sx + (isSelected ? 10 : 7)} y={sy + 3} fontSize="7"
              fill="#b8860b" fontWeight={isSelected ? 'bold' : 'normal'}>
              #{ci + 1}
            </text>
          </g>
        );
      })}
      {seatCandidates && seatCandidates.length > 0 && title.includes('Side') && seatCandidates.slice(0, 5).map((cand, ci) => {
        const sx = toScreenX(cand.x);
        const sy = toScreenY(cand.z);
        const isSelected = ci === (selectedCandidateIdx ?? 0);
        const starR = isSelected ? 8 : 5;
        const pts = Array.from({ length: 10 }, (_, i) => {
          const angle = -Math.PI / 2 + (i * Math.PI / 5);
          const r = i % 2 === 0 ? starR : starR * 0.4;
          return `${sx + r * Math.cos(angle)},${sy + r * Math.sin(angle)}`;
        }).join(' ');
        return (
          <g key={`seat-side-${ci}`}>
            <polygon points={pts}
              fill={isSelected ? '#ffd700' : 'none'}
              stroke={isSelected ? '#b8860b' : '#b8860b'}
              strokeWidth={isSelected ? 1.5 : 1}
              opacity={isSelected ? 1 : 0.6} />
            <text x={sx + (isSelected ? 10 : 7)} y={sy + 3} fontSize="7"
              fill="#b8860b" fontWeight={isSelected ? 'bold' : 'normal'}>
              #{ci + 1}
            </text>
          </g>
        );
      })}

      <text x={padL + drawW / 2} y={svgHeight - 4} textAnchor="middle" fontSize="8" fill="currentColor" fillOpacity="0.5">
        {isTop ? data.vAxis : data.uAxis} ({(isTop ? vLen : uLen).toFixed(1)}m)
      </text>
      <text transform={`translate(10, ${padT + drawH / 2}) rotate(-90)`} textAnchor="middle" fontSize="8" fill="currentColor" fillOpacity="0.5">
        {isTop ? data.uAxis : data.vAxis} ({(isTop ? uLen : vLen).toFixed(1)}m)
      </text>

      {[0, 0.25, 0.5, 0.75, 1].map((v, i) => {
        const dB = data.minVal + v * (data.maxVal - data.minVal);
        return (
          <g key={`cb-${i}`}>
            <rect x={svgWidth - 25} y={padT + (1 - v) * drawH - 2} width={12} height={drawH * 0.25 + 4} fill={pressureColor(dB, data.minVal, data.maxVal)} />
          </g>
        );
      })}
      <text x={svgWidth - 12} y={padT - 4} textAnchor="middle" fontSize="7" fill="currentColor" fillOpacity="0.5">
        {data.maxVal.toFixed(0)}
      </text>
      <text x={svgWidth - 12} y={padT + drawH + 8} textAnchor="middle" fontSize="7" fill="currentColor" fillOpacity="0.5">
        {data.minVal.toFixed(0)}
      </text>
    </svg>
  );
}

export function ModalPanel({ room, ceiling, speakers, micPos, mic2Position, irData, speedOfSound, fusionDatasets, onResult }: ModalPanelProps) {
  const sourcePos = speakers[0]?.position ?? { x: 0, y: 0, z: 0 };
  const [fMin, setFMin] = useState(20);
  const [fMax, setFMax] = useState(200);
  const [earHeight, setEarHeight] = useState(1.2);
  const [selectedModeIdx, setSelectedModeIdx] = useState(0);
  const [viewMode, setViewMode] = useState<'single' | 'driven'>('driven');
  const [hasRun, setHasRun] = useState(false);
  const [result, setResult] = useState<ModalAnalysisResult | null>(null);

  const allSpeakerPositions = useMemo(() => speakers.map(s => s.position), [speakers]);

  const runAnalysis = useCallback(() => {
    const res = runModalAnalysis(room, ceiling, sourcePos, micPos, irData, speedOfSound, fMin, fMax, earHeight, fusionDatasets, allSpeakerPositions);
    setResult(res);
    setSelectedModeIdx(0);
    setHasRun(true);
    onResult?.(res);
  }, [room, ceiling, sourcePos, micPos, irData, speedOfSound, fMin, fMax, earHeight, fusionDatasets, onResult, allSpeakerPositions]);

  const currentPressureMaps = useMemo(() => {
    if (!result || result.modes.length === 0) return null;
    const freq = viewMode === 'single' && result.modes[selectedModeIdx]
      ? result.modes[selectedModeIdx].frequency
      : result.modes[0]?.frequency ?? fMin;
    const top = computePressureMap(result.modes, room, sourcePos, freq, 'top', earHeight, 40, ceiling);
    const side = computePressureMap(result.modes, room, sourcePos, freq, 'side', room.width / 2, 40, ceiling);
    return { top, side, freq };
  }, [result, selectedModeIdx, viewMode, room, sourcePos, earHeight, ceiling, fMin]);

  const freqResponseData = useMemo(() => {
    if (!result) return [];
    const freqs: number[] = [];
    for (let i = 0; i < 200; i++) freqs.push(fMin + (fMax - fMin) * i / 199);
    const response = computeDrivenResponse(result.modes, room, sourcePos, micPos, freqs, ceiling);
    return response;
  }, [result, room, sourcePos, micPos, ceiling, fMin, fMax]);

  return (
    <div className="space-y-4" data-testid="modal-panel">
      <div className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-primary" />
        <h3 className="text-sm font-semibold">Room Modal Analysis</h3>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
          <div>
            <Label className="text-xs" htmlFor="modal-fmin">Min Freq (Hz)</Label>
            <Input id="modal-fmin" type="number" value={fMin} onChange={e => setFMin(Number(e.target.value))}
              min={10} max={100} step={5} className="h-8 text-xs" data-testid="input-modal-fmin" />
          </div>
          <div>
            <Label className="text-xs" htmlFor="modal-fmax">Max Freq (Hz)</Label>
            <Input id="modal-fmax" type="number" value={fMax} onChange={e => setFMax(Number(e.target.value))}
              min={50} max={500} step={10} className="h-8 text-xs" data-testid="input-modal-fmax" />
          </div>
          <div>
            <Label className="text-xs" htmlFor="modal-ear">Ear Height (m)</Label>
            <Input id="modal-ear" type="number" value={earHeight} onChange={e => setEarHeight(Number(e.target.value))}
              min={0.5} max={2.5} step={0.05} className="h-8 text-xs" data-testid="input-modal-ear" />
          </div>
          <div>
            <Label className="text-xs">View</Label>
            <Select value={viewMode} onValueChange={(v: 'single' | 'driven') => setViewMode(v)}>
              <SelectTrigger className="h-8 text-xs" data-testid="select-modal-view">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="driven">All Modes (Driven)</SelectItem>
                <SelectItem value="single">Single Mode</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Button onClick={runAnalysis} size="sm" className="w-full h-8 text-xs" data-testid="button-run-modal">
              <TrendingUp className="w-3 h-3 mr-1" /> Analyze Modes
            </Button>
          </div>
        </div>
        {fusionDatasets && fusionDatasets.length > 0 && (
          <div className="mt-2 text-[10px] text-muted-foreground">
            Using {1 + fusionDatasets.length} IR measurements (main + {fusionDatasets.length} fusion) for modal peak extraction.
          </div>
        )}
      </Card>

      {hasRun && result && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Card className="p-3">
              <div className="text-[10px] text-muted-foreground mb-1">Predicted Modes</div>
              <div className="text-lg font-bold" data-testid="text-mode-count">{result.modes.length}</div>
            </Card>
            <Card className="p-3">
              <div className="text-[10px] text-muted-foreground mb-1">IR Peaks Matched</div>
              <div className="text-lg font-bold" data-testid="text-matched-count">
                {result.modes.filter(m => m.matched).length} / {result.measuredPeaks.length}
              </div>
            </Card>
            <Card className="p-3">
              <div className="text-[10px] text-muted-foreground mb-1">Schroeder Freq</div>
              <div className="text-lg font-bold" data-testid="text-schroeder">{result.schroederFreq.toFixed(0)} Hz</div>
            </Card>
          </div>

          <Card className="p-4">
            <h4 className="text-xs font-semibold mb-2 flex items-center gap-1">
              <Activity className="w-3 h-3" /> Modal Frequency Response at Mic Position
            </h4>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={freqResponseData} margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="freq" type="number" domain={[fMin, fMax]} tick={{ fontSize: 9 }}
                    label={{ value: 'Frequency (Hz)', position: 'insideBottom', offset: -2, fontSize: 9 }} />
                  <YAxis tick={{ fontSize: 9 }} label={{ value: 'dB', angle: -90, position: 'insideLeft', fontSize: 9 }} />
                  <Tooltip formatter={(v: number) => `${v.toFixed(1)} dB`} labelFormatter={(l: number) => `${l.toFixed(1)} Hz`} />
                  <Line type="monotone" dataKey="dB" stroke="hsl(var(--primary))" dot={false} strokeWidth={1.5} />
                  {result.modes.filter(m => m.matched).map((mode, i) => (
                    <ReferenceLine key={`mode-${i}`} x={mode.frequency} stroke="hsl(var(--destructive))"
                      strokeDasharray="2 2" strokeOpacity={0.5} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="p-4">
            <h4 className="text-xs font-semibold mb-2">Room Modes Table</h4>
            {viewMode === 'single' && result.modes.length > 0 && (
              <div className="mb-2">
                <Select value={String(selectedModeIdx)} onValueChange={v => setSelectedModeIdx(Number(v))}>
                  <SelectTrigger className="h-7 text-xs w-64" data-testid="select-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {result.modes.map((mode, i) => (
                      <SelectItem key={i} value={String(i)}>
                        ({mode.n},{mode.m},{mode.l}) - {mode.frequency.toFixed(1)} Hz - {mode.type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b">
                    <th className="text-left py-1 px-1">(n,m,l)</th>
                    <th className="text-left py-1 px-1">Freq (Hz)</th>
                    <th className="text-left py-1 px-1">Type</th>
                    <th className="text-left py-1 px-1">IR Peak</th>
                    <th className="text-left py-1 px-1">Q</th>
                    <th className="text-left py-1 px-1">T60 (s)</th>
                    <th className="text-left py-1 px-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.modes.map((mode, i) => (
                    <tr key={i} className={`border-b border-border/50 cursor-pointer hover:bg-muted/50 ${selectedModeIdx === i ? 'bg-primary/10' : ''}`}
                      onClick={() => { setSelectedModeIdx(i); setViewMode('single'); }}
                      data-testid={`row-mode-${i}`}>
                      <td className="py-0.5 px-1 font-mono">({mode.n},{mode.m},{mode.l})</td>
                      <td className="py-0.5 px-1">{mode.frequency.toFixed(1)}</td>
                      <td className="py-0.5 px-1">
                        <span className={`px-1 rounded text-[8px] ${
                          mode.type === 'axial' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                          mode.type === 'tangential' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                          'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                        }`}>
                          {mode.type}
                        </span>
                      </td>
                      <td className="py-0.5 px-1">{mode.measuredFreq ? mode.measuredFreq.toFixed(1) : '-'}</td>
                      <td className="py-0.5 px-1">{mode.Q.toFixed(1)}</td>
                      <td className="py-0.5 px-1">{mode.T60.toFixed(2)}</td>
                      <td className="py-0.5 px-1">
                        {mode.matched ? (
                          <span className="text-green-600 dark:text-green-400 text-[8px] font-semibold">Matched</span>
                        ) : (
                          <span className="text-muted-foreground text-[8px]">Predicted</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {currentPressureMaps && (
            <Card className="p-4">
              <h4 className="text-xs font-semibold mb-2 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Pressure Maps at {currentPressureMaps.freq.toFixed(1)} Hz
                {viewMode === 'single' && result.modes[selectedModeIdx] && (
                  <span className="text-muted-foreground ml-1">
                    — Mode ({result.modes[selectedModeIdx].n},{result.modes[selectedModeIdx].m},{result.modes[selectedModeIdx].l})
                  </span>
                )}
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <PressureMapSVG data={currentPressureMaps.top} title="Top View (ear height)" room={room}
                  speakers={speakers} micPos={micPos} mic2Position={mic2Position} ceiling={ceiling} />
                <PressureMapSVG data={currentPressureMaps.side} title="Side View (centerline)" room={room}
                  speakers={speakers} micPos={micPos} mic2Position={mic2Position} ceiling={ceiling} />
              </div>
              <div className="mt-1 text-[8px] text-muted-foreground text-center">
                Color: <span style={{color:'#0000ff'}}>Blue</span> = cancellation (null), <span style={{color:'#00aa00'}}>Green</span> = neutral, <span style={{color:'#ff0000'}}>Red</span> = resonance (high pressure). Scale in dB relative.
              </div>
            </Card>
          )}

          {result.globalPressureMapTop && result.globalPressureMapSide && (
            <Card className="p-4">
              <h4 className="text-xs font-semibold mb-2 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> Global Pressure Map (all modes, {result.fMin}–{result.fMax} Hz)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <PressureMapSVG data={result.globalPressureMapTop} title="Global Top View (ear height)" room={room}
                  speakers={speakers} micPos={micPos} mic2Position={mic2Position} ceiling={ceiling}
                  bestSeat={result.bestSeat} seatCandidates={result.seatCandidates} selectedCandidateIdx={0} />
                <PressureMapSVG data={result.globalPressureMapSide} title="Global Side View (centerline)" room={room}
                  speakers={speakers} micPos={micPos} mic2Position={mic2Position} ceiling={ceiling}
                  bestSeat={result.bestSeat} seatCandidates={result.seatCandidates} selectedCandidateIdx={0} />
              </div>
              <div className="mt-1 text-[8px] text-muted-foreground text-center">
                Broadband average of all modes. <span style={{color:'#0000ff'}}>Blue</span> = cancellation, <span style={{color:'#00aa00'}}>Green</span> = neutral, <span style={{color:'#ff0000'}}>Red</span> = resonance.
              </div>
            </Card>
          )}

          {result.bestSeat && (
            <Card className="p-4">
              <h4 className="text-xs font-semibold mb-2 flex items-center gap-1">
                <Target className="w-3 h-3" /> Optimal Listening Position
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-3">
                <div>
                  <div className="text-[9px] text-muted-foreground">Best X (Depth)</div>
                  <div className="text-sm font-bold" data-testid="text-best-seat-x">{result.bestSeat.x.toFixed(2)} m</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground">Best Y (Width)</div>
                  <div className="text-sm font-bold" data-testid="text-best-seat-y">{result.bestSeat.y.toFixed(2)} m</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground">Best Z (Height)</div>
                  <div className="text-sm font-bold" data-testid="text-best-seat-z">{result.bestSeat.z.toFixed(2)} m</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground">Score</div>
                  <div className="text-sm font-bold" data-testid="text-best-score">{result.bestSeat.score.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground">Flatness (Jvar)</div>
                  <div className="text-sm font-bold">{result.bestSeat.Jvar.toFixed(2)} dB</div>
                </div>
                <div>
                  <div className="text-[9px] text-muted-foreground">Null Penalty</div>
                  <div className="text-sm font-bold">{result.bestSeat.Jnull.toFixed(2)}</div>
                </div>
                {speakers.length >= 2 && (
                  <div>
                    <div className="text-[9px] text-muted-foreground">Stereo Sym.</div>
                    <div className="text-sm font-bold">{(result.bestSeat.Jsymmetry ?? 0).toFixed(2)}</div>
                  </div>
                )}
              </div>

              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart margin={{ top: 5, right: 10, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="freq" type="number" domain={[fMin, fMax]} tick={{ fontSize: 9 }}
                      label={{ value: 'Frequency (Hz)', position: 'insideBottom', offset: -2, fontSize: 9 }}
                      allowDuplicatedCategory={false} />
                    <YAxis tick={{ fontSize: 9 }} label={{ value: 'dB', angle: -90, position: 'insideLeft', fontSize: 9 }} />
                    <Tooltip formatter={(v: number) => `${v.toFixed(1)} dB`} labelFormatter={(l: number) => `${l.toFixed(1)} Hz`} />
                    <Legend wrapperStyle={{ fontSize: '9px' }} />
                    <Line data={result.bestSeat.responseCurve} type="monotone" dataKey="dB" name="Optimal Seat"
                      stroke="#27ae60" dot={false} strokeWidth={1.5} />
                    {result.currentSeatResponse && (
                      <Line data={result.currentSeatResponse} type="monotone" dataKey="dB" name="Current Mic"
                        stroke="#e74c3c" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {result.seatCandidates.length > 1 && (
                <div className="mt-2">
                  <div className="text-[9px] font-semibold mb-1">Top Candidates</div>
                  <div className="max-h-32 overflow-y-auto">
                    <table className="w-full text-[8px]">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b">
                          <th className="text-left py-0.5 px-1 font-semibold">Rank</th>
                          <th className="text-left py-0.5 px-1 font-semibold">X (m)</th>
                          <th className="text-left py-0.5 px-1 font-semibold">Y (m)</th>
                          <th className="text-left py-0.5 px-1 font-semibold">Z (m)</th>
                          <th className="text-left py-0.5 px-1 font-semibold">Score</th>
                          <th className="text-left py-0.5 px-1 font-semibold">Jvar</th>
                          <th className="text-left py-0.5 px-1 font-semibold">Jnull</th>
                          {speakers.length >= 2 && (
                            <th className="text-left py-0.5 px-1 font-semibold">Jsym</th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {result.seatCandidates.slice(0, 5).map((c, i) => (
                          <tr key={i} className="border-b border-border/50">
                            <td className="py-0.5 px-1">#{i + 1}</td>
                            <td className="py-0.5 px-1">{c.x.toFixed(2)}</td>
                            <td className="py-0.5 px-1">{c.y.toFixed(2)}</td>
                            <td className="py-0.5 px-1">{c.z.toFixed(2)}</td>
                            <td className="py-0.5 px-1">{c.score.toFixed(2)}</td>
                            <td className="py-0.5 px-1">{c.Jvar.toFixed(2)}</td>
                            <td className="py-0.5 px-1">{c.Jnull.toFixed(2)}</td>
                            {speakers.length >= 2 && (
                              <td className="py-0.5 px-1">{(c.Jsymmetry ?? 0).toFixed(2)}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          )}
        </>
      )}

      {!hasRun && (
        <Card className="p-4 text-center text-sm text-muted-foreground">
          Click "Analyze Modes" to compute room eigenmodes, extract modal parameters from the IR, and find the optimal listening position.
        </Card>
      )}
    </div>
  );
}
