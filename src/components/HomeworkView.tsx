import { useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  HelpCircle,
  Lightbulb,
  Loader2,
  Plus,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import type { AcademicMemory, HomeworkItem, Subject } from '../types';
import { analyzeHomeworkWorksheet, analyzeMistakeEntry, checkHomeworkAnswer } from '../services/geminiApi';
import {
  awardLearningXp,
  createHomeworkItem,
  createMistakeEntry,
  deleteHomeworkItem,
  updateHomeworkSubmission,
} from '../services/studyDb';

interface HomeworkViewProps {
  uid: string;
  academicMemory?: AcademicMemory | null;
  subjects: Subject[];
  homeworkItems: HomeworkItem[];
}

export function HomeworkView({ uid, academicMemory, subjects, homeworkItems }: HomeworkViewProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id || '');
  const [title, setTitle] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeHwId, setActiveHwId] = useState<string>(homeworkItems[0]?.id || '');
  const [revealedHints, setRevealedHints] = useState<Record<string, boolean>>({});
  const [revealedSteps, setRevealedSteps] = useState<Record<string, boolean>>({});
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [checkingQId, setCheckingQId] = useState<string | null>(null);

  const activeSubject = useMemo(
    () => subjects.find((s) => s.id === selectedSubjectId) || subjects[0] || null,
    [subjects, selectedSubjectId]
  );

  const activeHw = useMemo(
    () => homeworkItems.find((h) => h.id === activeHwId) || homeworkItems[0] || null,
    [homeworkItems, activeHwId]
  );

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile && !pastedText.trim()) {
      setError('Upload a photo/PDF of a worksheet or paste your homework questions.');
      return;
    }
    setError(null);
    setAnalyzing(true);
    try {
      const res = await analyzeHomeworkWorksheet({
        file: selectedFile,
        pastedText,
        title,
        subjectName: activeSubject?.name || 'General Study',
      });
      const id = await createHomeworkItem(
        uid,
        activeSubject?.id || 'general',
        res.title,
        res.questions
      );
      setActiveHwId(id);
      setTitle('');
      setPastedText('');
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze homework worksheet.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCheckAnswer = async (hw: HomeworkItem, questionId: string, questionPrompt: string) => {
    const answerText = (draftAnswers[questionId] ?? hw.studentAnswers[questionId] ?? '').trim();
    if (!answerText) return;
    setCheckingQId(questionId);
    setError(null);
    try {
      const subj = subjects.find((s) => s.id === hw.subjectId)?.name || 'General';
      const feedback = await checkHomeworkAnswer({
        subjectName: subj,
        questionPrompt,
        studentAnswer: answerText,
      });
      await updateHomeworkSubmission(
        hw.id,
        { ...hw.studentAnswers, [questionId]: answerText },
        { ...hw.aiFeedback, [questionId]: feedback }
      );
      await awardLearningXp(uid, academicMemory || null, 15);
      if (!feedback.isCorrect) {
        const qMeta = hw.questions.find((q) => q.id === questionId);
        try {
          const diagnosed = await analyzeMistakeEntry({
            subjectName: subj,
            topic: qMeta?.topic,
            question: questionPrompt,
            studentAnswer: answerText,
            correctAnswer: feedback.explanation,
          });
          await createMistakeEntry(uid, {
            subjectId: hw.subjectId,
            topic: diagnosed.inferredTopic || qMeta?.topic || 'Homework Concept',
            question: questionPrompt,
            studentAnswer: answerText,
            correctAnswer: 'See worked guidance',
            misconception: diagnosed.misconception,
            explanation: diagnosed.explanation,
            practiceQuestion: feedback.similarQuestion || diagnosed.practiceQuestion,
            resolved: false,
          });
        } catch {
          // non-blocking
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to evaluate homework answer.');
    } finally {
      setCheckingQId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Smart Homework Assistant
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Upload a worksheet photo or paste questions for scaffolded hints, step-by-step guidance, answer verification, and similar practice prompts.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Upload + History Sidebar */}
        <div className="space-y-5">
          <form
            onSubmit={handleAnalyze}
            className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3.5"
          >
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Analyze New Worksheet
            </h2>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Subject
              </label>
              <select
                value={activeSubject?.id || ''}
                onChange={(e) => setSelectedSubjectId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {subjects.length === 0 ? (
                  <option value="general">General Homework</option>
                ) : (
                  subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Assignment Title (optional)
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Week 4 Calculus Problem Set"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Worksheet Photo, PDF, or Document
              </label>
              <input
                ref={fileRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt"
                onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                className="block w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-indigo-50 dark:file:bg-indigo-950/60 file:text-indigo-700 dark:file:text-indigo-300 file:text-xs file:font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Or Paste Homework Questions
              </label>
              <textarea
                rows={4}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Paste worksheet questions here..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={analyzing}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-60"
            >
              {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {analyzing ? 'Recognizing Questions...' : 'Recognize & Scaffold'}
            </button>
          </form>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-2.5">
            <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Saved Worksheets ({homeworkItems.length})
            </h3>
            {homeworkItems.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">No homework worksheets analyzed yet.</p>
            ) : (
              <div className="space-y-1.5">
                {homeworkItems.map((hw) => (
                  <div
                    key={hw.id}
                    className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs ${
                      activeHw?.id === hw.id
                        ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200'
                        : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setActiveHwId(hw.id)}
                      className="flex-1 text-left truncate font-medium"
                    >
                      {hw.title} ({hw.questions.length} Qs)
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteHomeworkItem(hw.id)}
                      className="text-slate-400 hover:text-rose-600 p-1"
                      aria-label="Delete homework worksheet"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Active Worksheet Questions */}
        <div className="lg:col-span-2 space-y-4">
          {!activeHw ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-12 text-center space-y-2">
              <ClipboardCheck className="w-8 h-8 text-indigo-500 mx-auto" />
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                Upload a worksheet to break down every question
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Request hints without spoiling answers, walk through step-by-step scaffolding, or submit your solution for immediate feedback.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] px-5 py-4 flex items-center justify-between">
                <div>
                  <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
                    {activeHw.title}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {activeHw.questions.length} recognized questions
                  </p>
                </div>
              </div>

              {activeHw.questions.map((q, idx) => {
                const showHint = Boolean(revealedHints[q.id]);
                const showSteps = Boolean(revealedSteps[q.id]);
                const ans = draftAnswers[q.id] ?? activeHw.studentAnswers[q.id] ?? '';
                const fb = activeHw.aiFeedback[q.id];

                return (
                  <div
                    key={q.id}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                          Question {idx + 1} · {q.topic}
                        </p>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white mt-1 leading-relaxed">
                          {q.prompt}
                        </p>
                      </div>
                    </div>

                    <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 px-3.5 py-2.5 text-xs text-slate-700 dark:text-slate-300">
                      <span className="font-semibold text-slate-900 dark:text-white">What it asks: </span>
                      {q.whatItAsks}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setRevealedHints((p) => ({ ...p, [q.id]: !p[q.id] }))}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-900/50 text-xs font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                      >
                        <Lightbulb className="w-3.5 h-3.5" />
                        {showHint ? 'Hide Hint' : 'Request Hint (No Spoiler)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRevealedSteps((p) => ({ ...p, [q.id]: !p[q.id] }))}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                        {showSteps ? 'Hide Step-by-Step Guide' : 'Show Step-by-Step Guide'}
                      </button>
                    </div>

                    {showHint && (
                      <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 px-4 py-3 text-xs text-amber-900 dark:text-amber-200">
                        <span className="font-semibold">Hint: </span>
                        {q.hint}
                      </div>
                    )}

                    {showSteps && (
                      <ol className="list-decimal list-inside space-y-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 px-4 py-3 text-xs text-slate-700 dark:text-slate-300">
                        {q.steps.map((step, sIdx) => (
                          <li key={sIdx}>{step}</li>
                        ))}
                      </ol>
                    )}

                    <div className="space-y-2 pt-1">
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                        Your Attempt / Answer
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <textarea
                          rows={2}
                          value={ans}
                          onChange={(e) => setDraftAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                          placeholder="Write your working or final answer to get checked..."
                          className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => void handleCheckAnswer(activeHw, q.id, q.prompt)}
                          disabled={checkingQId === q.id || !ans.trim()}
                          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-60 self-start sm:self-stretch"
                        >
                          {checkingQId === q.id ? 'Checking...' : 'Check Answer'}
                        </button>
                      </div>
                    </div>

                    {fb && (
                      <div
                        className={`rounded-xl border p-4 space-y-2 text-xs ${
                          fb.isCorrect
                            ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200'
                            : 'border-rose-200 dark:border-rose-900/50 bg-rose-50/70 dark:bg-rose-950/20 text-rose-900 dark:text-rose-200'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-semibold">
                          {fb.isCorrect ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          ) : (
                            <XCircle className="w-4 h-4 text-rose-600" />
                          )}
                          <span>{fb.isCorrect ? 'Solid Solution' : 'Needs Correction'}</span>
                        </div>
                        <p className="leading-relaxed">{fb.explanation}</p>
                        <div className="pt-2 border-t border-current/15">
                          <p className="font-semibold flex items-center gap-1">
                            <Plus className="w-3.5 h-3.5" />
                            Similar Practice Question
                          </p>
                          <p className="mt-0.5">{fb.similarQuestion}</p>
                        </div>
                      </div>
                    )}
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
