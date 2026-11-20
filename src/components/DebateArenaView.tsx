import { useState } from 'react';
import {
  AlertTriangle,
  Award,
  Gavel,
  Loader2,
  RotateCcw,
  Scale,
  Send,
} from 'lucide-react';
import type { AcademicMemory, Subject } from '../types';
import { awardLearningXp } from '../services/studyDb';
import { judgeDebateSession, runDebateTurn } from '../services/geminiApi';

interface DebateArenaViewProps {
  uid: string;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
}

interface FallacyAlert {
  name: string;
  quote: string;
  fix: string;
}

interface DebateTurnItem {
  role: 'student' | 'opponent';
  text: string;
  fallacies?: FallacyAlert[];
  counterQuestion?: string;
  strengthDelta?: number;
}

interface JudgeReport {
  winner: 'student' | 'opponent' | 'draw';
  totalScore: number;
  breakdown: {
    evidence: number;
    rebuttal: number;
    logic: number;
    persuasion: number;
  };
  strongestMove: string;
  improvementTip: string;
  judgeVerdict: string;
}

const PRESET_MOTIONS = [
  'Nuclear fission is essential for meeting global 2050 net-zero climate targets.',
  'Universal basic income should replace traditional means-tested welfare systems.',
  'Gene editing via CRISPR should be permitted for preventing heritable diseases in human embryos.',
  'The Industrial Revolution improved long-term human welfare more than it harmed early industrial workers.',
  'Open-weight AI models create more net societal benefit than closed proprietary AI systems.',
];

export function DebateArenaView({
  uid,
  academicMemory,
  subjects,
}: DebateArenaViewProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || 'general');
  const [motion, setMotion] = useState(PRESET_MOTIONS[0]);
  const [studentStance, setStudentStance] = useState<'pro' | 'con'>('pro');
  const [started, setStarted] = useState(false);

  const [turns, setTurns] = useState<DebateTurnItem[]>([]);
  const [argumentInput, setArgumentInput] = useState('');
  const [momentum, setMomentum] = useState(50);
  const [judgeReport, setJudgeReport] = useState<JudgeReport | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [judging, setJudging] = useState(false);
  const [error, setError] = useState('');

  const allFallacies = turns.flatMap((t) => t.fallacies || []);
  const studentTurnCount = turns.filter((t) => t.role === 'student').length;

  const handleStart = () => {
    if (!motion.trim()) {
      setError('Enter or select a debate motion first.');
      return;
    }
    setError('');
    setTurns([]);
    setMomentum(50);
    setJudgeReport(null);
    setStarted(true);
  };

  const handleReset = () => {
    setStarted(false);
    setTurns([]);
    setArgumentInput('');
    setMomentum(50);
    setJudgeReport(null);
    setError('');
  };

  const handleSubmitArgument = async () => {
    if (!argumentInput.trim()) return;
    const text = argumentInput.trim();
    setSubmitting(true);
    setError('');
    try {
      const subject = subjects.find((s) => s.id === subjectId);
      const historyPayload = turns.map((t) => ({ role: t.role, text: t.text }));
      const res = await runDebateTurn({
        motion: motion.trim(),
        studentStance,
        subjectName: subject?.name || 'Critical Thinking & Rhetoric',
        history: historyPayload,
        studentArgument: text,
      });

      setTurns((prev) => [
        ...prev,
        {
          role: 'student',
          text,
          fallacies: res.fallacyCheck,
          strengthDelta: res.strengthDelta,
        },
        {
          role: 'opponent',
          text: res.rebuttal,
          counterQuestion: res.counterQuestion,
        },
      ]);
      setMomentum((prev) => Math.max(0, Math.min(100, prev + res.strengthDelta)));
      setArgumentInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Debate turn failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestVerdict = async () => {
    if (turns.length < 2) {
      setError('Exchange at least one full round before requesting the Judge Scorecard.');
      return;
    }
    setJudging(true);
    setError('');
    try {
      const res = await judgeDebateSession({
        motion: motion.trim(),
        studentStance,
        history: turns.map((t) => ({ role: t.role, text: t.text })),
      });
      setJudgeReport(res);
      void awardLearningXp(uid, academicMemory, res.winner === 'student' ? 40 : 25);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to score debate.');
    } finally {
      setJudging(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Scale className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Socratic Debate &amp; Fallacy Arena
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Defend a thesis against a live Devil&apos;s Advocate opponent, catch logical fallacies in real time, and earn a 4-axis Judge&apos;s Scorecard.
          </p>
        </div>
        {started && (
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            New Motion
          </button>
        )}
      </div>

      {!started ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-4 space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Subject Context
              </label>
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              >
                <option value="general">General / Rhetoric</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-8 space-y-1.5">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Debate Motion
              </label>
              <input
                type="text"
                value={motion}
                onChange={(e) => setMotion(e.target.value)}
                placeholder="Enter a debatable thesis statement..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Curated Academic Motions</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {PRESET_MOTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMotion(m)}
                  className={`text-left px-3.5 py-2.5 rounded-xl border text-xs leading-relaxed transition-colors ${
                    motion === m
                      ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-200'
                      : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Your Stance:</span>
              <button
                type="button"
                onClick={() => setStudentStance('pro')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold ${
                  studentStance === 'pro'
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Proposition (PRO)
              </button>
              <button
                type="button"
                onClick={() => setStudentStance('con')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold ${
                  studentStance === 'con'
                    ? 'bg-rose-600 text-white'
                    : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Opposition (CON)
              </button>
            </div>

            <button
              type="button"
              onClick={handleStart}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium whitespace-nowrap"
            >
              <Gavel className="w-4 h-4" />
              Enter Debate Floor
            </button>
          </div>
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Debate Transcript & Composer */}
          <div className="lg:col-span-8 space-y-4">
            {/* Motion Header & Momentum Meter */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    Motion · You argue {studentStance === 'pro' ? 'PRO (Affirmative)' : 'CON (Opposition)'}
                  </p>
                  <h2 className="font-display text-base font-bold text-slate-900 dark:text-white mt-1">
                    {motion}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => void handleRequestVerdict()}
                  disabled={judging || turns.length < 2}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-medium whitespace-nowrap"
                >
                  {judging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Award className="w-3.5 h-3.5" />}
                  Call Judge Scorecard
                </button>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  <span>Argument Momentum ({studentTurnCount} round{studentTurnCount === 1 ? '' : 's'})</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">{momentum} / 100</span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-300"
                    style={{ width: `${momentum}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Turns Feed */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
              {turns.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">
                  Deliver your opening statement below. Include a clear claim, concrete evidence, and reasoning.
                </p>
              ) : (
                <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
                  {turns.map((turn, idx) => (
                    <div
                      key={idx}
                      className={`rounded-xl border p-4 space-y-2 ${
                        turn.role === 'student'
                          ? 'border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-900 dark:text-white">
                          {turn.role === 'student'
                            ? `You (${studentStance.toUpperCase()})`
                            : `Devil's Advocate (${studentStance === 'pro' ? 'CON' : 'PRO'})`}
                        </span>
                        {typeof turn.strengthDelta === 'number' && (
                          <span
                            className={`font-mono font-semibold tabular-nums ${
                              turn.strengthDelta >= 0
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {turn.strengthDelta >= 0 ? `+${turn.strengthDelta}` : turn.strengthDelta} pts
                          </span>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed text-slate-800 dark:text-slate-100 whitespace-pre-wrap">
                        {turn.text}
                      </p>
                      {turn.counterQuestion && (
                        <p className="text-xs text-indigo-700 dark:text-indigo-300 pt-2 border-t border-slate-200 dark:border-slate-800">
                          <span className="font-semibold">Cross-examination: </span>
                          {turn.counterQuestion}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Composer */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
                <textarea
                  value={argumentInput}
                  onChange={(e) => setArgumentInput(e.target.value)}
                  rows={4}
                  placeholder={
                    turns.length === 0
                      ? 'State your opening thesis and supporting evidence...'
                      : 'Rebut your opponent and answer their cross-examination question...'
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
                />
                <div className="flex items-center justify-between gap-3">
                  {error ? (
                    <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
                  ) : (
                    <span className="text-xs text-slate-400">
                      Aim for 2–4 rounds before calling the Judge Scorecard.
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleSubmitArgument()}
                    disabled={submitting || !argumentInput.trim()}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium whitespace-nowrap"
                  >
                    {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Deliver Argument
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel: Live Fallacy Radar & Judge's Scorecard */}
          <div className="lg:col-span-4 space-y-5">
            {judgeReport && (
              <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-white dark:bg-[#1A202C] p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      Judge&apos;s Verdict
                    </p>
                    <p className="font-display text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                      {judgeReport.winner === 'student'
                        ? 'You Won the Floor'
                        : judgeReport.winner === 'draw'
                          ? 'Split Decision (Draw)'
                          : 'Opponent Took the Round'}
                    </p>
                  </div>
                  <p className="font-mono text-2xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                    {judgeReport.totalScore}/100
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  {(
                    [
                      ['Evidence', judgeReport.breakdown.evidence],
                      ['Rebuttal', judgeReport.breakdown.rebuttal],
                      ['Logic', judgeReport.breakdown.logic],
                      ['Persuasion', judgeReport.breakdown.persuasion],
                    ] as const
                  ).map(([label, score]) => (
                    <div
                      key={label}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-2.5"
                    >
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
                      <p className="font-mono text-base font-bold text-slate-900 dark:text-white tabular-nums">
                        {score}/25
                      </p>
                    </div>
                  ))}
                </div>

                <div className="space-y-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  <p>{judgeReport.judgeVerdict}</p>
                  {judgeReport.strongestMove && (
                    <p>
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">Strongest move: </span>
                      {judgeReport.strongestMove}
                    </p>
                  )}
                  {judgeReport.improvementTip && (
                    <p>
                      <span className="font-semibold text-amber-700 dark:text-amber-400">Next time: </span>
                      {judgeReport.improvementTip}
                    </p>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Live Fallacy Radar
              </h3>
              {allFallacies.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 py-4">
                  {turns.length === 0
                    ? 'Logical fallacies in your arguments (strawman, slippery slope, hasty generalization, etc.) will be flagged here in real time.'
                    : 'No logical fallacies detected in your arguments so far — clean reasoning.'}
                </p>
              ) : (
                <div className="space-y-3">
                  {allFallacies.map((f, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-3 space-y-1"
                    >
                      <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">{f.name}</p>
                      {f.quote && (
                        <p className="text-[11px] italic text-slate-600 dark:text-slate-400">
                          &ldquo;{f.quote}&rdquo;
                        </p>
                      )}
                      <p className="text-xs text-slate-700 dark:text-slate-200">{f.fix}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
