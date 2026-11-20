import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
  Play,
  Trash2,
  XCircle,
} from 'lucide-react';
import type {
  AcademicMemory,
  QuestionType,
  Quiz,
  QuizDifficulty,
  StudyResource,
  Subject,
  UserProfile,
} from '../../types';
import {
  awardLearningXp,
  buildSubjectAiContext,
  completeQuiz,
  createMistakeEntry,
  createQuiz,
  deleteQuiz,
  logStudySession,
} from '../../services/studyDb';
import { analyzeMistakeEntry, generateQuiz, gradeQuiz } from '../../services/geminiApi';

interface QuizPanelProps {
  uid: string;
  profile: UserProfile | null;
  academicMemory?: AcademicMemory | null;
  subject: Subject;
  resources: StudyResource[];
  quizzes: Quiz[];
  onAskTutorAboutMistake: (prompt: string) => void;
}

const QUESTION_TYPE_OPTIONS: Array<{ id: QuestionType; label: string }> = [
  { id: 'mcq', label: 'Multiple Choice' },
  { id: 'tf', label: 'True / False' },
  { id: 'short', label: 'Short Answer' },
  { id: 'extended', label: 'Extended Response' },
  { id: 'calculation', label: 'Calculation' },
  { id: 'application', label: 'Application' },
];

export function QuizPanel({
  uid,
  profile,
  academicMemory,
  subject,
  resources,
  quizzes,
  onAskTutorAboutMistake,
}: QuizPanelProps) {
  const subjectResources = resources.filter((r) => r.subjectId === subject.id);
  const subjectQuizzes = quizzes.filter((q) => q.subjectId === subject.id);

  // Generator state
  const [questionCount, setQuestionCount] = useState(6);
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('standard');
  const [selectedTypes, setSelectedTypes] = useState<QuestionType[]>(['mcq', 'tf', 'short', 'application']);
  const [isTimed, setIsTimed] = useState(false);
  const [isMockExam, setIsMockExam] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [customTopic, setCustomTopic] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active quiz state
  const [activeQuizId, setActiveQuizId] = useState<string | null>(subjectQuizzes[0]?.id || null);
  const activeQuiz = subjectQuizzes.find((q) => q.id === activeQuizId) || subjectQuizzes[0] || null;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [grading, setGrading] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  const pastWeakTopics = useMemo(() => {
    const set = new Set<string>();
    subjectQuizzes
      .filter((q) => q.status === 'completed')
      .forEach((q) => q.weakTopics.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [subjectQuizzes]);

  useEffect(() => {
    if (activeQuiz && activeQuiz.status === 'in_progress') {
      setAnswers(activeQuiz.answers || {});
      if (activeQuiz.isTimed) {
        setSecondsRemaining(activeQuiz.durationMinutes * 60);
      } else {
        setSecondsRemaining(null);
      }
    } else {
      setSecondsRemaining(null);
    }
  }, [activeQuiz?.id, activeQuiz?.status]);

  useEffect(() => {
    if (secondsRemaining === null || secondsRemaining <= 0 || !activeQuiz || activeQuiz.status === 'completed') {
      return;
    }
    const timer = window.setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          window.clearInterval(timer);
          void handleSubmitQuiz();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsRemaining, activeQuiz?.id]);

  const toggleType = (type: QuestionType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? (prev.length > 1 ? prev.filter((t) => t !== type) : prev) : [...prev, type]
    );
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setError(null);
    try {
      const resourcesText = buildSubjectAiContext(subject.id, resources, academicMemory || null, 50000);

      const generated = await generateQuiz({
        subjectName: subject.name,
        resourcesText,
        count: questionCount,
        difficulty,
        questionTypes: selectedTypes,
        pastWeakTopics,
        customTopic: customTopic.trim(),
        isMockExam,
      });

      const quizId = await createQuiz(uid, {
        subjectId: subject.id,
        title: isMockExam && !generated.title.toLowerCase().includes('mock') ? `Mock Exam: ${generated.title}` : generated.title,
        difficulty,
        isTimed: isMockExam ? true : isTimed,
        durationMinutes: isTimed || isMockExam ? durationMinutes : Math.max(5, questionCount * 2),
        questions: generated.questions,
      });

      setActiveQuizId(quizId);
      setAnswers({});
      setCustomTopic('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate assessment.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmitQuiz = async () => {
    if (!activeQuiz || activeQuiz.status === 'completed' || grading) return;
    setGrading(true);
    setError(null);
    try {
      const graded = await gradeQuiz({
        subjectName: subject.name,
        questions: activeQuiz.questions,
        answers,
      });
      await completeQuiz(activeQuiz.id, {
        answers,
        results: graded.results,
        score: graded.score,
        weakTopics: graded.weakTopics,
        aiSummary: graded.aiSummary,
      });
      await logStudySession(uid, profile, subject.id, 'quiz', Math.max(5, activeQuiz.questions.length * 2), {
        quizzesCompletedCount: subjectQuizzes.filter((q) => q.status === 'completed').length + 1,
      }).catch(() => {});
      await awardLearningXp(uid, academicMemory || null, 30);

      // Auto-record wrong quiz responses into Mistake Database (#20.6)
      const wrongQs = activeQuiz.questions
        .filter((q) => {
          const r = graded.results.find((res) => res.questionId === q.id);
          return r && !r.isCorrect;
        })
        .slice(0, 5);
      await Promise.all(
        wrongQs.map(async (q) => {
          const userAns = answers[q.id] || '(blank)';
          const r = graded.results.find((res) => res.questionId === q.id);
          try {
            const diagnosed = await analyzeMistakeEntry({
              subjectName: subject.name,
              topic: q.topic,
              question: q.prompt,
              studentAnswer: userAns,
              correctAnswer: q.correctAnswer,
            });
            await createMistakeEntry(uid, {
              subjectId: subject.id,
              topic: diagnosed.inferredTopic || q.topic,
              question: q.prompt,
              studentAnswer: userAns,
              correctAnswer: q.correctAnswer,
              misconception: diagnosed.misconception,
              explanation: diagnosed.explanation,
              practiceQuestion: diagnosed.practiceQuestion,
              resolved: false,
            });
          } catch {
            await createMistakeEntry(uid, {
              subjectId: subject.id,
              topic: q.topic || 'Assessment Concept',
              question: q.prompt,
              studentAnswer: userAns,
              correctAnswer: q.correctAnswer,
              misconception: r?.feedback || 'Concept review needed',
              explanation: q.explanation,
              practiceQuestion: `Re-explain why "${q.correctAnswer}" answers: ${q.prompt}`,
              resolved: false,
            }).catch(() => {});
          }
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grade quiz.');
    } finally {
      setGrading(false);
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      {/* Quiz Generator */}
      <form
        onSubmit={handleGenerate}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              AI Quiz & Full Mock Exam Simulator
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Generates adaptive practice quizzes or full-length timed mock exams
              {pastWeakTopics.length > 0 ? ` · Targeting past gaps: ${pastWeakTopics.slice(0, 3).join(', ')}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !isMockExam;
              setIsMockExam(next);
              if (next) {
                setQuestionCount(15);
                setIsTimed(true);
                setDurationMinutes(45);
                setDifficulty('standard');
                setSelectedTypes(['mcq', 'short', 'extended', 'calculation', 'application']);
              }
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors self-start ${
              isMockExam
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            {isMockExam ? 'Mock Exam Mode Active (45m)' : 'Switch to Full Mock Exam'}
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Questions ({questionCount})
            </label>
            <input
              type="range"
              min={3}
              max={25}
              value={questionCount}
              onChange={(e) => setQuestionCount(Number(e.target.value))}
              className="w-full accent-indigo-600"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Difficulty
            </label>
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as QuizDifficulty)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
            >
              <option value="foundation">Foundation</option>
              <option value="standard">Standard Exam</option>
              <option value="advanced">Advanced / Stretch</option>
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Topic Focus (optional)
            </label>
            <input
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="e.g. Reaction mechanisms or leave blank"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
            />
          </div>

          <div className="md:col-span-2 flex items-end">
            <button
              type="submit"
              disabled={generating}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {generating ? 'Building...' : 'Create Exam'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-1.5">
            {QUESTION_TYPE_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggleType(opt.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  selectedTypes.includes(opt.id)
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={isTimed}
                onChange={(e) => setIsTimed(e.target.checked)}
                className="rounded border-slate-300 text-indigo-600"
              />
              Timed Exam
            </label>
            {isTimed && (
              <input
                type="number"
                min={2}
                max={180}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="w-20 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs tabular-nums"
              />
            )}
          </div>
        </div>
      </form>

      {/* Assessment Browser & Runner */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 space-y-2 max-h-[650px] overflow-y-auto">
          <h4 className="font-display text-xs font-semibold text-slate-500 dark:text-slate-400 px-2 pb-1">
            Assessments ({subjectQuizzes.length})
          </h4>
          {subjectQuizzes.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 px-2 py-6 text-center">
              Generate a practice quiz or timed exam above.
            </p>
          ) : (
            subjectQuizzes.map((q) => (
              <div
                key={q.id}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl transition-colors ${
                  activeQuiz?.id === q.id
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveQuizId(q.id)}
                  className="text-left flex-1 min-w-0"
                >
                  <p className="text-sm font-medium truncate">{q.title}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {q.status === 'completed'
                      ? `Score: ${q.score}/${q.maxScore} (${Math.round((q.score / Math.max(1, q.maxScore)) * 100)}%)`
                      : `${q.questions.length} questions · In progress`}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => deleteQuiz(q.id)}
                  className="p-1 text-slate-400 hover:text-rose-600 shrink-0"
                  aria-label="Delete quiz"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="lg:col-span-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6">
          {!activeQuiz ? (
            <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
              Select or generate an assessment to begin.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                    {activeQuiz.title}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 capitalize mt-0.5 tabular-nums">
                    {activeQuiz.difficulty} · {activeQuiz.questions.length} questions · {activeQuiz.maxScore} points
                  </p>
                </div>

                {activeQuiz.status === 'in_progress' && secondsRemaining !== null && (
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 font-mono text-sm font-semibold tabular-nums">
                    <Clock className="w-4 h-4" />
                    {formatTimer(secondsRemaining)}
                  </div>
                )}

                {activeQuiz.status === 'completed' && (
                  <div className="text-right">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Final Score</p>
                    <p className="font-display text-xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                      {activeQuiz.score} / {activeQuiz.maxScore} (
                      {Math.round((activeQuiz.score / Math.max(1, activeQuiz.maxScore)) * 100)}%)
                    </p>
                  </div>
                )}
              </div>

              {/* Performance Report if Completed */}
              {activeQuiz.status === 'completed' && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-2">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    Gemini Mistake Analysis & Performance Report
                  </p>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                    {activeQuiz.aiSummary}
                  </p>
                  {activeQuiz.weakTopics.length > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 pt-1">
                      Weak topics identified: {activeQuiz.weakTopics.join(' · ')}
                    </p>
                  )}
                </div>
              )}

              {/* Questions */}
              <div className="space-y-6">
                {activeQuiz.questions.map((q, index) => {
                  const res = activeQuiz.results.find((r) => r.questionId === q.id);
                  const userAns =
                    activeQuiz.status === 'completed' ? activeQuiz.answers[q.id] || '' : answers[q.id] || '';

                  return (
                    <div
                      key={q.id}
                      className="pb-6 border-b last:border-b-0 border-slate-100 dark:border-slate-800 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white leading-relaxed">
                          <span className="text-slate-400 font-mono mr-2">{index + 1}.</span>
                          {q.prompt}
                        </p>
                        <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
                          {q.topic} · {q.points} pt{q.points > 1 ? 's' : ''}
                        </span>
                      </div>

                      {q.options && q.options.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {q.options.map((opt) => {
                            const selected = userAns === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                disabled={activeQuiz.status === 'completed'}
                                onClick={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                                className={`text-left px-4 py-2.5 rounded-xl border text-sm transition-colors ${
                                  selected
                                    ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 font-medium'
                                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <textarea
                          rows={q.type === 'extended' || q.type === 'calculation' ? 4 : 2}
                          disabled={activeQuiz.status === 'completed'}
                          value={userAns}
                          onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                          placeholder="Write your answer and working here..."
                          className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      )}

                      {activeQuiz.status === 'completed' && res && (
                        <div
                          className={`rounded-xl p-3.5 text-xs space-y-1.5 border ${
                            res.isCorrect
                              ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20'
                              : res.earnedPoints > 0
                                ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20'
                                : 'border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/20'
                          }`}
                        >
                          <div className="flex items-center justify-between font-semibold">
                            <span className="inline-flex items-center gap-1.5">
                              {res.isCorrect ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              ) : res.earnedPoints > 0 ? (
                                <AlertCircle className="w-4 h-4 text-amber-600" />
                              ) : (
                                <XCircle className="w-4 h-4 text-rose-600" />
                              )}
                              {res.isCorrect ? 'Correct' : res.earnedPoints > 0 ? 'Partial Credit' : 'Incorrect'}
                            </span>
                            <span className="tabular-nums">
                              {res.earnedPoints} / {res.maxPoints} pts
                            </span>
                          </div>
                          <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{res.feedback}</p>
                          <p className="text-slate-500 dark:text-slate-400">
                            <strong>Model Answer:</strong> {q.correctAnswer} — {q.explanation}
                          </p>
                          {!res.isCorrect && (
                            <button
                              type="button"
                              onClick={() =>
                                onAskTutorAboutMistake(
                                  `I missed this question on "${q.topic}": "${q.prompt}". My answer was "${userAns || 'blank'}", and the model answer is "${q.correctAnswer}". Please explain my mistake and help me understand it.`
                                )
                              }
                              className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-medium hover:underline pt-1"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              Explain my mistake with AI Tutor
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {activeQuiz.status === 'in_progress' && (
                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => void handleSubmitQuiz()}
                    disabled={grading}
                    className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
                  >
                    {grading && <Loader2 className="w-4 h-4 animate-spin" />}
                    {grading ? 'Marking with Gemini...' : 'Submit & Grade Assessment'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
