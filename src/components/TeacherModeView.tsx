import { useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  GraduationCap,
  HelpCircle,
  Loader2,
  Pause,
  Play,
  PlusCircle,
  Save,
  Send,
  Sparkles,
} from 'lucide-react';
import type { AcademicMemory, LessonSession, Subject, StudyResource, UserProfile } from '../types';
import {
  awardLearningXp,
  buildSubjectAiContext,
  createLessonSession,
  createNote,
  logStudySession,
  updateLessonSession,
} from '../services/studyDb';
import { startTeacherLesson, teacherLessonAction } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';
import { sanitizeSvgMarkup } from '../utils/safeSvg';

interface TeacherModeViewProps {
  uid: string;
  profile: UserProfile | null;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
  resources: StudyResource[];
  lessonSessions: LessonSession[];
}

interface GeneratedLesson {
  introduction: string;
  explanation: string;
  workedExamples: Array<{ title: string; problem: string; solutionMarkdown: string }>;
  whiteboardSvg: string;
  lessonNotes: string;
  knowledgeCheck: Array<{
    id: string;
    prompt: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
  }>;
}

const STAGES = ['Introduction', 'Core Lesson & Board', 'Worked Examples', 'Knowledge Check'];

export function TeacherModeView({
  uid,
  profile,
  academicMemory,
  subjects,
  resources,
  lessonSessions,
}: TeacherModeViewProps) {
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id || 'general');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<'foundation' | 'standard' | 'advanced'>('standard');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [activeLessonId, setActiveLessonId] = useState<string>('');
  const [lesson, setLesson] = useState<GeneratedLesson | null>(null);
  const [stage, setStage] = useState(0);
  const [paused, setPaused] = useState(false);
  const [questionInput, setQuestionInput] = useState('');
  const [transcript, setTranscript] = useState<Array<{ role: string; text: string }>>([]);
  const [extraExamples, setExtraExamples] = useState<string[]>([]);
  const [checkAnswers, setCheckAnswers] = useState<Record<string, string>>({});
  const [checkResult, setCheckResult] = useState<{ score: number; feedback: string } | null>(null);
  const [startedAtMs, setStartedAtMs] = useState<number>(Date.now());

  const activeSubject = useMemo(
    () => subjects.find((s) => s.id === selectedSubjectId) || null,
    [subjects, selectedSubjectId]
  );

  const pausedLessons = useMemo(
    () => lessonSessions.filter((l) => l.status === 'paused'),
    [lessonSessions]
  );

  const handleStartLesson = async () => {
    if (!topic.trim()) {
      setError('Enter a lesson topic first.');
      return;
    }
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const ctx = buildSubjectAiContext(selectedSubjectId, resources, academicMemory, 30000);
      const res = await startTeacherLesson({
        subjectName: activeSubject?.name || 'General Study',
        topic: topic.trim(),
        difficulty,
        resourcesContext: ctx,
      });
      setLesson(res);
      setStage(0);
      setPaused(false);
      setExtraExamples([]);
      setCheckAnswers({});
      setCheckResult(null);
      const initialTranscript = [
        { role: 'teacher', text: `Started lesson on ${topic.trim()}: ${res.introduction.slice(0, 300)}` },
      ];
      setTranscript(initialTranscript);
      setStartedAtMs(Date.now());

      const id = await createLessonSession(uid, {
        subjectId: selectedSubjectId || 'general',
        topic: topic.trim(),
        stage: 0,
        status: 'active',
        transcript: initialTranscript,
        notesContent: res.lessonNotes,
        score: 0,
        durationMinutes: 0,
      });
      setActiveLessonId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start lesson.');
    } finally {
      setLoading(false);
    }
  };

  const handleAskQuestion = async () => {
    if (!questionInput.trim() || !lesson) return;
    const q = questionInput.trim();
    setQuestionInput('');
    setActionLoading(true);
    setError('');
    try {
      const ctx = buildSubjectAiContext(selectedSubjectId, resources, academicMemory, 15000);
      const res = await teacherLessonAction({
        subjectName: activeSubject?.name || 'General Study',
        topic,
        action: 'qa',
        question: q,
        resourcesContext: ctx,
      });
      const nextTranscript = [
        ...transcript,
        { role: 'student', text: q },
        { role: 'teacher', text: res.markdown || '' },
      ];
      setTranscript(nextTranscript);
      if (activeLessonId) {
        await updateLessonSession(activeLessonId, { transcript: nextTranscript }).catch(() => {});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not answer question.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleMoreExamples = async () => {
    if (!lesson) return;
    setActionLoading(true);
    setError('');
    try {
      const res = await teacherLessonAction({
        subjectName: activeSubject?.name || 'General Study',
        topic,
        action: 'example',
      });
      if (res.markdown) {
        setExtraExamples((prev) => [...prev, res.markdown!]);
        setStage(2);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate example.');
    } finally {
      setActionLoading(false);
    }
  };

  const handlePauseToggle = async () => {
    const nextPaused = !paused;
    setPaused(nextPaused);
    if (activeLessonId) {
      const elapsed = Math.max(1, Math.round((Date.now() - startedAtMs) / 60000));
      await updateLessonSession(activeLessonId, {
        status: nextPaused ? 'paused' : 'active',
        stage,
        durationMinutes: elapsed,
        transcript,
      }).catch(() => {});
      setNotice(nextPaused ? 'Lesson paused and progress saved.' : 'Lesson resumed.');
    }
  };

  const handleResumeSaved = async (saved: LessonSession) => {
    setSelectedSubjectId(saved.subjectId);
    setTopic(saved.topic);
    setActiveLessonId(saved.id);
    setTranscript(saved.transcript || []);
    setPaused(false);
    setLoading(true);
    setError('');
    try {
      const ctx = buildSubjectAiContext(saved.subjectId, resources, academicMemory, 25000);
      const res = await startTeacherLesson({
        subjectName: subjects.find((s) => s.id === saved.subjectId)?.name || 'General Study',
        topic: saved.topic,
        difficulty,
        resourcesContext: ctx,
      });
      setLesson(res);
      setStage(Math.min(saved.stage || 0, 3));
      await updateLessonSession(saved.id, { status: 'active' }).catch(() => {});
      setNotice(`Resumed "${saved.topic}" at stage ${Math.min(saved.stage + 1, 4)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not resume lesson.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNotes = async () => {
    if (!lesson) return;
    try {
      await createNote(uid, {
        subjectId: selectedSubjectId || 'general',
        resourceId: '',
        title: `Lesson Notes: ${topic}`,
        style: 'detailed',
        content: lesson.lessonNotes,
        isBookmarked: false,
      });
      setNotice('Lesson notes saved automatically to your subject notebook.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save lesson notes.');
    }
  };

  const handleSubmitKnowledgeCheck = async () => {
    if (!lesson) return;
    setActionLoading(true);
    setError('');
    try {
      const res = await teacherLessonAction({
        subjectName: activeSubject?.name || 'General Study',
        topic,
        action: 'grade_check',
        answers: checkAnswers,
        knowledgeCheck: lesson.knowledgeCheck.map((q) => ({
          id: q.id,
          prompt: q.prompt,
          correctAnswer: q.correctAnswer,
        })),
      });
      const score = res.score ?? 0;
      setCheckResult({ score, feedback: res.feedback || 'Knowledge check evaluated.' });
      const elapsed = Math.max(1, Math.round((Date.now() - startedAtMs) / 60000));
      if (activeLessonId) {
        await updateLessonSession(activeLessonId, {
          status: 'completed',
          stage: 3,
          score,
          durationMinutes: elapsed,
          transcript,
        }).catch(() => {});
      }
      await createNote(uid, {
        subjectId: selectedSubjectId || 'general',
        resourceId: '',
        title: `Lesson Notes: ${topic}`,
        style: 'detailed',
        content: lesson.lessonNotes,
        isBookmarked: false,
      }).catch(() => {});
      await logStudySession(uid, profile, selectedSubjectId || 'general', 'lesson', elapsed).catch(() => {});
      await awardLearningXp(uid, academicMemory, 35);
      setNotice('Lesson completed! Notes auto-saved & +35 XP earned.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grade knowledge check.');
    } finally {
      setActionLoading(false);
    }
  };

  const safeSvg = useMemo(() => (lesson ? sanitizeSvgMarkup(lesson.whiteboardSvg) : ''), [lesson]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <GraduationCap className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            AI Teacher Mode
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Structured virtual classroom with visual board diagrams, mid-lesson Q&amp;A, extra examples, pause/resume, and mastery checks.
          </p>
        </div>

        {lesson && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handlePauseToggle()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
              {paused ? 'Resume Lesson' : 'Pause Lesson'}
            </button>
            <button
              type="button"
              onClick={() => void handleSaveNotes()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 dark:bg-indigo-600 text-white text-xs font-medium hover:opacity-90"
            >
              <Save className="w-3.5 h-3.5" />
              Save Notes
            </button>
          </div>
        )}
      </div>

      {/* Lesson Launcher */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Subject</label>
            <select
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
            >
              <option value="general">General Study</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Lesson Topic</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., Integration by Parts, Mitosis vs Meiosis, Fiscal Policy..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Depth</label>
            <div className="flex gap-2">
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as 'foundation' | 'standard' | 'advanced')}
                className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
              >
                <option value="foundation">Foundation</option>
                <option value="standard">Standard</option>
                <option value="advanced">Advanced</option>
              </select>
              <button
                type="button"
                disabled={loading}
                onClick={() => void handleStartLesson()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium whitespace-nowrap"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Teach
              </button>
            </div>
          </div>
        </div>

        {pausedLessons.length > 0 && !lesson && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Paused Lessons — Resume</p>
            <div className="flex flex-wrap gap-2">
              {pausedLessons.slice(0, 4).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => void handleResumeSaved(p)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-indigo-500"
                >
                  <Play className="w-3 h-3 text-indigo-600" />
                  <span>{p.topic}</span>
                  <span className="text-slate-400">· Stage {p.stage + 1}/4</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      {lesson && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Lesson Classroom */}
          <div className="lg:col-span-2 space-y-5">
            {/* Stage Stepper */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {STAGES.map((label, idx) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setStage(idx)}
                  className={`px-3 py-2.5 rounded-xl border text-xs font-semibold text-left transition-colors ${
                    stage === idx
                      ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <span className="block text-[10px] uppercase tracking-wider opacity-70">Step {idx + 1}</span>
                  {label}
                </button>
              ))}
            </div>

            {paused ? (
              <div className="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/70 dark:bg-amber-950/20 p-10 text-center space-y-3">
                <Pause className="w-8 h-8 text-amber-600 mx-auto" />
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">Lesson Paused</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Your progress at {STAGES[stage]} is saved. Click Resume whenever you are ready.
                </p>
                <button
                  type="button"
                  onClick={() => void handlePauseToggle()}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium"
                >
                  Resume Lesson
                </button>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5">
                {stage === 0 && (
                  <div className="space-y-4">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <BookOpen className="w-5 h-5 text-indigo-600" />
                      Introduction: {topic}
                    </h2>
                    <MarkdownView content={lesson.introduction} />
                    <button
                      type="button"
                      onClick={() => setStage(1)}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
                    >
                      Continue to Core Lesson →
                    </button>
                  </div>
                )}

                {stage === 1 && (
                  <div className="space-y-5">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">Core Explanation &amp; Interactive Board</h2>
                    {safeSvg && (
                      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                          Classroom Whiteboard Diagram
                        </p>
                        <div dangerouslySetInnerHTML={{ __html: safeSvg }} />
                      </div>
                    )}
                    <MarkdownView content={lesson.explanation} />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setStage(2)}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
                      >
                        Worked Examples →
                      </button>
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => void handleMoreExamples()}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200"
                      >
                        <PlusCircle className="w-4 h-4" />
                        Confused — Generate Another Example
                      </button>
                    </div>
                  </div>
                )}

                {stage === 2 && (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">Worked Examples</h2>
                      <button
                        type="button"
                        disabled={actionLoading}
                        onClick={() => void handleMoreExamples()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-indigo-600 dark:text-indigo-400"
                      >
                        {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PlusCircle className="w-3.5 h-3.5" />}
                        Another Example
                      </button>
                    </div>
                    {lesson.workedExamples.map((ex, i) => (
                      <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 bg-slate-50/70 dark:bg-slate-900/40">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{ex.title}</p>
                        <p className="text-sm text-slate-700 dark:text-slate-200 font-medium">{ex.problem}</p>
                        <MarkdownView content={ex.solutionMarkdown} />
                      </div>
                    ))}
                    {extraExamples.map((md, idx) => (
                      <div key={`extra_${idx}`} className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 p-4 bg-indigo-50/40 dark:bg-indigo-950/20">
                        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-2">
                          Additional Example #{idx + 1}
                        </p>
                        <MarkdownView content={md} />
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setStage(3)}
                      className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
                    >
                      Proceed to Knowledge Check →
                    </button>
                  </div>
                )}

                {stage === 3 && (
                  <div className="space-y-5">
                    <h2 className="text-lg font-bold text-slate-900 dark:text-white">End-of-Lesson Knowledge Check</h2>
                    {lesson.knowledgeCheck.map((q, idx) => (
                      <div key={q.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          {idx + 1}. {q.prompt}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {q.options.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => setCheckAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                              className={`px-3 py-2 rounded-xl border text-left text-xs font-medium transition-colors ${
                                checkAnswers[q.id] === opt
                                  ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                                  : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                        {checkResult && (
                          <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 p-2.5 rounded-lg">
                            Answer: <strong>{q.correctAnswer}</strong> — {q.explanation}
                          </p>
                        )}
                      </div>
                    ))}

                    <button
                      type="button"
                      disabled={actionLoading}
                      onClick={() => void handleSubmitKnowledgeCheck()}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                      Submit Knowledge Check &amp; Complete Lesson
                    </button>

                    {checkResult && (
                      <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 space-y-1">
                        <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300 tabular-nums">
                          Score: {checkResult.score}%
                        </p>
                        <p className="text-sm text-emerald-700 dark:text-emerald-200">{checkResult.feedback}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Col: Ask Question Anytime + Transcript */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 flex flex-col gap-4 h-fit">
            <div className="flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-indigo-600" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Ask a Question Anytime</h3>
            </div>
            <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
              {transcript.map((item, idx) => (
                <div
                  key={idx}
                  className={`rounded-xl px-3 py-2 text-xs ${
                    item.role === 'student'
                      ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 ml-4'
                      : 'bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 mr-2'
                  }`}
                >
                  <span className="block text-[10px] font-semibold uppercase tracking-wider opacity-60 mb-1">
                    {item.role === 'student' ? 'You' : 'AI Teacher'}
                  </span>
                  <MarkdownView content={item.text} />
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={questionInput}
                onChange={(e) => setQuestionInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleAskQuestion();
                }}
                placeholder="Ask why a step works..."
                className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-white"
              />
              <button
                type="button"
                disabled={actionLoading || !questionInput.trim()}
                onClick={() => void handleAskQuestion()}
                className="p-2 rounded-xl bg-indigo-600 text-white disabled:opacity-50"
                aria-label="Send question"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
