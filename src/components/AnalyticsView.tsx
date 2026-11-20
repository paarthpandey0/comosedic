import { useMemo, useState } from 'react';
import { Award, BrainCircuit, CheckCircle2, Info, Loader2, Sparkles, Target, TrendingUp } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AcademicMemory,
  ComplexityPreference,
  Flashcard,
  Quiz,
  StudySession,
  Subject,
  UserProfile,
} from '../types';
import { ACHIEVEMENT_CATALOG, updateAcademicMemory } from '../services/studyDb';
import { analyzeLearningIntelligence, analyzePredictiveExamPrep } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';

interface AnalyticsViewProps {
  uid: string;
  profile: UserProfile | null;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
  flashcards: Flashcard[];
  quizzes: Quiz[];
  sessions: StudySession[];
}

export function AnalyticsView({
  uid,
  profile,
  academicMemory,
  subjects,
  flashcards,
  quizzes,
  sessions,
}: AnalyticsViewProps) {
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState<string | null>(null);
  const [intelData, setIntelData] = useState<{
    recurringMistakes: string[];
    strugglingTopics: string[];
    topicEstimates: Array<{
      topic: string;
      masteryScore: number;
      guessingRisk: 'low' | 'medium' | 'high';
      note: string;
    }>;
    recommendedComplexity: ComplexityPreference;
    revisionPath: Array<{ step: number; title: string; action: string }>;
    weeklyReport: string;
  } | null>(null);

  // #20.5 Predictive Exam Preparation state
  const [prepSubjectId, setPrepSubjectId] = useState(subjects[0]?.id || '');
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [prepResult, setPrepResult] = useState<{
    subjectId: string;
    estimatedReadinessPercent: number;
    evidenceConfidence: string;
    readinessSummary: string;
    topicAssessments: Array<{
      topic: string;
      status: string;
      reason: string;
      recommendedMinutes: number;
    }>;
    prepPlan: string[];
  } | null>(null);

  const completedQuizzes = useMemo(
    () => quizzes.filter((q) => q.status === 'completed'),
    [quizzes]
  );

  const handleRunIntelligence = async () => {
    setIntelLoading(true);
    setIntelError(null);
    try {
      const res = await analyzeLearningIntelligence({
        subjects: subjects.map((s) => ({
          id: s.id,
          name: s.name,
          confidence: s.confidence,
          examDate: s.examDate,
        })),
        quizzes: completedQuizzes.slice(0, 12).map((q) => ({
          title: q.title,
          score: q.score,
          maxScore: q.maxScore,
          weakTopics: q.weakTopics,
          aiSummary: q.aiSummary,
        })),
        flashcards: flashcards.slice(0, 40).map((c) => ({
          topic: c.topic,
          difficulty: c.difficulty,
          timesReviewed: c.timesReviewed,
          timesCorrect: c.timesCorrect,
        })),
        sessions: sessions.slice(0, 30).map((s) => ({
          activityType: s.activityType,
          durationMinutes: s.durationMinutes,
          date: s.date,
        })),
      });
      setIntelData(res);
      await updateAcademicMemory(uid, {
        recurringMistakes: res.recurringMistakes,
        strugglingTopics: res.strugglingTopics,
        preferredComplexity: res.recommendedComplexity,
        weeklyReport: res.weeklyReport,
      }).catch(() => {});
    } catch (err) {
      setIntelError(err instanceof Error ? err.message : 'Unable to run Learning Intelligence.');
    } finally {
      setIntelLoading(false);
    }
  };

  const overallQuizAvg = useMemo(() => {
    if (completedQuizzes.length === 0) return null;
    const sum = completedQuizzes.reduce(
      (acc, q) => acc + (q.score / Math.max(1, q.maxScore)) * 100,
      0
    );
    return Math.round(sum / completedQuizzes.length);
  }, [completedQuizzes]);

  const flashcardRetention = useMemo(() => {
    const reviewed = flashcards.reduce((acc, c) => acc + c.timesReviewed, 0);
    const correct = flashcards.reduce((acc, c) => acc + c.timesCorrect, 0);
    return reviewed > 0 ? Math.round((correct / reviewed) * 100) : null;
  }, [flashcards]);

  // Last 7 days study minutes
  const weeklyData = useMemo(() => {
    const days: Array<{ day: string; date: string; minutes: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { weekday: 'short' });
      const mins = sessions
        .filter((s) => s.date === iso)
        .reduce((acc, s) => acc + s.durationMinutes, 0);
      days.push({ day: label, date: iso, minutes: mins });
    }
    return days;
  }, [sessions]);

  // Quiz score trend over time
  const quizTrendData = useMemo(() => {
    return completedQuizzes
      .slice()
      .reverse()
      .slice(-10)
      .map((q, idx) => ({
        label: `#${idx + 1}`,
        title: q.title,
        accuracy: Math.round((q.score / Math.max(1, q.maxScore)) * 100),
      }));
  }, [completedQuizzes]);

  // Topic-level mastery from quizzes + flashcards
  const topicMastery = useMemo(() => {
    const map = new Map<string, { earned: number; max: number; cardCorrect: number; cardTotal: number }>();

    completedQuizzes.forEach((quiz) => {
      quiz.questions.forEach((q) => {
        const res = quiz.results.find((r) => r.questionId === q.id);
        if (!res) return;
        const curr = map.get(q.topic) || { earned: 0, max: 0, cardCorrect: 0, cardTotal: 0 };
        curr.earned += res.earnedPoints;
        curr.max += res.maxPoints;
        map.set(q.topic, curr);
      });
    });

    flashcards.forEach((c) => {
      if (c.timesReviewed === 0) return;
      const curr = map.get(c.topic) || { earned: 0, max: 0, cardCorrect: 0, cardTotal: 0 };
      curr.cardCorrect += c.timesCorrect;
      curr.cardTotal += c.timesReviewed;
      map.set(c.topic, curr);
    });

    return Array.from(map.entries())
      .map(([topic, data]) => {
        const quizPct = data.max > 0 ? (data.earned / data.max) * 100 : null;
        const cardPct = data.cardTotal > 0 ? (data.cardCorrect / data.cardTotal) * 100 : null;
        const combined =
          quizPct !== null && cardPct !== null
            ? Math.round((quizPct + cardPct) / 2)
            : Math.round(quizPct ?? cardPct ?? 0);
        return { topic, mastery: combined };
      })
      .sort((a, b) => a.mastery - b.mastery);
  }, [completedQuizzes, flashcards]);

  const weakestTopics = topicMastery.slice(0, 4);
  const strongestTopics = topicMastery.slice(-4).reverse();

  // Subject breakdown
  const subjectBreakdown = useMemo(() => {
    return subjects.map((subj) => {
      const mins = sessions
        .filter((s) => s.subjectId === subj.id)
        .reduce((acc, s) => acc + s.durationMinutes, 0);
      const sQuizzes = completedQuizzes.filter((q) => q.subjectId === subj.id);
      const qAvg = sQuizzes.length
        ? Math.round(
            sQuizzes.reduce((acc, q) => acc + (q.score / Math.max(1, q.maxScore)) * 100, 0) /
              sQuizzes.length
          )
        : null;
      const sCards = flashcards.filter((c) => c.subjectId === subj.id);
      const reviewed = sCards.reduce((acc, c) => acc + c.timesReviewed, 0);
      const correct = sCards.reduce((acc, c) => acc + c.timesCorrect, 0);
      const retention = reviewed > 0 ? Math.round((correct / reviewed) * 100) : null;
      return { subj, mins, qAvg, retention, cardCount: sCards.length };
    });
  }, [subjects, sessions, completedQuizzes, flashcards]);

  const activePrepSubject = useMemo(
    () => subjects.find((s) => s.id === prepSubjectId) || subjects[0] || null,
    [subjects, prepSubjectId]
  );

  const prepSubjectEvidence = useMemo(() => {
    if (!activePrepSubject) return null;
    const sQuizzes = completedQuizzes.filter((q) => q.subjectId === activePrepSubject.id);
    const qAvg = sQuizzes.length
      ? Math.round(
          sQuizzes.reduce((acc, q) => acc + (q.score / Math.max(1, q.maxScore)) * 100, 0) / sQuizzes.length
        )
      : 0;
    const sCards = flashcards.filter((c) => c.subjectId === activePrepSubject.id);
    const rev = sCards.reduce((acc, c) => acc + c.timesReviewed, 0);
    const corr = sCards.reduce((acc, c) => acc + c.timesCorrect, 0);
    const cardAcc = rev > 0 ? Math.round((corr / rev) * 100) : 0;
    const studyMins = sessions
      .filter((s) => s.subjectId === activePrepSubject.id)
      .reduce((acc, s) => acc + s.durationMinutes, 0);
    const weakTopics = Array.from(new Set(sQuizzes.flatMap((q) => q.weakTopics)));
    return { quizCount: sQuizzes.length, qAvg, cardAcc, studyMins, weakTopics, cardsReviewed: rev };
  }, [activePrepSubject, completedQuizzes, flashcards, sessions]);

  const handleRunPredictivePrep = async () => {
    if (!activePrepSubject || !prepSubjectEvidence) return;
    setPrepLoading(true);
    setPrepError(null);
    try {
      const res = await analyzePredictiveExamPrep({
        subjectName: activePrepSubject.name,
        examDate: activePrepSubject.examDate || 'Not set',
        topics: activePrepSubject.topics,
        completedTopics: academicMemory?.completedTopics || [],
        strugglingTopics: academicMemory?.strugglingTopics || prepSubjectEvidence.weakTopics,
        quizStats: {
          count: prepSubjectEvidence.quizCount,
          avgPercent: prepSubjectEvidence.qAvg,
          weakTopics: prepSubjectEvidence.weakTopics,
        },
        flashcardAccuracy: prepSubjectEvidence.cardAcc,
        studyMinutes: prepSubjectEvidence.studyMins,
      });
      setPrepResult({ subjectId: activePrepSubject.id, ...res });
    } catch (err) {
      setPrepError(err instanceof Error ? err.message : 'Unable to evaluate exam readiness.');
    } finally {
      setPrepLoading(false);
    }
  };

  const unlockedSet = new Set(profile?.achievements || []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Academic Analytics & AI Learning Intelligence
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Performance telemetry, mistake pattern diagnostics, guessing detection, and weekly AI reports
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleRunIntelligence()}
          disabled={intelLoading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-60 self-start"
        >
          {intelLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          {intelLoading ? 'Diagnosing Patterns...' : 'Run AI Learning Intelligence & Weekly Report'}
        </button>
      </div>

      {intelError && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-xs text-rose-700 dark:text-rose-300">
          {intelError}
        </div>
      )}

      {(intelData || academicMemory?.weeklyReport) && (
        <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-white dark:bg-[#1A202C] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BrainCircuit className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                AI Learning Intelligence Diagnostics
              </h2>
            </div>
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 capitalize">
              Adjusted Complexity: {intelData?.recommendedComplexity || academicMemory?.preferredComplexity || 'balanced'}
            </span>
          </div>

          {intelData && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 space-y-2">
                <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">Recurring Mistake Patterns</p>
                <ul className="list-disc pl-4 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                  {intelData.recurringMistakes.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 space-y-2">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                  Topic Mastery & Guessing Detection
                </p>
                <div className="space-y-1.5 text-xs">
                  {intelData.topicEstimates.slice(0, 5).map((te, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <span className="truncate text-slate-700 dark:text-slate-200">{te.topic}</span>
                      <span className="shrink-0 font-mono text-[11px] text-slate-500">
                        {te.masteryScore}% · {te.guessingRisk} guess risk
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 space-y-2">
                <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  Personalized 4-Step Revision Path
                </p>
                <ol className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                  {intelData.revisionPath.map((rp) => (
                    <li key={rp.step}>
                      <strong className="text-slate-900 dark:text-white">{rp.step}. {rp.title}:</strong> {rp.action}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
            <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white mb-2">
              Weekly AI Learning Report
            </h3>
            <MarkdownView
              content={intelData?.weeklyReport || academicMemory?.weeklyReport || ''}
              className="text-sm"
            />
          </div>
        </div>
      )}

      {/* #20.5 Predictive Exam Preparation */}
      {subjects.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <Target className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Predictive Exam Preparation & Readiness
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Inspects syllabus coverage, practice accuracy, and revision history for each upcoming exam.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={activePrepSubject?.id || ''}
                onChange={(e) => setPrepSubjectId(e.target.value)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {s.examDate ? `(${s.examDate})` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleRunPredictivePrep()}
                disabled={prepLoading}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-60 whitespace-nowrap"
              >
                {prepLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {prepLoading ? 'Analyzing Evidence...' : 'Assess Exam Readiness'}
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 px-3.5 py-2 flex items-start gap-2 text-[11px] text-slate-600 dark:text-slate-300">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-indigo-500" />
            <span>
              Readiness percentages are evidence-based estimates calculated strictly from your logged quizzes, flashcard retention, and revision history — never guaranteed exam results.
            </span>
          </div>

          {prepSubjectEvidence && activePrepSubject && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3">
                <p className="text-slate-500 dark:text-slate-400">Syllabus Topics</p>
                <p className="font-display text-lg font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                  {activePrepSubject.topics.length} tracked
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3">
                <p className="text-slate-500 dark:text-slate-400">Practice Quiz Avg</p>
                <p className="font-display text-lg font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                  {prepSubjectEvidence.quizCount > 0 ? `${prepSubjectEvidence.qAvg}%` : 'No quizzes yet'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3">
                <p className="text-slate-500 dark:text-slate-400">Flashcard Retention</p>
                <p className="font-display text-lg font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                  {prepSubjectEvidence.cardsReviewed > 0 ? `${prepSubjectEvidence.cardAcc}%` : 'Not reviewed'}
                </p>
              </div>
              <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-3">
                <p className="text-slate-500 dark:text-slate-400">Logged Revision</p>
                <p className="font-display text-lg font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">
                  {prepSubjectEvidence.studyMins} min
                </p>
              </div>
            </div>
          )}

          {prepError && <p className="text-xs text-rose-600">{prepError}</p>}

          {prepResult && (
            <div className="space-y-4 pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Evidence Confidence: <strong className="capitalize text-slate-800 dark:text-slate-200">{prepResult.evidenceConfidence}</strong>
                  </p>
                  <p className="font-display text-2xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                    {prepResult.estimatedReadinessPercent}% Estimated Evidence Readiness
                  </p>
                </div>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{prepResult.readinessSummary}</p>

              {prepResult.topicAssessments.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {prepResult.topicAssessments.map((ta, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-100 dark:border-slate-800 p-3.5 space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900 dark:text-white">{ta.topic}</span>
                        <span
                          className={`font-medium capitalize ${
                            ta.status === 'completed'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : ta.status === 'needs_revision'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {ta.status.replace('_', ' ')} · {ta.recommendedMinutes}m
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">{ta.reason}</p>
                    </div>
                  ))}
                </div>
              )}

              {prepResult.prepPlan.length > 0 && (
                <div className="rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-900/50 p-4 space-y-1.5">
                  <p className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                    Prioritized Preparation Plan
                  </p>
                  <ol className="list-decimal pl-4 space-y-1 text-xs text-slate-700 dark:text-slate-300">
                    {prepResult.prepPlan.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Overall Quiz Accuracy</p>
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
            {overallQuizAvg !== null ? `${overallQuizAvg}%` : '—'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            {completedQuizzes.length} graded assessments
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Flashcard Retention</p>
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
            {flashcardRetention !== null ? `${flashcardRetention}%` : '—'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            {flashcards.length} cards in deck
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Weekly Study Time</p>
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
            {(weeklyData.reduce((acc, d) => acc + d.minutes, 0) / 60).toFixed(1)} hrs
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">Last 7 days</p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Achievements Earned</p>
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
            {unlockedSet.size} / {Object.keys(ACHIEVEMENT_CATALOG).length}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Milestones unlocked</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white mb-1">
            Weekly Study Activity (Minutes)
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Daily logged study duration</p>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid rgba(148,163,184,0.25)',
                    fontSize: '12px',
                  }}
                />
                <Bar dataKey="minutes" fill="#4F46E5" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Quiz Accuracy Over Time
            </h2>
            <TrendingUp className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Recent graded assessment scores (%)</p>
          {quizTrendData.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              Complete a practice quiz to plot your accuracy trajectory.
            </div>
          ) : (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={quizTrendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: '#64748B' }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '12px',
                      border: '1px solid rgba(148,163,184,0.25)',
                      fontSize: '12px',
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="accuracy"
                    stroke="#2563EB"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: '#2563EB' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Topic-Level Mastery: Weakest & Strongest */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white mb-3">
            Weakest Topics (Priority Review)
          </h2>
          {weakestTopics.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Review flashcards or complete a quiz to measure topic-level mastery.
            </p>
          ) : (
            <div className="space-y-3">
              {weakestTopics.map((item) => (
                <div key={item.topic} className="space-y-1">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-slate-800 dark:text-slate-200">{item.topic}</span>
                    <span className="tabular-nums text-slate-600 dark:text-slate-300">{item.mastery}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        item.mastery < 60 ? 'bg-rose-500' : item.mastery < 80 ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${item.mastery}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white mb-3">
            Strongest Topics
          </h2>
          {strongestTopics.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Topic strengths appear once you complete quizzes or flashcard reviews.
            </p>
          ) : (
            <div className="space-y-3">
              {strongestTopics.map((item) => (
                <div key={item.topic} className="space-y-1">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-slate-800 dark:text-slate-200">{item.topic}</span>
                    <span className="tabular-nums text-slate-600 dark:text-slate-300">{item.mastery}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-600"
                      style={{ width: `${item.mastery}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Subject Performance Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 overflow-x-auto">
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white mb-4">
          Subject Performance Breakdown
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
              <th className="text-left py-2.5 font-medium">Subject</th>
              <th className="text-right py-2.5 font-medium">Confidence</th>
              <th className="text-right py-2.5 font-medium">Quiz Avg</th>
              <th className="text-right py-2.5 font-medium">Card Retention</th>
              <th className="text-right py-2.5 font-medium">Study Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {subjectBreakdown.map(({ subj, mins, qAvg, retention }) => (
              <tr key={subj.id} className="h-11">
                <td className="py-2 font-medium text-slate-900 dark:text-white">{subj.name}</td>
                <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                  {subj.confidence}/5
                </td>
                <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                  {qAvg !== null ? `${qAvg}%` : '—'}
                </td>
                <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                  {retention !== null ? `${retention}%` : '—'}
                </td>
                <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                  {mins} min
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Achievements Grid */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6">
        <div className="flex items-center gap-2 mb-4">
          <Award className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Academic Milestones
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(ACHIEVEMENT_CATALOG).map(([key, item]) => {
            const unlocked = unlockedSet.has(key);
            return (
              <div
                key={key}
                className={`rounded-xl border p-4 ${
                  unlocked
                    ? 'border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/40 dark:bg-indigo-950/20'
                    : 'border-slate-200 dark:border-slate-800 opacity-60'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</p>
                  {unlocked && <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{item.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
