import { useState } from 'react';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import type {
  AcademicMemory,
  FeynmanScores,
  FeynmanSession,
  StudyResource,
  Subject,
} from '../types';
import {
  awardLearningXp,
  buildSubjectAiContext,
  createFeynmanSession,
  deleteFeynmanSession,
} from '../services/studyDb';
import { evaluateFeynmanExplanation } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';

interface FeynmanArenaViewProps {
  uid: string;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
  resources: StudyResource[];
  feynmanSessions: FeynmanSession[];
}

interface LiveEvaluation {
  overallScore: number;
  scores: FeynmanScores;
  verdict: string;
  blindSpots: string[];
  jargonFlags: string[];
  followUpQuestions: string[];
  refinedSummary: string;
}

export function FeynmanArenaView({
  uid,
  academicMemory,
  subjects,
  resources,
  feynmanSessions,
}: FeynmanArenaViewProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || 'general');
  const [topic, setTopic] = useState('');
  const [explanationText, setExplanationText] = useState('');
  const [followUpAnswers, setFollowUpAnswers] = useState('');
  const [evaluation, setEvaluation] = useState<LiveEvaluation | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleEvaluate = async (isRefinement = false) => {
    if (!topic.trim() || !explanationText.trim()) {
      setError('Choose a concept and explain it in your own words first.');
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    try {
      const subject = subjects.find((s) => s.id === subjectId);
      const context = buildSubjectAiContext(subjectId, resources, academicMemory, 15000);
      const res = await evaluateFeynmanExplanation({
        subjectName: subject?.name || 'General Study',
        topic: topic.trim(),
        explanationText: explanationText.trim(),
        followUpAnswers: isRefinement ? followUpAnswers.trim() : undefined,
        context,
      });

      setEvaluation(res);
      setSelectedHistoryId('');
      await createFeynmanSession(uid, {
        subjectId: subjectId || 'general',
        topic: topic.trim(),
        explanationText: isRefinement
          ? `${explanationText.trim()}\n\nFollow-up answers:\n${followUpAnswers.trim()}`
          : explanationText.trim(),
        overallScore: res.overallScore,
        scores: res.scores,
        blindSpots: res.blindSpots,
        jargonFlags: res.jargonFlags,
        followUpQuestions: res.followUpQuestions,
        refinedSummary: res.refinedSummary,
      });
      void awardLearningXp(uid, academicMemory, res.overallScore >= 80 ? 35 : 20);
      setNotice(
        isRefinement
          ? `Refined teach-back evaluated (${res.overallScore}/100) and saved.`
          : `Teach-back scored ${res.overallScore}/100. Answer the curious novice follow-ups below to raise your mastery.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to evaluate explanation.');
    } finally {
      setLoading(false);
    }
  };

  const viewedHistory = feynmanSessions.find((s) => s.id === selectedHistoryId) || null;
  const activeDisplay = viewedHistory
    ? {
        topic: viewedHistory.topic,
        overallScore: viewedHistory.overallScore,
        scores: viewedHistory.scores,
        verdict: '',
        blindSpots: viewedHistory.blindSpots,
        jargonFlags: viewedHistory.jargonFlags,
        followUpQuestions: viewedHistory.followUpQuestions,
        refinedSummary: viewedHistory.refinedSummary,
      }
    : evaluation
      ? { topic, ...evaluation }
      : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Brain className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Feynman Teach-Back Arena
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Prove you truly understand a concept by teaching it in plain English. Gemini hunts for hidden gaps, unexplained jargon, and logic leaps.
          </p>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
          {feynmanSessions.length} mastery evaluations logged
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Teach-Back Composer */}
        <div className="lg:col-span-7 space-y-5">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
                className="sm:col-span-5 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              >
                <option value="general">General Study</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Concept to teach (e.g., How Vaccines Train Memory B-Cells)"
                className="sm:col-span-7 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>Explain it as if teaching a curious 14-year-old — no copy-pasting definitions</span>
                <span className="tabular-nums">{explanationText.trim() ? explanationText.trim().split(/\s+/).length : 0} words</span>
              </div>
              <textarea
                value={explanationText}
                onChange={(e) => setExplanationText(e.target.value)}
                rows={7}
                placeholder="Start from first principles: what is it, why does it happen, how do the pieces interact, and what is a concrete everyday example?"
                className="w-full px-3.5 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm leading-relaxed text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void handleEvaluate(false)}
                disabled={loading}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium whitespace-nowrap"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Grade My Explanation
              </button>
              {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
              {notice && <p className="text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>}
            </div>
          </div>

          {/* Active Evaluation Report */}
          {activeDisplay && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                    {activeDisplay.topic}
                  </h2>
                  {activeDisplay.verdict && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                      {activeDisplay.verdict}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-mono text-3xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                    {activeDisplay.overallScore}/100
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {activeDisplay.overallScore >= 85
                      ? 'Mastery Verified'
                      : activeDisplay.overallScore >= 65
                        ? 'Solid — Close Remaining Gaps'
                        : 'Needs First-Principles Refinement'}
                  </p>
                </div>
              </div>

              {/* 4-Axis Rubric */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {(
                  [
                    ['Clarity', activeDisplay.scores.clarity],
                    ['Accuracy', activeDisplay.scores.accuracy],
                    ['Completeness', activeDisplay.scores.completeness],
                    ['Simplicity', activeDisplay.scores.simplicity],
                  ] as const
                ).map(([label, val]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3"
                  >
                    <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                    <p className="font-mono text-lg font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                      {val} / 25
                    </p>
                  </div>
                ))}
              </div>

              {/* Blind Spots & Jargon Flags */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                    Conceptual Blind Spots
                  </h3>
                  {activeDisplay.blindSpots.length === 0 ? (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      No major gaps detected.
                    </p>
                  ) : (
                    <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
                      {activeDisplay.blindSpots.map((b, i) => (
                        <li key={i}>• {b}</li>
                      ))}
                    </ul>
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" />
                    Unexplained Jargon Flags
                  </h3>
                  {activeDisplay.jargonFlags.length === 0 ? (
                    <p className="text-xs text-emerald-700 dark:text-emerald-400">
                      Clean, plain-language explanation with zero unexplained jargon.
                    </p>
                  ) : (
                    <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
                      {activeDisplay.jargonFlags.map((j, i) => (
                        <li key={i}>• {j}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Curious Novice Follow-Up Questions + Refinement Round */}
              {activeDisplay.followUpQuestions.length > 0 && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3">
                  <h3 className="text-xs font-semibold text-slate-900 dark:text-white">
                    Curious Student Follow-Up Questions
                  </h3>
                  <ol className="space-y-1.5 text-sm text-slate-700 dark:text-slate-200 list-decimal list-inside">
                    {activeDisplay.followUpQuestions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ol>
                  {!viewedHistory && (
                    <div className="space-y-2 pt-2">
                      <textarea
                        value={followUpAnswers}
                        onChange={(e) => setFollowUpAnswers(e.target.value)}
                        rows={3}
                        placeholder="Answer these follow-up questions to close your blind spots and re-grade..."
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => void handleEvaluate(true)}
                        disabled={loading || !followUpAnswers.trim()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Submit Follow-Up &amp; Upgrade Score
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Model Feynman Reference */}
              {activeDisplay.refinedSummary && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Reference Feynman Model Explanation
                  </h3>
                  <MarkdownView content={activeDisplay.refinedSummary} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Past Teach-Back Attempts */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Teach-Back History
          </h2>
          {feynmanSessions.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-8 text-center">
              Your evaluated teach-back attempts appear here so you can track conceptual clarity over time.
            </p>
          ) : (
            <div className="space-y-2 max-h-[640px] overflow-y-auto">
              {feynmanSessions.map((sess) => {
                const subjName = subjects.find((s) => s.id === sess.subjectId)?.name || 'General';
                const active = selectedHistoryId === sess.id;
                return (
                  <div
                    key={sess.id}
                    className={`rounded-xl border p-3.5 transition-colors ${
                      active
                        ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedHistoryId(sess.id)}
                        className="text-left flex-1 min-w-0"
                      >
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {sess.topic}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                          {subjName} · Score {sess.overallScore}/100 · {sess.blindSpots.length} gaps
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteFeynmanSession(sess.id)}
                        className="p-1 text-slate-400 hover:text-rose-600"
                        aria-label="Delete session"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
