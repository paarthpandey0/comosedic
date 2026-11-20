import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator,
  Code2,
  FlaskConical,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { analyzeMathCurve, reviewStemCode } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';

type SandboxTab = 'grapher' | 'units' | 'code';

interface PlotCurve {
  id: string;
  expr: string;
  color: string;
  enabled: boolean;
}

const CURVE_COLORS = ['#4F46E5', '#059669', '#D97706', '#DC2626'];

function compileMathExpr(raw: string): ((x: number) => number) | null {
  const cleaned = raw
    .trim()
    .replace(/\^/g, '**')
    .replace(/\bpi\b/gi, 'Math.PI')
    .replace(/\be\b/g, 'Math.E')
    .replace(/\b(sin|cos|tan|asin|acos|atan|sqrt|abs|log|ln|exp|floor|ceil|pow)\b/gi, (m) => {
      const lower = m.toLowerCase();
      if (lower === 'ln') return 'Math.log';
      if (lower === 'log') return 'Math.log10';
      return `Math.${lower}`;
    });

  // Allow only safe math characters and Math.* tokens
  const stripped = cleaned.replace(/Math\.(PI|E|sin|cos|tan|asin|acos|atan|sqrt|abs|log10|log|exp|floor|ceil|pow)/g, '');
  if (/[^0-9xX+\-*/().,\s]/.test(stripped)) {
    return null;
  }

  try {
    const fn = new Function('x', `"use strict"; return (${cleaned.replace(/X/g, 'x')});`) as (x: number) => number;
    const testVal = fn(1);
    if (typeof testVal !== 'number') return null;
    return fn;
  } catch {
    return null;
  }
}

function simpsonIntegral(fn: (x: number) => number, a: number, b: number, steps = 200): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return 0;
  const n = steps % 2 === 0 ? steps : steps + 1;
  const h = (b - a) / n;
  let sum = fn(a) + fn(b);
  if (!Number.isFinite(sum)) return null;
  for (let i = 1; i < n; i++) {
    const y = fn(a + i * h);
    if (!Number.isFinite(y)) return null;
    sum += (i % 2 === 0 ? 2 : 4) * y;
  }
  return (h / 3) * sum;
}

const UNIT_GROUPS: Record<string, Record<string, number>> = {
  Energy: {
    'Joules (J)': 1,
    'Kilojoules (kJ)': 1000,
    'Calories (cal)': 4.184,
    'Kilocalories (kcal)': 4184,
    'Kilowatt-hours (kWh)': 3600000,
    'Electronvolts (eV)': 1.602176634e-19,
  },
  Pressure: {
    'Pascals (Pa)': 1,
    'Kilopascals (kPa)': 1000,
    'Atmospheres (atm)': 101325,
    'Bar (bar)': 100000,
    'mmHg / Torr': 133.322368,
    'PSI': 6894.757,
  },
  Length: {
    'Nanometers (nm)': 1e-9,
    'Micrometers (um)': 1e-6,
    'Millimeters (mm)': 1e-3,
    'Meters (m)': 1,
    'Kilometers (km)': 1000,
    'Miles (mi)': 1609.344,
    'Astronomical Units (AU)': 1.495978707e11,
  },
  Mass: {
    'Milligrams (mg)': 1e-6,
    'Grams (g)': 1e-3,
    'Kilograms (kg)': 1,
    'Pounds (lb)': 0.45359237,
    'Atomic Mass Units (u)': 1.6605390666e-27,
  },
};

const DEFAULT_CODE = `// Binary Search + Step Counter
function binarySearch(arr, target) {
  let lo = 0, hi = arr.length - 1, steps = 0;
  while (lo <= hi) {
    steps++;
    const mid = Math.floor((lo + hi) / 2);
    if (arr[mid] === target) return { index: mid, steps };
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return { index: -1, steps };
}

const sorted = Array.from({ length: 64 }, (_, i) => i * 2);
console.log("Search 42:", binarySearch(sorted, 42));
console.log("Search 99:", binarySearch(sorted, 99));`;

export function StemSandboxView() {
  const [tab, setTab] = useState<SandboxTab>('grapher');

  // Grapher state
  const [curves, setCurves] = useState<PlotCurve[]>([
    { id: 'c1', expr: 'sin(x) + 0.3 * x', color: CURVE_COLORS[0], enabled: true },
    { id: 'c2', expr: '0.25 * x^2 - 2', color: CURVE_COLORS[1], enabled: true },
  ]);
  const [xMin, setXMin] = useState(-8);
  const [xMax, setXMax] = useState(8);
  const [yMin, setYMin] = useState(-6);
  const [yMax, setYMax] = useState(6);
  const [showDerivative, setShowDerivative] = useState(true);
  const [showIntegral, setShowIntegral] = useState(true);
  const [intA, setIntA] = useState(-2);
  const [intB, setIntB] = useState(3);
  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number } | null>(null);
  const [curveAnalysis, setCurveAnalysis] = useState('');
  const [analyzingCurve, setAnalyzingCurve] = useState(false);
  const [graphError, setGraphError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Unit & Chemistry state
  const [unitCategory, setUnitCategory] = useState<string>('Energy');
  const [fromUnit, setFromUnit] = useState<string>('Kilojoules (kJ)');
  const [toUnit, setToUnit] = useState<string>('Calories (cal)');
  const [unitVal, setUnitVal] = useState<string>('10');
  const [tempC, setTempC] = useState<string>('25');
  const [phInput, setPhInput] = useState<string>('3.4');
  const [gasMoles, setGasMoles] = useState<string>('1');
  const [gasTempK, setGasTempK] = useState<string>('298.15');
  const [gasVolL, setGasVolL] = useState<string>('22.4');

  // Code Sandbox state
  const [code, setCode] = useState(DEFAULT_CODE);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([]);
  const [execTimeMs, setExecTimeMs] = useState<number | null>(null);
  const [codeTask, setCodeTask] = useState<'complexity' | 'debug' | 'trace' | 'translate_python'>('complexity');
  const [codeReviewMd, setCodeReviewMd] = useState('');
  const [reviewingCode, setReviewingCode] = useState(false);
  const [codeError, setCodeError] = useState('');

  const primaryFn = useMemo(() => {
    const first = curves.find((c) => c.enabled);
    return first ? compileMathExpr(first.expr) : null;
  }, [curves]);

  const numericIntegral = useMemo(() => {
    if (!primaryFn || !showIntegral) return null;
    return simpsonIntegral(primaryFn, intA, intB);
  }, [primaryFn, showIntegral, intA, intB]);

  useEffect(() => {
    if (tab !== 'grapher') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const isDark = document.documentElement.classList.contains('dark');

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = isDark ? '#0F172A' : '#FFFFFF';
    ctx.fillRect(0, 0, w, h);

    const toPxX = (x: number) => ((x - xMin) / (xMax - xMin)) * w;
    const toPxY = (y: number) => h - ((y - yMin) / (yMax - yMin)) * h;

    // Grid lines
    ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.08)';
    ctx.lineWidth = 1;
    const stepX = Math.max(1, Math.round((xMax - xMin) / 10));
    const stepY = Math.max(1, Math.round((yMax - yMin) / 8));

    for (let x = Math.ceil(xMin); x <= Math.floor(xMax); x += stepX) {
      const px = toPxX(x);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
    }
    for (let y = Math.ceil(yMin); y <= Math.floor(yMax); y += stepY) {
      const py = toPxY(y);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = isDark ? '#64748B' : '#475569';
    ctx.lineWidth = 1.5;
    if (yMin <= 0 && yMax >= 0) {
      const py0 = toPxY(0);
      ctx.beginPath();
      ctx.moveTo(0, py0);
      ctx.lineTo(w, py0);
      ctx.stroke();
    }
    if (xMin <= 0 && xMax >= 0) {
      const px0 = toPxX(0);
      ctx.beginPath();
      ctx.moveTo(px0, 0);
      ctx.lineTo(px0, h);
      ctx.stroke();
    }

    // Integral shading for primary curve
    if (showIntegral && primaryFn) {
      const a = Math.min(intA, intB);
      const b = Math.max(intA, intB);
      const y0 = toPxY(0);
      ctx.fillStyle = 'rgba(79, 70, 229, 0.18)';
      ctx.beginPath();
      ctx.moveTo(toPxX(a), y0);
      const samples = 180;
      for (let i = 0; i <= samples; i++) {
        const x = a + ((b - a) * i) / samples;
        const y = primaryFn(x);
        if (Number.isFinite(y)) {
          ctx.lineTo(toPxX(x), toPxY(y));
        }
      }
      ctx.lineTo(toPxX(b), y0);
      ctx.closePath();
      ctx.fill();
    }

    // Curves
    curves.forEach((curve, idx) => {
      if (!curve.enabled) return;
      const fn = compileMathExpr(curve.expr);
      if (!fn) return;
      ctx.strokeStyle = curve.color;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      let started = false;
      for (let px = 0; px <= w; px += 1.5) {
        const x = xMin + (px / w) * (xMax - xMin);
        const y = fn(x);
        if (!Number.isFinite(y) || Math.abs(y) > 1e5) {
          started = false;
          continue;
        }
        const py = toPxY(y);
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
      ctx.stroke();

      // Dashed derivative for first active curve
      if (idx === 0 && showDerivative) {
        ctx.save();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = '#0EA5E9';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        let dStarted = false;
        const hStep = 1e-4;
        for (let px = 0; px <= w; px += 2) {
          const x = xMin + (px / w) * (xMax - xMin);
          const dy = (fn(x + hStep) - fn(x - hStep)) / (2 * hStep);
          if (!Number.isFinite(dy) || Math.abs(dy) > 1e5) {
            dStarted = false;
            continue;
          }
          const py = toPxY(dy);
          if (!dStarted) {
            ctx.moveTo(px, py);
            dStarted = true;
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
        ctx.restore();
      }
    });
  }, [tab, curves, xMin, xMax, yMin, yMax, showDerivative, showIntegral, intA, intB, primaryFn]);

  const handleAnalyzeCurve = async () => {
    const first = curves.find((c) => c.enabled);
    if (!first) return;
    setAnalyzingCurve(true);
    setGraphError('');
    try {
      const res = await analyzeMathCurve({
        expression: first.expr,
        xMin,
        xMax,
        integralA: showIntegral ? intA : undefined,
        integralB: showIntegral ? intB : undefined,
        numericIntegral,
      });
      setCurveAnalysis(res.analysisMarkdown);
    } catch (err) {
      setGraphError(err instanceof Error ? err.message : 'Failed to analyze function.');
    } finally {
      setAnalyzingCurve(false);
    }
  };

  const handleRunCode = () => {
    setCodeError('');
    const logs: string[] = [];
    const fakeConsole = {
      log: (...args: unknown[]) => {
        logs.push(
          args
            .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
            .join(' ')
        );
      },
      warn: (...args: unknown[]) => logs.push(`WARN: ${args.map(String).join(' ')}`),
      error: (...args: unknown[]) => logs.push(`ERR: ${args.map(String).join(' ')}`),
    };

    const t0 = performance.now();
    try {
      const runner = new Function('console', `"use strict";\n${code}`);
      const ret = runner(fakeConsole);
      if (ret !== undefined) logs.push(`=> ${typeof ret === 'object' ? JSON.stringify(ret) : String(ret)}`);
      setExecTimeMs(Math.round((performance.now() - t0) * 100) / 100);
      setConsoleLogs(logs.length > 0 ? logs : ['(Program finished with no console output)']);
    } catch (err) {
      setExecTimeMs(Math.round((performance.now() - t0) * 100) / 100);
      setCodeError(err instanceof Error ? err.message : String(err));
      setConsoleLogs(logs);
    }
  };

  const handleReviewCode = async () => {
    setReviewingCode(true);
    setCodeError('');
    try {
      const res = await reviewStemCode({
        code,
        task: codeTask,
        consoleOutput: consoleLogs.join('\n'),
      });
      setCodeReviewMd(res.markdown);
    } catch (err) {
      setCodeError(err instanceof Error ? err.message : 'Failed to review code.');
    } finally {
      setReviewingCode(false);
    }
  };

  // Unit math
  const convertedUnitValue = useMemo(() => {
    const group = UNIT_GROUPS[unitCategory];
    const num = parseFloat(unitVal);
    if (!group || !Number.isFinite(num)) return null;
    const f1 = group[fromUnit];
    const f2 = group[toUnit];
    if (!f1 || !f2) return null;
    return (num * f1) / f2;
  }, [unitCategory, fromUnit, toUnit, unitVal]);

  const cNum = parseFloat(tempC);
  const phNum = parseFloat(phInput);
  const gasPAtm = useMemo(() => {
    const n = parseFloat(gasMoles);
    const t = parseFloat(gasTempK);
    const v = parseFloat(gasVolL);
    if (!Number.isFinite(n) || !Number.isFinite(t) || !Number.isFinite(v) || v <= 0) return null;
    return (n * 0.082057 * t) / v;
  }, [gasMoles, gasTempK, gasVolL]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Calculator className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            STEM Formula, Graphing &amp; Code Sandbox
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Interactive calculus plotter, physics &amp; chemistry solvers, and an in-browser JavaScript algorithm runner with Gemini Big-O analysis.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900/70 w-fit">
          {(
            [
              ['grapher', 'Graphing & Calculus', Calculator],
              ['units', 'Physics & Chem Solvers', FlaskConical],
              ['code', 'Code & Algorithm Lab', Code2],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                tab === id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: Graphing Calculator */}
      {tab === 'grapher' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Stage */}
            <div className="lg:col-span-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                <span>
                  Domain [{xMin}, {xMax}] · Range [{yMin}, {yMax}]
                </span>
                <span>
                  {hoverCoord
                    ? `Cursor: x = ${hoverCoord.x.toFixed(2)}, y = ${hoverCoord.y.toFixed(2)}`
                    : 'Move cursor over plot to inspect coordinates'}
                </span>
              </div>

              <canvas
                ref={canvasRef}
                width={820}
                height={440}
                onMouseMove={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const rx = (e.clientX - rect.left) / rect.width;
                  const ry = (e.clientY - rect.top) / rect.height;
                  setHoverCoord({
                    x: xMin + rx * (xMax - xMin),
                    y: yMax - ry * (yMax - yMin),
                  });
                }}
                onMouseLeave={() => setHoverCoord(null)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-800 cursor-crosshair"
              />

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                  {showDerivative && <span>Dashed cyan: f&apos;(x) · </span>}
                  {showIntegral && numericIntegral !== null && (
                    <span className="font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                      ∫[{intA}, {intB}] f(x)dx ≈ {numericIntegral.toFixed(4)}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setXMin((v) => v / 1.4);
                      setXMax((v) => v / 1.4);
                      setYMin((v) => v / 1.4);
                      setYMax((v) => v / 1.4);
                    }}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    Zoom In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setXMin((v) => v * 1.4);
                      setXMax((v) => v * 1.4);
                      setYMin((v) => v * 1.4);
                      setYMax((v) => v * 1.4);
                    }}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    Zoom Out
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setXMin(-8);
                      setXMax(8);
                      setYMin(-6);
                      setYMax(6);
                    }}
                    className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>

            {/* Control Deck */}
            <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-5">
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Functions f(x)
                  </h2>
                  {curves.length < 4 && (
                    <button
                      type="button"
                      onClick={() =>
                        setCurves((prev) => [
                          ...prev,
                          {
                            id: `c_${Date.now()}`,
                            expr: 'cos(x)',
                            color: CURVE_COLORS[prev.length % CURVE_COLORS.length],
                            enabled: true,
                          },
                        ])
                      }
                      className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add Curve
                    </button>
                  )}
                </div>

                {curves.map((curve, idx) => (
                  <div key={curve.id} className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-xs shrink-0"
                      style={{ backgroundColor: curve.color }}
                    />
                    <input
                      type="text"
                      value={curve.expr}
                      onChange={(e) =>
                        setCurves((prev) =>
                          prev.map((c) => (c.id === curve.id ? { ...c, expr: e.target.value } : c))
                        )
                      }
                      placeholder="e.g., x^2 - 4"
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-xs text-slate-900 dark:text-white"
                    />
                    {idx > 0 && (
                      <button
                        type="button"
                        onClick={() => setCurves((prev) => prev.filter((c) => c.id !== curve.id))}
                        className="p-1 text-slate-400 hover:text-rose-600"
                        aria-label="Remove curve"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <p className="text-[11px] text-slate-400">
                  Supports sin, cos, tan, exp, ln, log, sqrt, abs, pi, e, and ^.
                </p>
              </div>

              <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showDerivative}
                    onChange={(e) => setShowDerivative(e.target.checked)}
                    className="rounded"
                  />
                  Plot numerical derivative f&apos;(x) of first curve
                </label>

                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showIntegral}
                    onChange={(e) => setShowIntegral(e.target.checked)}
                    className="rounded"
                  />
                  Shade definite integral ∫[a, b] f(x) dx
                </label>

                {showIntegral && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[11px] text-slate-500">Lower bound a</label>
                      <input
                        type="number"
                        step="0.5"
                        value={intA}
                        onChange={(e) => setIntA(parseFloat(e.target.value) || 0)}
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-xs tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-slate-500">Upper bound b</label>
                      <input
                        type="number"
                        step="0.5"
                        value={intB}
                        onChange={(e) => setIntB(parseFloat(e.target.value) || 0)}
                        className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-xs tabular-nums"
                      />
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleAnalyzeCurve()}
                disabled={analyzingCurve}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium"
              >
                {analyzingCurve ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Analyze Curve with Gemini
              </button>
              {graphError && <p className="text-xs text-rose-600">{graphError}</p>}
            </div>
          </div>

          {curveAnalysis && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-2">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Symbolic Calculus &amp; Curve Analysis
              </h3>
              <MarkdownView content={curveAnalysis} />
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Physics & Chemistry Solvers */}
      {tab === 'units' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Dimensional Unit Converter */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              SI &amp; Scientific Unit Converter
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(UNIT_GROUPS).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setUnitCategory(cat);
                    const keys = Object.keys(UNIT_GROUPS[cat]);
                    setFromUnit(keys[0]);
                    setToUnit(keys[1] || keys[0]);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                    unitCategory === cat
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="number"
                value={unitVal}
                onChange={(e) => setUnitVal(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-sm tabular-nums"
              />
              <select
                value={fromUnit}
                onChange={(e) => setFromUnit(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
              >
                {Object.keys(UNIT_GROUPS[unitCategory]).map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
              <select
                value={toUnit}
                onChange={(e) => setToUnit(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs"
              >
                {Object.keys(UNIT_GROUPS[unitCategory]).map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-4">
              <p className="text-xs text-slate-500">Converted Result</p>
              <p className="font-mono text-xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums mt-1">
                {convertedUnitValue !== null
                  ? `${Math.abs(convertedUnitValue) > 1e6 || (Math.abs(convertedUnitValue) > 0 && Math.abs(convertedUnitValue) < 1e-4) ? convertedUnitValue.toExponential(5) : convertedUnitValue.toFixed(5)} ${toUnit}`
                  : '—'}
              </p>
            </div>
          </div>

          {/* Temperature, pH & Ideal Gas Law */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Thermodynamics &amp; Acid-Base Quick Solvers
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
              <div>
                <label className="text-xs text-slate-500">Temperature (°C)</label>
                <input
                  type="number"
                  value={tempC}
                  onChange={(e) => setTempC(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-sm tabular-nums"
                />
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-2.5">
                <p className="text-[11px] text-slate-500">Kelvin (K)</p>
                <p className="font-mono text-sm font-semibold tabular-nums">
                  {Number.isFinite(cNum) ? `${(cNum + 273.15).toFixed(2)} K` : '—'}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-2.5">
                <p className="text-[11px] text-slate-500">Fahrenheit (°F)</p>
                <p className="font-mono text-sm font-semibold tabular-nums">
                  {Number.isFinite(cNum) ? `${((cNum * 9) / 5 + 32).toFixed(2)} °F` : '—'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end pt-3 border-t border-slate-200 dark:border-slate-800">
              <div>
                <label className="text-xs text-slate-500">Solution pH (0–14)</label>
                <input
                  type="number"
                  step="0.1"
                  value={phInput}
                  onChange={(e) => setPhInput(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-sm tabular-nums"
                />
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-2.5">
                <p className="text-[11px] text-slate-500">pOH · Nature</p>
                <p className="font-mono text-sm font-semibold tabular-nums">
                  {Number.isFinite(phNum)
                    ? `${(14 - phNum).toFixed(2)} · ${phNum < 7 ? 'Acidic' : phNum > 7 ? 'Basic' : 'Neutral'}`
                    : '—'}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-2.5">
                <p className="text-[11px] text-slate-500">[H⁺] Concentration</p>
                <p className="font-mono text-sm font-semibold tabular-nums">
                  {Number.isFinite(phNum) ? `${Math.pow(10, -phNum).toExponential(2)} M` : '—'}
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                Ideal Gas Law (P = nRT / V, R = 0.082057 L·atm/mol·K)
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label className="text-[11px] text-slate-500">n (mol)</label>
                  <input
                    type="number"
                    value={gasMoles}
                    onChange={(e) => setGasMoles(e.target.value)}
                    className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500">T (K)</label>
                  <input
                    type="number"
                    value={gasTempK}
                    onChange={(e) => setGasTempK(e.target.value)}
                    className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-500">V (L)</label>
                  <input
                    type="number"
                    value={gasVolL}
                    onChange={(e) => setGasVolL(e.target.value)}
                    className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-xs tabular-nums"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                Pressure P = {gasPAtm !== null ? `${gasPAtm.toFixed(4)} atm (${(gasPAtm * 101.325).toFixed(2)} kPa)` : '—'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Code & Algorithm Sandbox */}
      {tab === 'code' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  JavaScript Algorithm Runner
                </h2>
                <button
                  type="button"
                  onClick={handleRunCode}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Run Code
                </button>
              </div>
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                rows={14}
                spellCheck={false}
                className="w-full px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-950 text-slate-100 font-mono text-xs leading-relaxed"
              />
            </div>

            <div className="lg:col-span-5 space-y-4">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Console Output
                  </h2>
                  {execTimeMs !== null && (
                    <span className="font-mono text-xs text-slate-500 tabular-nums">
                      {execTimeMs} ms
                    </span>
                  )}
                </div>
                <pre className="rounded-xl bg-slate-950 text-emerald-300 p-3.5 font-mono text-xs min-h-[120px] max-h-52 overflow-auto whitespace-pre-wrap">
                  {consoleLogs.length > 0 ? consoleLogs.join('\n') : '// Click Run Code to execute'}
                </pre>
                {codeError && <p className="text-xs text-rose-600 font-mono">{codeError}</p>}
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Gemini Code Tutor
                </h2>
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['complexity', 'Big-O Complexity'],
                      ['debug', 'Find Bugs'],
                      ['trace', 'Trace Table'],
                      ['translate_python', 'To Python 3'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setCodeTask(id)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                        codeTask === id
                          ? 'bg-indigo-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void handleReviewCode()}
                  disabled={reviewingCode}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium"
                >
                  {reviewingCode ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Analyze Code with Gemini
                </button>
              </div>
            </div>
          </div>

          {codeReviewMd && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6">
              <MarkdownView content={codeReviewMd} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
