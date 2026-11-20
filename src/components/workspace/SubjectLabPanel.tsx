import { useMemo, useState } from 'react';
import { Atom, Calculator, Dna, Feather, FlaskConical, Loader2, Sparkles } from 'lucide-react';
import type { Subject } from '../../types';
import { runSubjectLab } from '../../services/geminiApi';
import { MarkdownView } from '../MarkdownView';

interface SubjectLabPanelProps {
  subject: Subject;
}

type DomainMode = 'math' | 'physics' | 'chemistry' | 'biology' | 'english' | 'languages';

function inferDomain(name: string): DomainMode {
  const n = name.toLowerCase();
  if (/chem|organic|inorganic|stoich/.test(n)) return 'chemistry';
  if (/phys|mech|electro|quantum|thermo/.test(n)) return 'physics';
  if (/bio|anat|genet|ecol|cell/.test(n)) return 'biology';
  if (/eng|lit|essay|writ|hist/.test(n)) return 'english';
  if (/french|span|germ|ital|lang|latin|mandarin|japan/.test(n)) return 'languages';
  return 'math';
}

const ELEMENTS_SAMPLE = [
  { num: 1, sym: 'H', name: 'Hydrogen', mass: '1.008', group: 'Nonmetal' },
  { num: 2, sym: 'He', name: 'Helium', mass: '4.0026', group: 'Noble Gas' },
  { num: 6, sym: 'C', name: 'Carbon', mass: '12.011', group: 'Nonmetal' },
  { num: 7, sym: 'N', name: 'Nitrogen', mass: '14.007', group: 'Nonmetal' },
  { num: 8, sym: 'O', name: 'Oxygen', mass: '15.999', group: 'Nonmetal' },
  { num: 11, sym: 'Na', name: 'Sodium', mass: '22.990', group: 'Alkali Metal' },
  { num: 12, sym: 'Mg', name: 'Magnesium', mass: '24.305', group: 'Alkaline Earth' },
  { num: 17, sym: 'Cl', name: 'Chlorine', mass: '35.45', group: 'Halogen' },
  { num: 19, sym: 'K', name: 'Potassium', mass: '39.098', group: 'Alkali Metal' },
  { num: 20, sym: 'Ca', name: 'Calcium', mass: '40.078', group: 'Alkaline Earth' },
  { num: 26, sym: 'Fe', name: 'Iron', mass: '55.845', group: 'Transition Metal' },
  { num: 29, sym: 'Cu', name: 'Copper', mass: '63.546', group: 'Transition Metal' },
];

export function SubjectLabPanel({ subject }: SubjectLabPanelProps) {
  const [domain, setDomain] = useState<DomainMode>(() => inferDomain(subject.name));
  const [aiInput, setAiInput] = useState('');
  const [aiTask, setAiTask] = useState('Solve step-by-step & explain');
  const [aiResult, setAiResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Math Graph Plotter state: y = a*x^2 + b*x + c
  const [coefA, setCoefA] = useState(0.5);
  const [coefB, setCoefB] = useState(0);
  const [coefC, setCoefC] = useState(-2);

  // Physics Motion Simulator state: x = v0*t + 0.5*a*t^2
  const [v0, setV0] = useState(12);
  const [accel, setAccel] = useState(-2.5);
  const [unitMeters, setUnitMeters] = useState('100');

  // Chemistry Element Inspector
  const [selectedEl, setSelectedEl] = useState(ELEMENTS_SAMPLE[2]);

  const mathCurvePoints = useMemo(() => {
    const pts: string[] = [];
    for (let x = -6; x <= 6; x += 0.25) {
      const y = coefA * x * x + coefB * x + coefC;
      const sx = 200 + x * 28;
      const sy = 120 - y * 14;
      pts.push(`${sx.toFixed(1)},${Math.max(10, Math.min(230, sy)).toFixed(1)}`);
    }
    return pts.join(' ');
  }, [coefA, coefB, coefC]);

  const motionPoints = useMemo(() => {
    const pts: string[] = [];
    for (let t = 0; t <= 8; t += 0.25) {
      const pos = v0 * t + 0.5 * accel * t * t;
      const sx = 24 + t * 44;
      const sy = 180 - pos * 2.2;
      pts.push(`${sx.toFixed(1)},${Math.max(12, Math.min(215, sy)).toFixed(1)}`);
    }
    return pts.join(' ');
  }, [v0, accel]);

  const handleRunAi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await runSubjectLab({
        domain: `${domain.toUpperCase()} (${subject.name})`,
        task: aiTask,
        input: aiInput,
      });
      setAiResult(res.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run Subject AI tool.');
    } finally {
      setLoading(false);
    }
  };

  const metersVal = parseFloat(unitMeters) || 0;

  return (
    <div className="space-y-6">
      {/* Domain Mode Selector */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 flex flex-wrap gap-2">
        {[
          { id: 'math' as const, label: 'Mathematics Lab', icon: Calculator },
          { id: 'physics' as const, label: 'Physics Lab', icon: Atom },
          { id: 'chemistry' as const, label: 'Chemistry Lab', icon: FlaskConical },
          { id: 'biology' as const, label: 'Biology Lab', icon: Dna },
          { id: 'english' as const, label: 'English & Essay Lab', icon: Feather },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setDomain(item.id)}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-colors ${
                domain === item.id
                  ? 'bg-indigo-600 text-white'
                  : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Interactive Domain Workbench */}
      {domain === 'math' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Interactive Function Grapher: y = {coefA}x² + {coefB}x + {coefC}
            </h3>
            <svg viewBox="0 0 400 240" className="w-full h-56 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800">
              <line x1="0" y1="120" x2="400" y2="120" stroke="#94A3B8" strokeWidth="1" />
              <line x1="200" y1="0" x2="200" y2="240" stroke="#94A3B8" strokeWidth="1" />
              <polyline fill="none" stroke="#4F46E5" strokeWidth="2.5" points={mathCurvePoints} />
            </svg>
            <div className="grid grid-cols-3 gap-3 text-xs">
              <label className="space-y-1">
                <span>a = {coefA}</span>
                <input type="range" min="-2" max="2" step="0.25" value={coefA} onChange={(e) => setCoefA(Number(e.target.value))} className="w-full" />
              </label>
              <label className="space-y-1">
                <span>b = {coefB}</span>
                <input type="range" min="-5" max="5" step="0.5" value={coefB} onChange={(e) => setCoefB(Number(e.target.value))} className="w-full" />
              </label>
              <label className="space-y-1">
                <span>c = {coefC}</span>
                <input type="range" min="-6" max="6" step="0.5" value={coefC} onChange={(e) => setCoefC(Number(e.target.value))} className="w-full" />
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Core Formula Quick-Sheet
            </h3>
            <div className="space-y-2 text-xs font-mono text-slate-700 dark:text-slate-300">
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60">Quadratic Roots: x = (-b ± √(b² - 4ac)) / 2a</div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60">Power Rule: d/dx [xⁿ] = n·xⁿ⁻¹</div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60">Integration by Parts: ∫u dv = uv - ∫v du</div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60">Discriminant Δ = {Math.round((coefB * coefB - 4 * coefA * coefC) * 100) / 100}</div>
            </div>
          </div>
        </div>
      )}

      {domain === 'physics' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Kinematics Simulator: s(t) = {v0}t + ½({accel})t²
            </h3>
            <svg viewBox="0 0 400 230" className="w-full h-52 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800">
              <line x1="24" y1="180" x2="390" y2="180" stroke="#94A3B8" strokeWidth="1" />
              <line x1="24" y1="12" x2="24" y2="215" stroke="#94A3B8" strokeWidth="1" />
              <polyline fill="none" stroke="#2563EB" strokeWidth="2.5" points={motionPoints} />
            </svg>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="space-y-1">
                <span>Initial Velocity v₀ = {v0} m/s</span>
                <input type="range" min="-10" max="30" step="1" value={v0} onChange={(e) => setV0(Number(e.target.value))} className="w-full" />
              </label>
              <label className="space-y-1">
                <span>Acceleration a = {accel} m/s²</span>
                <input type="range" min="-9.8" max="9.8" step="0.5" value={accel} onChange={(e) => setAccel(Number(e.target.value))} className="w-full" />
              </label>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              SI Unit Converter (Length / Distance)
            </h3>
            <input
              type="number"
              value={unitMeters}
              onChange={(e) => setUnitMeters(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60">{(metersVal / 1000).toFixed(4)} km</div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60">{(metersVal * 100).toFixed(1)} cm</div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60">{(metersVal * 1000).toFixed(0)} mm</div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60">{(metersVal * 3.28084).toFixed(2)} ft</div>
            </div>
          </div>
        </div>
      )}

      {domain === 'chemistry' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Interactive Periodic Table Reference
            </h3>
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              {selectedEl.name} ({selectedEl.sym}) · Atomic #{selectedEl.num} · {selectedEl.mass} u · {selectedEl.group}
            </span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-12 gap-2">
            {ELEMENTS_SAMPLE.map((el) => (
              <button
                key={el.num}
                type="button"
                onClick={() => setSelectedEl(el)}
                className={`p-2 rounded-xl border text-center transition-colors ${
                  selectedEl.num === el.num
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <div className="text-[10px] text-slate-400">{el.num}</div>
                <div className="font-display text-sm font-bold text-slate-900 dark:text-white">{el.sym}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Gemini Subject Specialist AI Workbench */}
      <form
        onSubmit={handleRunAi}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Gemini Subject Specialist ({subject.name})
          </h3>
          <select
            value={aiTask}
            onChange={(e) => setAiTask(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
          >
            {domain === 'math' && (
              <>
                <option value="Solve equation step-by-step and state key theorems">Step-by-Step Equation Solver</option>
                <option value="Verify my mathematical proof or derivation">Check Proof / Derivation</option>
              </>
            )}
            {domain === 'physics' && (
              <>
                <option value="Draw ASCII/textual Free-Body Force Diagram and solve using Newton's laws">Force Diagram & Solve</option>
                <option value="Check dimensional analysis and units">Dimensional Analysis Check</option>
              </>
            )}
            {domain === 'chemistry' && (
              <>
                <option value="Balance this chemical equation with stoichiometric coefficients and oxidation states">Balance Chemical Equation</option>
                <option value="Explain reaction mechanism and limiting reagent">Reaction Mechanism Explainer</option>
              </>
            )}
            {domain === 'biology' && (
              <>
                <option value="Break down this biological/cellular process into stages with key organelles/enzymes">Cellular / Organ Process Guide</option>
                <option value="Create a labelled structural overview">Organ / Structure Breakdown</option>
              </>
            )}
            {domain === 'english' && (
              <>
                <option value="Provide structured essay feedback (thesis, evidence, coherence, style) and rubric score">Essay Feedback & Grading</option>
                <option value="Perform close literary analysis (themes, motifs, devices)">Literary Device Analysis</option>
              </>
            )}
            {domain === 'languages' && (
              <option value="Analyze grammar, conjugations, and idiomatic improvements">Grammar & Style Review</option>
            )}
          </select>
        </div>

        <textarea
          rows={4}
          value={aiInput}
          onChange={(e) => setAiInput(e.target.value)}
          placeholder={
            domain === 'chemistry'
              ? 'e.g., Balance: Fe + O2 -> Fe2O3 or ask about SN2 mechanisms...'
              : domain === 'english'
                ? 'Paste an essay paragraph or literary excerpt for detailed feedback...'
                : 'Enter an equation, force problem, biological pathway, or question...'
          }
          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
        />

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={loading || !aiInput.trim()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-60"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {loading ? 'Analyzing...' : 'Run Specialist Analysis'}
        </button>

        {aiResult && (
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
            <MarkdownView content={aiResult} />
          </div>
        )}
      </form>
    </div>
  );
}
