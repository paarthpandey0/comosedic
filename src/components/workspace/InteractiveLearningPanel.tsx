import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Gamepad2,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  InteractiveActivityType,
  InteractiveModule,
  StudyResource,
  Subject,
} from '../../types';
import { generateInteractiveModule } from '../../services/geminiApi';
import {
  createInteractiveModule,
  deleteInteractiveModule,
  updateInteractiveModuleScore,
} from '../../services/studyDb';

interface InteractiveLearningPanelProps {
  uid: string;
  subject: Subject;
  resources: StudyResource[];
  modules: InteractiveModule[];
}

interface InteractiveItem {
  id: string;
  left: string;
  right: string;
  hint: string;
}

const ACTIVITY_LABELS: Record<'auto' | InteractiveActivityType, string> = {
  auto: 'Auto-Select Best Mode',
  match: 'Match Terms & Definitions',
  fill_gaps: 'Fill-in-the-Gaps',
  equation_steps: 'Step-by-Step Solver',
  timeline: 'Timeline & Process Order',
  diagram_label: 'Interactive Diagram Labeling',
};

export function InteractiveLearningPanel({
  uid,
  subject,
  resources,
  modules,
}: InteractiveLearningPanelProps) {
  const subjResources = resources.filter((r) => r.subjectId === subject.id);
  const subjModules = modules.filter((m) => m.subjectId === subject.id);

  const [activityType, setActivityType] = useState<'auto' | InteractiveActivityType>('auto');
  const [topic, setTopic] = useState('');
  const [selectedResourceId, setSelectedResourceId] = useState(subjResources[0]?.id || '');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeModId, setActiveModId] = useState(subjModules[0]?.id || '');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
  const [matchedPairs, setMatchedPairs] = useState<Record<string, string>>({});
  const [orderedIds, setOrderedIds] = useState<string[]>([]);
  const [checkedScore, setCheckedScore] = useState<number | null>(null);

  const activeMod = useMemo(
    () => subjModules.find((m) => m.id === activeModId) || subjModules[0] || null,
    [subjModules, activeModId]
  );

  const items: InteractiveItem[] = useMemo(() => {
    const raw = (activeMod?.payload as { items?: InteractiveItem[] } | undefined)?.items;
    return Array.isArray(raw) ? raw : [];
  }, [activeMod]);

  const instructions = useMemo(() => {
    return (
      ((activeMod?.payload as { instructions?: string } | undefined)?.instructions) ||
      'Complete the interactive activity below.'
    );
  }, [activeMod]);

  const shuffledRight = useMemo(() => {
    const arr = [...items];
    // Deterministic sort by string length + reverse id so it scrambles cleanly without jitter
    return arr.sort((a, b) => a.right.localeCompare(b.right));
  }, [items]);

  const currentOrder = useMemo(() => {
    if (orderedIds.length === items.length && items.length > 0) return orderedIds;
    return [...items].reverse().map((it) => it.id);
  }, [orderedIds, items]);

  const resetAttempt = () => {
    setInputs({});
    setSelectedLeft(null);
    setMatchedPairs({});
    setOrderedIds([]);
    setCheckedScore(null);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setError(null);
    try {
      const res = subjResources.find((r) => r.id === selectedResourceId);
      const resourceContent = res
        ? `${res.title}\n${res.summary}\n${res.extractedText.slice(0, 20000)}`
        : subject.topics.join(', ') || subject.name;

      const generated = await generateInteractiveModule({
        subjectName: subject.name,
        resourceContent,
        activityType,
        topic: topic.trim() || undefined,
      });

      const id = await createInteractiveModule(
        uid,
        subject.id,
        generated.title,
        generated.activityType,
        generated.payload
      );
      setActiveModId(id);
      resetAttempt();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate interactive exercise.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCheck = async () => {
    if (!activeMod || items.length === 0) return;
    let correct = 0;

    if (activeMod.activityType === 'match' || activeMod.activityType === 'diagram_label') {
      items.forEach((it) => {
        if ((matchedPairs[it.id] || '').trim().toLowerCase() === it.right.trim().toLowerCase()) {
          correct += 1;
        }
      });
    } else if (activeMod.activityType === 'timeline') {
      currentOrder.forEach((id, idx) => {
        if (items[idx]?.id === id) correct += 1;
      });
    } else {
      items.forEach((it) => {
        const userAns = (inputs[it.id] || '').trim().toLowerCase();
        const target = it.right.trim().toLowerCase();
        if (userAns && (userAns === target || target.includes(userAns) || userAns.includes(target))) {
          correct += 1;
        }
      });
    }

    const scorePct = Math.round((correct / items.length) * 100);
    setCheckedScore(scorePct);
    if (scorePct > (activeMod.bestScore || 0)) {
      await updateInteractiveModuleScore(activeMod.id, scorePct);
    }
  };

  const moveTimelineItem = (index: number, delta: -1 | 1) => {
    const next = [...currentOrder];
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= next.length) return;
    [next[index], next[targetIdx]] = [next[targetIdx], next[index]];
    setOrderedIds(next);
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Generator */}
      <form
        onSubmit={handleGenerate}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
      >
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
            Activity Mode
          </label>
          <select
            value={activityType}
            onChange={(e) => setActivityType(e.target.value as 'auto' | InteractiveActivityType)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          >
            {(Object.keys(ACTIVITY_LABELS) as Array<'auto' | InteractiveActivityType>).map((k) => (
              <option key={k} value={k}>
                {ACTIVITY_LABELS[k]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
            Source Resource
          </label>
          <select
            value={selectedResourceId}
            onChange={(e) => setSelectedResourceId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          >
            <option value="">Syllabus Topics ({subject.name})</option>
            {subjResources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
            Specific Topic (Optional)
          </label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g., Cell Organelles, Newton's Laws"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={generating}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-60"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {generating ? 'Creating...' : 'Create Interactive Lab'}
        </button>
      </form>

      {/* Saved Modules */}
      {subjModules.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {subjModules.map((m) => (
            <div
              key={m.id}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-medium ${
                activeMod?.id === m.id
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] text-slate-600 dark:text-slate-300'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveModId(m.id);
                  resetAttempt();
                }}
              >
                {m.title} · Best {m.bestScore}%
              </button>
              <button
                type="button"
                onClick={() => void deleteInteractiveModule(m.id)}
                className="text-slate-400 hover:text-rose-600"
                aria-label="Delete interactive module"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!activeMod ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-12 text-center space-y-2">
          <Gamepad2 className="w-8 h-8 text-indigo-500 mx-auto" />
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            Turn {subject.name} into hands-on interactive practice
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Gemini selects matching drills, fill-in-the-gaps, step-by-step equation solvers, timelines, or diagram labeling exercises.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                {ACTIVITY_LABELS[activeMod.activityType]} · Best Score {activeMod.bestScore}%
              </p>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                {activeMod.title}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{instructions}</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={resetAttempt}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset
              </button>
              <button
                type="button"
                onClick={() => void handleCheck()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Verify Answers
              </button>
            </div>
          </div>

          {checkedScore !== null && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/70 dark:bg-indigo-950/30 px-4 py-3 text-sm font-semibold text-indigo-900 dark:text-indigo-200">
              Score: {checkedScore}% ({Math.round((checkedScore / 100) * items.length)} / {items.length} correct)
            </div>
          )}

          {/* Mode 1 & 5: Matching / Diagram Labeling */}
          {(activeMod.activityType === 'match' || activeMod.activityType === 'diagram_label') && (
            <div className="space-y-4">
              {activeMod.activityType === 'diagram_label' && (
                <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-4">
                  <svg viewBox="0 0 680 220" className="w-full h-44">
                    <rect x="220" y="30" width="240" height="160" rx="18" fill="#EEF2FF" stroke="#4F46E5" strokeWidth="2" />
                    <text x="340" y="114" textAnchor="middle" fontSize="13" fontWeight="700" fill="#312E81">
                      {activeMod.title.slice(0, 26)}
                    </text>
                    {items.slice(0, 6).map((it, idx) => {
                      const positions = [
                        { x: 18, y: 26 },
                        { x: 492, y: 26 },
                        { x: 18, y: 94 },
                        { x: 492, y: 94 },
                        { x: 18, y: 162 },
                        { x: 492, y: 162 },
                      ];
                      const p = positions[idx];
                      const paired = matchedPairs[it.id];
                      return (
                        <g key={it.id} onClick={() => setSelectedLeft(it.id)} className="cursor-pointer">
                          <line
                            x1={p.x < 300 ? p.x + 170 : p.x}
                            y1={p.y + 18}
                            x2={p.x < 300 ? 220 : 460}
                            y2={55 + idx * 22}
                            stroke="#6366F1"
                            strokeDasharray="4 3"
                          />
                          <rect
                            x={p.x}
                            y={p.y}
                            width="170"
                            height="36"
                            rx="8"
                            fill={selectedLeft === it.id ? '#4F46E5' : '#FFFFFF'}
                            stroke={paired ? '#059669' : '#6366F1'}
                            strokeWidth="1.5"
                          />
                          <text
                            x={p.x + 85}
                            y={p.y + 22}
                            textAnchor="middle"
                            fontSize="11"
                            fontWeight="600"
                            fill={selectedLeft === it.id ? '#FFFFFF' : '#0F172A'}
                          >
                            {it.left.slice(0, 22)}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Select a term/label on the left, then click its matching definition/function on the right.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  {items.map((it) => {
                    const isSel = selectedLeft === it.id;
                    const pairedRight = matchedPairs[it.id];
                    const isRightCorrect =
                      checkedScore !== null &&
                      (pairedRight || '').trim().toLowerCase() === it.right.trim().toLowerCase();
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => setSelectedLeft(it.id)}
                        className={`w-full text-left px-3.5 py-2.5 rounded-xl border text-xs transition-colors ${
                          isSel
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40'
                            : checkedScore !== null
                              ? isRightCorrect
                                ? 'border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20'
                                : 'border-rose-300 bg-rose-50/60 dark:bg-rose-950/20'
                              : 'border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <p className="font-semibold text-slate-900 dark:text-white">{it.left}</p>
                        {pairedRight && (
                          <p className="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1 truncate">
                            Paired: {pairedRight}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="space-y-2">
                  {shuffledRight.map((it) => (
                    <button
                      key={`r_${it.id}`}
                      type="button"
                      onClick={() => {
                        if (!selectedLeft) return;
                        setMatchedPairs((p) => ({ ...p, [selectedLeft]: it.right }));
                        setSelectedLeft(null);
                      }}
                      className="w-full text-left px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-400 text-xs text-slate-700 dark:text-slate-300"
                    >
                      {it.right}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Mode 2 & 3: Fill Gaps or Step-by-Step Solver */}
          {(activeMod.activityType === 'fill_gaps' || activeMod.activityType === 'equation_steps') && (
            <div className="space-y-3">
              {items.map((it, idx) => {
                const userAns = inputs[it.id] || '';
                const isOk =
                  checkedScore !== null &&
                  userAns.trim().toLowerCase() === it.right.trim().toLowerCase();
                return (
                  <div
                    key={it.id}
                    className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                        Step {idx + 1}
                      </span>
                      <span>Hint: {it.hint}</span>
                    </div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{it.left}</p>
                    <input
                      type="text"
                      value={userAns}
                      onChange={(e) => setInputs((p) => ({ ...p, [it.id]: e.target.value }))}
                      placeholder="Type missing term or next step..."
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    />
                    {checkedScore !== null && (
                      <p
                        className={`text-xs font-medium ${
                          isOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        Expected: {it.right}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Mode 4: Timeline / Process Ordering */}
          {activeMod.activityType === 'timeline' && (
            <div className="space-y-2.5">
              {currentOrder.map((id, idx) => {
                const it = items.find((x) => x.id === id);
                if (!it) return null;
                const isPosOk = checkedScore !== null && items[idx]?.id === id;
                return (
                  <div
                    key={id}
                    className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 text-xs ${
                      checkedScore !== null
                        ? isPosOk
                          ? 'border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20'
                          : 'border-rose-300 bg-rose-50/50 dark:bg-rose-950/20'
                        : 'border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center font-mono font-bold">
                        {idx + 1}
                      </span>
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">{it.left}</p>
                        {checkedScore !== null && (
                          <p className="text-slate-500 dark:text-slate-400 mt-0.5">{it.right}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveTimelineItem(idx, -1)}
                        disabled={idx === 0}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                        aria-label="Move up"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveTimelineItem(idx, 1)}
                        disabled={idx === currentOrder.length - 1}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                        aria-label="Move down"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
