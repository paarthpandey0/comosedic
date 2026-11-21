import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CalendarPlus,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { MistakeEntry, Subject } from '../types';
import {
  createMistakeEntry,
  createStudyPlanTasksBatch,
  deleteMistakeEntry,
  getTodayIsoDate,
  updateMistakeEntry,
} from '../services/studyDb';
import { analyzeMistakeEntry } from '../services/geminiApi';

interface MistakeDatabaseViewProps {
  uid: string;
  subjects: Subject[];
  mistakes: MistakeEntry[];
}

export function MistakeDatabaseView({ uid, subjects, mistakes }: MistakeDatabaseViewProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || 'general');
  const [topic, setTopic] = useState('');
  const [question, setQuestion] = useState('');
  const [studentAnswer, setStudentAnswer] = useState('');
  const [correctAnswer, setCorrectAnswer] = useState('');
  const [filterSubject, setFilterSubject] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'open' | 'resolved'>('all');
  const [submitting, setSubmitting] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const handleLogMistake = async () => {
    if (!question.trim()) {
      setError('Enter the question you got wrong.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const subjectName = subjects.find((s) => s.id === subjectId)?.name || 'General Study';
      const analysis = await analyzeMistakeEntry({
        subjectName,
        topic: topic.trim(),
        question: question.trim(),
        studentAnswer: studentAnswer.trim(),
        correctAnswer: correctAnswer.trim(),
      });
      await createMistakeEntry(uid, {
        subjectId,
        topic: topic.trim() || analysis.inferredTopic || 'Core Concept',
        question: question.trim(),
        studentAnswer: studentAnswer.trim(),
        correctAnswer: correctAnswer.trim() || 'See explanation',
        misconception: analysis.misconception,
        explanation: analysis.explanation,
        practiceQuestion: analysis.practiceQuestion,
        resolved: false,
      });
      setTopic('');
      setQuestion('');
      setStudentAnswer('');
      setCorrectAnswer('');
      setNotice('Mistake analyzed, misconception saved, and similar practice question generated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze mistake.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleScheduleRevision = async (m: MistakeEntry) => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const iso = tomorrow.toISOString().slice(0, 10) || getTodayIsoDate();
    await createStudyPlanTasksBatch(uid, [
      {
        subjectId: m.subjectId,
        title: `Revise Misconception: ${m.topic}`,
        topic: m.topic,
        scheduledDate: iso,
        startTime: '16:00',
        durationMinutes: 25,
        priority: 'high',
        taskType: 'revision',
        category: 'revision',
      },
    ]);
    setNotice(`Scheduled revision task for "${m.topic}" tomorrow.`);
  };

  const handleRegeneratePractice = async (m: MistakeEntry) => {
    setRegeneratingId(m.id);
    setError('');
    try {
      const subjectName = subjects.find((s) => s.id === m.subjectId)?.name || 'General';
      const res = await analyzeMistakeEntry({
        subjectName,
        topic: m.topic,
        question: m.question,
        studentAnswer: m.studentAnswer,
        correctAnswer: m.correctAnswer,
      });
      await updateMistakeEntry(m.id, { practiceQuestion: res.practiceQuestion });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not regenerate question.');
    } finally {
      setRegeneratingId(null);
    }
  };

  const stats = useMemo(() => {
    const resolved = mistakes.filter((m) => m.resolved).length;
    const topicCounts = new Map<string, number>();
    mistakes.forEach((m) => {
      topicCounts.set(m.topic, (topicCounts.get(m.topic) || 0) + 1);
    });
    const topRecurring = Array.from(topicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    return {
      total: mistakes.length,
      resolved,
      open: mistakes.length - resolved,
      resolutionRate: mistakes.length ? Math.round((resolved / mistakes.length) * 100) : 0,
      topRecurring,
    };
  }, [mistakes]);

  const filtered = useMemo(() => {
    return mistakes.filter((m) => {
      if (filterSubject !== 'all' && m.subjectId !== filterSubject) return false;
      if (filterStatus === 'open' && m.resolved) return false;
      if (filterStatus === 'resolved' && !m.resolved) return false;
      return true;
    });
  }, [mistakes, filterSubject, filterStatus]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
          <AlertCircle className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          Mistake Database
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Every wrong quiz or homework answer is tracked here with root misconception analysis, similar practice, and revision scheduling.
        </p>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4">
          <p className="text-xs text-slate-500">Logged Mistakes</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">{stats.total}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4">
          <p className="text-xs text-slate-500">Needs Revision</p>
          <p className="text-2xl font-bold text-amber-600 tabular-nums mt-1">{stats.open}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4">
          <p className="text-xs text-slate-500">Resolved Mastery</p>
          <p className="text-2xl font-bold text-emerald-600 tabular-nums mt-1">{stats.resolutionRate}%</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4">
          <p className="text-xs text-slate-500">Top Recurring Topic</p>
          <p className="text-sm font-semibold text-slate-900 dark:text-white truncate mt-2">
            {stats.topRecurring[0]?.[0] || 'None recorded'}
          </p>
        </div>
      </div>

      {/* Log a Mistake Manually */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Record &amp; Diagnose a Mistake</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
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
            placeholder="Topic (optional — Gemini can infer)"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
          />
          <textarea
            rows={2}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Question or problem statement..."
            className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
          />
          <input
            type="text"
            value={studentAnswer}
            onChange={(e) => setStudentAnswer(e.target.value)}
            placeholder="Your original answer"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
          />
          <input
            type="text"
            value={correctAnswer}
            onChange={(e) => setCorrectAnswer(e.target.value)}
            placeholder="Correct answer (if known)"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
          />
        </div>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleLogMistake()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-50"
        >
          {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          Analyze Misconception &amp; Save
        </button>
      </div>

      {error && <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">{notice}</div>}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={filterSubject}
          onChange={(e) => setFilterSubject(e.target.value)}
          className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] px-3 py-1.5 text-xs"
        >
          <option value="all">All Subjects</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {(['all', 'open', 'resolved'] as const).map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setFilterStatus(st)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${
              filterStatus === st
                ? 'bg-indigo-600 text-white'
                : 'bg-white dark:bg-[#1A202C] border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            {st}
          </button>
        ))}
      </div>

      {/* Mistake Cards */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-8 text-center text-sm text-slate-500">
            No mistakes matching this filter yet.
          </div>
        ) : (
          filtered.map((m) => {
            const subjName = subjects.find((s) => s.id === m.subjectId)?.name || 'General Study';
            return (
              <div
                key={m.id}
                className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {subjName} · {m.topic} · {m.resolved ? 'Resolved' : 'Needs Review'}
                    </p>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-1">{m.question}</h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void updateMistakeEntry(m.id, { resolved: !m.resolved })}
                      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                        m.resolved
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {m.resolved ? 'Resolved' : 'Mark Resolved'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteMistakeEntry(m.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600"
                      aria-label="Delete mistake"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-xl bg-rose-50/70 dark:bg-rose-950/20 p-3">
                    <span className="font-semibold text-rose-700 dark:text-rose-300 block mb-1">Your Answer</span>
                    <span className="text-slate-800 dark:text-slate-200">{m.studentAnswer || '(blank)'}</span>
                  </div>
                  <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/20 p-3">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-300 block mb-1">Correct Answer</span>
                    <span className="text-slate-800 dark:text-slate-200">{m.correctAnswer}</span>
                  </div>
                </div>

                <div className="text-xs text-slate-700 dark:text-slate-200 space-y-1.5">
                  <p>
                    <strong>Misconception:</strong> {m.misconception}
                  </p>
                  <p className="text-slate-600 dark:text-slate-300">{m.explanation}</p>
                </div>

                <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-slate-700 dark:text-slate-200 flex-1 min-w-[200px]">
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400 block mb-0.5">
                      Similar Practice Question
                    </span>
                    {m.practiceQuestion}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={regeneratingId === m.id}
                      onClick={() => void handleRegeneratePractice(m)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
                    >
                      {regeneratingId === m.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      New Practice Q
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleScheduleRevision(m)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium"
                    >
                      <CalendarPlus className="w-3 h-3" />
                      Schedule Revision
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
