import { useEffect, useMemo, useRef, useState } from 'react';
import { Atom, Dna, FlaskConical, Info, Loader2, Play, RotateCcw, Sparkles } from 'lucide-react';
import type { AcademicMemory, StudyResource, Subject } from '../types';
import { runSubjectLab } from '../services/geminiApi';
import { awardLearningXp } from '../services/studyDb';
import { MarkdownView } from './MarkdownView';

interface ScienceLabViewProps {
  uid: string;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
  resources: StudyResource[];
}

type LabDiscipline = 'physics' | 'chemistry' | 'biology';

const ELEMENTS_FIRST_20 = [
  { z: 1, symbol: 'H', name: 'Hydrogen', mass: 1.008 },
  { z: 2, symbol: 'He', name: 'Helium', mass: 4.003 },
  { z: 3, symbol: 'Li', name: 'Lithium', mass: 6.94 },
  { z: 4, symbol: 'Be', name: 'Beryllium', mass: 9.012 },
  { z: 5, symbol: 'B', name: 'Boron', mass: 10.81 },
  { z: 6, symbol: 'C', name: 'Carbon', mass: 12.011 },
  { z: 7, symbol: 'N', name: 'Nitrogen', mass: 14.007 },
  { z: 8, symbol: 'O', name: 'Oxygen', mass: 15.999 },
  { z: 9, symbol: 'F', name: 'Fluorine', mass: 18.998 },
  { z: 10, symbol: 'Ne', name: 'Neon', mass: 20.18 },
  { z: 11, symbol: 'Na', name: 'Sodium', mass: 22.99 },
  { z: 12, symbol: 'Mg', name: 'Magnesium', mass: 24.305 },
  { z: 13, symbol: 'Al', name: 'Aluminum', mass: 26.982 },
  { z: 14, symbol: 'Si', name: 'Silicon', mass: 28.085 },
  { z: 15, symbol: 'P', name: 'Phosphorus', mass: 30.974 },
  { z: 16, symbol: 'S', name: 'Sulfur', mass: 32.06 },
  { z: 17, symbol: 'Cl', name: 'Chlorine', mass: 35.45 },
  { z: 18, symbol: 'Ar', name: 'Argon', mass: 39.948 },
  { z: 19, symbol: 'K', name: 'Potassium', mass: 39.098 },
  { z: 20, symbol: 'Ca', name: 'Calcium', mass: 40.078 },
];

export function ScienceLabView({ uid, academicMemory, subjects }: ScienceLabViewProps) {
  const [discipline, setDiscipline] = useState<LabDiscipline>('physics');

  // --- Physics: Projectile Motion Simulator ---
  const [velocity, setVelocity] = useState(28);
  const [angleDeg, setAngleDeg] = useState(45);
  const [gravity, setGravity] = useState(9.81);
  const [massKg, setMassKg] = useState(2);
  const [simPlaying, setSimPlaying] = useState(false);
  const [simTime, setSimTime] = useState(0);
  const physicsCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const physicsMetrics = useMemo(() => {
    const rad = (angleDeg * Math.PI) / 180;
    const vx = velocity * Math.cos(rad);
    const vy0 = velocity * Math.sin(rad);
    const flightTime = (2 * vy0) / Math.max(0.5, gravity);
    const maxHeight = (vy0 * vy0) / (2 * Math.max(0.5, gravity));
    const range = vx * flightTime;
    const clampedT = Math.min(simTime, flightTime);
    const x = vx * clampedT;
    const y = Math.max(0, vy0 * clampedT - 0.5 * gravity * clampedT * clampedT);
    const vy = vy0 - gravity * clampedT;
    const speed = Math.sqrt(vx * vx + vy * vy);
    const ke = 0.5 * massKg * speed * speed;
    const pe = massKg * gravity * y;
    return { flightTime, maxHeight, range, x, y, ke, pe, speed };
  }, [velocity, angleDeg, gravity, massKg, simTime]);

  useEffect(() => {
    if (!simPlaying) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setSimTime((prev) => {
        const next = prev + dt;
        if (next >= physicsMetrics.flightTime) {
          setSimPlaying(false);
          return physicsMetrics.flightTime;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [simPlaying, physicsMetrics.flightTime]);

  useEffect(() => {
    const canvas = physicsCanvasRef.current;
    if (!canvas || discipline !== 'physics') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Subtle grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
    ctx.lineWidth = 1;
    for (let gx = 40; gx < w; gx += 50) {
      ctx.beginPath();
      ctx.moveTo(gx, 16);
      ctx.lineTo(gx, h - 28);
      ctx.stroke();
    }
    for (let gy = 30; gy < h - 28; gy += 40) {
      ctx.beginPath();
      ctx.moveTo(40, gy);
      ctx.lineTo(w - 16, gy);
      ctx.stroke();
    }

    // Ground baseline
    const groundY = h - 28;
    const originX = 44;
    ctx.strokeStyle = '#64748B';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(originX, groundY);
    ctx.lineTo(w - 16, groundY);
    ctx.stroke();

    const maxR = Math.max(40, physicsMetrics.range * 1.15);
    const maxH = Math.max(20, physicsMetrics.maxHeight * 1.25);
    const scaleX = (w - 76) / maxR;
    const scaleY = (groundY - 26) / maxH;
    const scale = Math.min(scaleX, scaleY * 1.1);

    // Predicted dashed parabolic path
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = '#6366F1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const rad = (angleDeg * Math.PI) / 180;
    const vx = velocity * Math.cos(rad);
    const vy0 = velocity * Math.sin(rad);
    for (let i = 0; i <= 50; i++) {
      const t = (physicsMetrics.flightTime * i) / 50;
      const px = originX + vx * t * scale;
      const py = groundY - Math.max(0, vy0 * t - 0.5 * gravity * t * t) * scale;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();

    // Projectile sphere
    const ballX = originX + physicsMetrics.x * scale;
    const ballY = groundY - physicsMetrics.y * scale;
    ctx.fillStyle = '#4F46E5';
    ctx.beginPath();
    ctx.arc(ballX, ballY, 8, 0, Math.PI * 2);
    ctx.fill();

    // Labels
    ctx.fillStyle = '#64748B';
    ctx.font = '11px ui-monospace, monospace';
    ctx.fillText(`Range: ${physicsMetrics.range.toFixed(1)}m`, originX + 6, 20);
    ctx.fillText(`Peak: ${physicsMetrics.maxHeight.toFixed(1)}m`, originX + 135, 20);
  }, [discipline, physicsMetrics, angleDeg, velocity, gravity]);

  // --- Chemistry: Bohr Atom & Collision Kinetics ---
  const [atomicNumber, setAtomicNumber] = useState(6);
  const [temperatureC, setTemperatureC] = useState(25);
  const [molarity, setMolarity] = useState(1.0);
  const [catalystActive, setCatalystActive] = useState(false);

  const selectedElement = ELEMENTS_FIRST_20[atomicNumber - 1] || ELEMENTS_FIRST_20[5];
  const electronShells = useMemo(() => {
    const caps = [2, 8, 8, 2];
    let rem = atomicNumber;
    return caps
      .map((cap) => {
        const take = Math.min(rem, cap);
        rem -= take;
        return take;
      })
      .filter((n) => n > 0);
  }, [atomicNumber]);

  const relativeRate = useMemo(() => {
    const tempFactor = Math.pow(2, (temperatureC - 25) / 10);
    const catFactor = catalystActive ? 2.4 : 1.0;
    return Math.round(molarity * tempFactor * catFactor * 100) / 100;
  }, [temperatureC, molarity, catalystActive]);

  // --- Biology: Photosynthesis & Respiration Rate Explorer ---
  const [lightIntensity, setLightIntensity] = useState(65);
  const [co2Level, setCo2Level] = useState(55);
  const [bioTemp, setBioTemp] = useState(24);

  const bioRates = useMemo(() => {
    const tempBell = Math.max(0.1, Math.exp(-Math.pow((bioTemp - 27) / 14, 2)));
    const limitingFactor = Math.min(lightIntensity, co2Level * 1.05);
    const grossPhotosynthesis = Math.round(limitingFactor * tempBell);
    const respirationRate = Math.round(12 + Math.max(0, bioTemp) * 0.6);
    const netCarbonGain = grossPhotosynthesis - respirationRate;
    const limitingLabel =
      lightIntensity < co2Level - 8
        ? 'Light Intensity'
        : co2Level < lightIntensity - 8
          ? 'CO2 Concentration'
          : bioTemp < 15 || bioTemp > 38
            ? 'Enzyme Temperature'
            : 'Balanced Factors';
    return { grossPhotosynthesis, respirationRate, netCarbonGain, limitingLabel };
  }, [lightIntensity, co2Level, bioTemp]);

  // --- Gemini Lab Assistant ---
  const [labQuestion, setLabQuestion] = useState('');
  const [labLoading, setLabLoading] = useState(false);
  const [labExplanation, setLabExplanation] = useState('');
  const [labError, setLabError] = useState<string | null>(null);

  const handleAskLabAi = async (customTask?: string) => {
    const snapshot =
      discipline === 'physics'
        ? `Projectile simulation parameters: initial velocity = ${velocity} m/s, launch angle = ${angleDeg}°, gravity = ${gravity} m/s², mass = ${massKg} kg. Computed range = ${physicsMetrics.range.toFixed(2)} m, max height = ${physicsMetrics.maxHeight.toFixed(2)} m, flight time = ${physicsMetrics.flightTime.toFixed(2)} s.`
        : discipline === 'chemistry'
          ? `Atomic model: ${selectedElement.name} (${selectedElement.symbol}, Z=${selectedElement.z}), shells [${electronShells.join(', ')}]. Kinetics parameters: T=${temperatureC}°C, [${molarity} M], catalyst=${catalystActive ? 'ON' : 'OFF'}, relative rate=${relativeRate}x.`
          : `Photosynthesis & respiration model: light=${lightIntensity}%, CO2=${co2Level}%, temp=${bioTemp}°C. Gross photosynthesis index=${bioRates.grossPhotosynthesis}, respiration=${bioRates.respirationRate}, net carbon gain=${bioRates.netCarbonGain}, limiting factor=${bioRates.limitingLabel}.`;

    const promptText = customTask || labQuestion.trim() || 'Explain the underlying scientific principles and equations behind these current simulation parameters.';
    setLabLoading(true);
    setLabError(null);
    try {
      const res = await runSubjectLab({
        domain: discipline === 'physics' ? 'Physics' : discipline === 'chemistry' ? 'Chemistry' : 'Biology',
        task: promptText,
        input: `${snapshot}\n\nStudent Question: ${promptText}\nSubjects studied: ${subjects.map((s) => s.name).join(', ') || 'General Science'}`,
      });
      setLabExplanation(res.result);
      await awardLearningXp(uid, academicMemory, 15);
    } catch (err) {
      setLabError(err instanceof Error ? err.message : 'Unable to analyze simulation.');
    } finally {
      setLabLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Honest Disclaimer */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Interactive Science Lab
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Hands-on physics kinematics, atomic structure & reaction kinetics, and biological pathway simulations paired with Gemini explanations.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 self-start">
          {[
            { id: 'physics' as const, label: 'Physics', icon: Atom },
            { id: 'chemistry' as const, label: 'Chemistry', icon: FlaskConical },
            { id: 'biology' as const, label: 'Biology', icon: Dna },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setDiscipline(item.id);
                  setLabExplanation('');
                }}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  discipline === item.id
                    ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 px-4 py-2.5 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
        <span>
          <strong>Educational Simulation Notice:</strong> These interactive models illustrate idealized physical, chemical, and biological relationships for conceptual learning and revision. They do not replace physical laboratory equipment or certified experimental protocols.
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Interactive Simulation Canvas / Controls */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5">
          {discipline === 'physics' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    Projectile Kinematics & Energy Conservation
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    v₀ = {velocity} m/s · θ = {angleDeg}° · g = {gravity} m/s² · KE = {physicsMetrics.ke.toFixed(0)} J · PE = {physicsMetrics.pe.toFixed(0)} J
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSimTime(0);
                      setSimPlaying(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Launch
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSimPlaying(false);
                      setSimTime(0);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                </div>
              </div>

              <canvas
                ref={physicsCanvasRef}
                width={640}
                height={260}
                className="w-full h-60 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <div className="flex justify-between mb-1 text-slate-700 dark:text-slate-300">
                    <span>Initial Velocity (m/s)</span>
                    <span className="font-mono tabular-nums">{velocity} m/s</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    value={velocity}
                    onChange={(e) => {
                      setVelocity(Number(e.target.value));
                      setSimTime(0);
                    }}
                    className="w-full accent-indigo-600"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1 text-slate-700 dark:text-slate-300">
                    <span>Launch Angle (°)</span>
                    <span className="font-mono tabular-nums">{angleDeg}°</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={85}
                    value={angleDeg}
                    onChange={(e) => {
                      setAngleDeg(Number(e.target.value));
                      setSimTime(0);
                    }}
                    className="w-full accent-indigo-600"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1 text-slate-700 dark:text-slate-300">
                    <span>Gravity (m/s²)</span>
                    <span className="font-mono tabular-nums">{gravity}</span>
                  </div>
                  <input
                    type="range"
                    min={1.6}
                    max={24.8}
                    step={0.2}
                    value={gravity}
                    onChange={(e) => {
                      setGravity(Number(e.target.value));
                      setSimTime(0);
                    }}
                    className="w-full accent-indigo-600"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1 text-slate-700 dark:text-slate-300">
                    <span>Mass (kg)</span>
                    <span className="font-mono tabular-nums">{massKg} kg</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={20}
                    value={massKg}
                    onChange={(e) => setMassKg(Number(e.target.value))}
                    className="w-full accent-indigo-600"
                  />
                </div>
              </div>
            </>
          )}

          {discipline === 'chemistry' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    Bohr Atomic Builder & Reaction Kinetics
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {selectedElement.name} ({selectedElement.symbol}) · Atomic # {selectedElement.z} · Shells [{electronShells.join(', ')}] · Valence e⁻: {electronShells[electronShells.length - 1]}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-center">
                <div className="flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-4">
                  <svg viewBox="0 0 220 220" className="w-48 h-48">
                    <circle cx="110" cy="110" r="18" fill="#4F46E5" />
                    <text x="110" y="114" textAnchor="middle" fill="#FFFFFF" fontSize="11" fontWeight="bold">
                      {selectedElement.symbol}
                    </text>
                    {electronShells.map((count, sIdx) => {
                      const radius = 34 + sIdx * 21;
                      return (
                        <g key={sIdx}>
                          <circle
                            cx="110"
                            cy="110"
                            r={radius}
                            fill="none"
                            stroke="rgba(99,102,241,0.35)"
                            strokeWidth="1.2"
                          />
                          {Array.from({ length: count }).map((_, eIdx) => {
                            const theta = (2 * Math.PI * eIdx) / count - Math.PI / 2;
                            const ex = 110 + radius * Math.cos(theta);
                            const ey = 110 + radius * Math.sin(theta);
                            return <circle key={eIdx} cx={ex} cy={ey} r="3.6" fill="#06B6D4" />;
                          })}
                        </g>
                      );
                    })}
                  </svg>
                </div>

                <div className="space-y-4 text-xs">
                  <div>
                    <div className="flex justify-between mb-1 text-slate-700 dark:text-slate-300">
                      <span>Atomic Number (Z)</span>
                      <span className="font-mono tabular-nums">
                        {selectedElement.z} ({selectedElement.symbol})
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={20}
                      value={atomicNumber}
                      onChange={(e) => setAtomicNumber(Number(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1 text-slate-700 dark:text-slate-300">
                      <span>Reaction Temp (°C)</span>
                      <span className="font-mono tabular-nums">{temperatureC}°C</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={80}
                      value={temperatureC}
                      onChange={(e) => setTemperatureC(Number(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1 text-slate-700 dark:text-slate-300">
                      <span>Reactant Concentration (M)</span>
                      <span className="font-mono tabular-nums">{molarity.toFixed(1)} M</span>
                    </div>
                    <input
                      type="range"
                      min={0.2}
                      max={3.0}
                      step={0.2}
                      value={molarity}
                      onChange={(e) => setMolarity(Number(e.target.value))}
                      className="w-full accent-indigo-600"
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={catalystActive}
                      onChange={(e) => setCatalystActive(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600"
                    />
                    Add Catalyst (lowers activation energy)
                  </label>
                  <div className="rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900/50 p-3">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Relative Collision Reaction Rate</p>
                    <p className="font-display text-lg font-bold text-indigo-700 dark:text-indigo-300 tabular-nums">
                      {relativeRate}x baseline
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {discipline === 'biology' && (
            <>
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Photosynthesis & Cellular Respiration Limiting-Factor Model
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Explore how light irradiance, CO₂ availability, and enzyme temperature affect net carbon assimilation.
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Photosynthesis</p>
                  <p className="font-display text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">
                    {bioRates.grossPhotosynthesis}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Respiration</p>
                  <p className="font-display text-xl font-bold text-amber-600 dark:text-amber-400 tabular-nums mt-1">
                    {bioRates.respirationRate}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Net Carbon Gain</p>
                  <p
                    className={`font-display text-xl font-bold tabular-nums mt-1 ${
                      bioRates.netCarbonGain >= 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-rose-600'
                    }`}
                  >
                    {bioRates.netCarbonGain >= 0 ? `+${bioRates.netCarbonGain}` : bioRates.netCarbonGain}
                  </p>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300">
                Primary Limiting Factor: <strong className="text-slate-900 dark:text-white">{bioRates.limitingLabel}</strong>
              </p>

              <div className="space-y-3 text-xs">
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Light Intensity</span>
                    <span className="font-mono tabular-nums">{lightIntensity}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={lightIntensity}
                    onChange={(e) => setLightIntensity(Number(e.target.value))}
                    className="w-full accent-indigo-600"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>CO₂ Availability</span>
                    <span className="font-mono tabular-nums">{co2Level}%</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    value={co2Level}
                    onChange={(e) => setCo2Level(Number(e.target.value))}
                    className="w-full accent-indigo-600"
                  />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span>Ambient Temperature</span>
                    <span className="font-mono tabular-nums">{bioTemp}°C</span>
                  </div>
                  <input
                    type="range"
                    min={2}
                    max={48}
                    value={bioTemp}
                    onChange={(e) => setBioTemp(Number(e.target.value))}
                    className="w-full accent-indigo-600"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Gemini Lab Analysis Panel */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4 flex flex-col">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Gemini Lab Interpreter
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Ask Gemini to derive equations, explain why your current parameters behave this way, or test your prediction.
            </p>
          </div>

          <div className="space-y-2">
            <textarea
              rows={3}
              value={labQuestion}
              onChange={(e) => setLabQuestion(e.target.value)}
              placeholder="e.g. Why does changing angle above 45° shorten horizontal range on flat ground?"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleAskLabAi()}
                disabled={labLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-60"
              >
                {labLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {labLoading ? 'Analyzing State...' : 'Analyze Current Simulation'}
              </button>
              <button
                type="button"
                onClick={() => void handleAskLabAi('Create one exam-style calculation or prediction question based on these exact parameters and explain its solution step by step.')}
                disabled={labLoading}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                Test Me on This State
              </button>
            </div>
          </div>

          {labError && <p className="text-xs text-rose-600">{labError}</p>}

          <div className="flex-1 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 overflow-y-auto min-h-[220px]">
            {labExplanation ? (
              <MarkdownView content={labExplanation} className="text-sm" />
            ) : (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Adjust any slider on the left and click <strong>Analyze Current Simulation</strong> for a live Gemini breakdown grounded in the exact variables on screen.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
