import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  FileCheck2,
  FileText,
  Flame,
  GripVertical,
  Layers,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Timer,
  Undo2,
} from 'lucide-react';
import type {
  AcademicMemory,
  AIRecommendation,
  AppSection,
  Flashcard,
  Quiz,
  QuizQuestion,
  StudyPlanTask,
  StudyResource,
  StudySession,
  Subject,
  UserProfile,
  WorkspaceTab,
} from '../types';
import {
  awardLearningXp,
  createNote,
  createStudyPlanTasksBatch,
  DEFAULT_DASHBOARD_WIDGETS,
  getTodayIsoDate,
  getYesterdayIsoDate,
  logStudySession,
  toggleTaskCompleted,
  updateAcademicMemory,
} from '../services/studyDb';
import { fetchDashboardRecommendations, runAutopilot } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';
import emptyWorkspaceImg from '../assets/images/empty_workspace_still_1794946789815.jpg';

interface DashboardViewProps {
  uid: string;
  profile: UserProfile | null;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
  resources: StudyResource[];
  flashcards: Flashcard[];
  quizzes: Quiz[];
  tasks: StudyPlanTask[];
  sessions: StudySession[];
  onStartStudying: () => void;
  onCreateSubject: () => void;
  onOpenSubject: (subjectId: string, tab?: WorkspaceTab) => void;
  onNavigate: (section: AppSection) => void;
  onOpenQuickTutor: (subjectId: string, initialQuestion?: string) => void;
}

const WIDGET_LABELS: Record<string, string> = {
  metrics: 'KPI Strip',
  autopilot: 'AI Study Autopilot',
  quick_tutor: 'Quick-Access AI Tutor',
  today_plan: "Today's Study Plan",
  subject_progress: 'Subject Progress',
  recommendations: 'AI Recommendations',
  upcoming_exams: 'Upcoming Exams',
  recent_docs: 'Recent Documents',
};

export function DashboardView({
  uid,
  profile,
  academicMemory,
  subjects,
  resources,
  flashcards,
  quizzes,
  tasks,
  sessions,
  onStartStudying: _onStartStudying,
  onCreateSubject,
  onOpenSubject,
  onNavigate,
  onOpenQuickTutor,
}: DashboardViewProps) {
  const today = getTodayIsoDate();
  const [quickPrompt, setQuickPrompt] = useState('');
  const [quickSubjectId, setQuickSubjectId] = useState('');
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachData, setCoachData] = useState<{
    coachMessage: string;
    recommendations: AIRecommendation[];
  } | null>(null);

  // AI Study Autopilot state
  const [autopilotLoading, setAutopilotLoading] = useState(false);
  const [autopilotError, setAutopilotError] = useState<string | null>(null);
  const [autopilotData, setAutopilotData] = useState<{
    focusSubjectId: string;
    briefing: string;
    nextActionLabel: string;
    microNoteTitle: string;
    microNoteContent: string;
    practiceQuestions: QuizQuestion[];
  } | null>(null);
  const [warmupAnswers, setWarmupAnswers] = useState<Record<string, string>>({});

  // Customizable Drag-and-Drop Dashboard Widgets + Undo
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [dragWidgetId, setDragWidgetId] = useState<string | null>(null);
  const [widgetUndoStack, setWidgetUndoStack] = useState<string[][]>([]);

  const activeWidgets = useMemo(() => {
    const list = academicMemory?.dashboardWidgets;
    return list && list.length > 0 ? list : DEFAULT_DASHBOARD_WIDGETS;
  }, [academicMemory]);

  const saveWidgetOrder = async (nextWidgets: string[]) => {
    setWidgetUndoStack((u) => [...u.slice(-8), activeWidgets]);
    await updateAcademicMemory(uid, { dashboardWidgets: nextWidgets }).catch(() => {});
  };

  const handleUndoWidgets = async () => {
    if (widgetUndoStack.length === 0) return;
    const prev = widgetUndoStack[widgetUndoStack.length - 1];
    setWidgetUndoStack((u) => u.slice(0, -1));
    await updateAcademicMemory(uid, { dashboardWidgets: prev }).catch(() => {});
  };

  const toggleWidgetVisibility = (id: string) => {
    const next = activeWidgets.includes(id)
      ? activeWidgets.filter((w) => w !== id)
      : [...activeWidgets, id];
    void saveWidgetOrder(next);
  };

  const handleWidgetDrop = (targetId: string) => {
    if (!dragWidgetId || dragWidgetId === targetId) return;
    const next = [...activeWidgets];
    const fromIdx = next.indexOf(dragWidgetId);
    const toIdx = next.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, dragWidgetId);
    setDragWidgetId(null);
    void saveWidgetOrder(next);
  };

  const selectedTutorSubject = quickSubjectId || subjects[0]?.id || '';

  const todayMinutes = useMemo(
    () =>
      sessions
        .filter((s) => s.date === today)
        .reduce((acc, s) => acc + (s.durationMinutes || 0), 0),
    [sessions, today]
  );

  const yesterdayMinutes = useMemo(() => {
    const yesterday = getYesterdayIsoDate();
    return sessions
      .filter((s) => s.date === yesterday)
      .reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
  }, [sessions]);

  const studyTimeDelta = todayMinutes - yesterdayMinutes;

  const dueFlashcards = useMemo(() => {
    const nowIso = new Date().toISOString();
    return flashcards.filter((c) => c.nextReviewAt <= nowIso);
  }, [flashcards]);

  const todaysTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.scheduledDate === today)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [tasks, today]
  );

  const upcomingExams = useMemo(() => {
    return subjects
      .filter((s) => s.examDate && s.examDate >= today)
      .map((s) => {
        const diffMs = new Date(s.examDate).getTime() - new Date(today).getTime();
        const daysLeft = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        return { ...s, daysLeft };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft);
  }, [subjects, today]);

  const recentResources = useMemo(() => resources.slice(0, 5), [resources]);

  const subjectMap = useMemo(() => {
    const map = new Map<string, Subject>();
    subjects.forEach((s) => map.set(s.id, s));
    return map;
  }, [subjects]);

  const subjectStats = useMemo(() => {
    return subjects.map((subj) => {
      const subjQuizzes = quizzes.filter((q) => q.subjectId === subj.id && q.status === 'completed');
      const avgQuiz = subjQuizzes.length
        ? Math.round(
            subjQuizzes.reduce((acc, q) => acc + (q.score / Math.max(1, q.maxScore)) * 100, 0) /
              subjQuizzes.length
          )
        : null;
      const subjCards = flashcards.filter((c) => c.subjectId === subj.id);
      const dueCount = subjCards.filter((c) => c.nextReviewAt <= new Date().toISOString()).length;
      const subjResources = resources.filter((r) => r.subjectId === subj.id).length;
      return { subj, avgQuiz, cardCount: subjCards.length, dueCount, resourceCount: subjResources };
    });
  }, [subjects, quizzes, flashcards, resources]);

  const handleToggleTask = async (task: StudyPlanTask) => {
    const nextDone = !task.completed;
    await toggleTaskCompleted(task.id, nextDone);
    if (nextDone) {
      const activityType =
        task.taskType === 'flashcards'
          ? 'flashcards'
          : task.taskType === 'quiz'
            ? 'quiz'
            : task.taskType === 'reading'
              ? 'notes'
              : 'focus';
      await logStudySession(uid, profile, task.subjectId, activityType, task.durationMinutes, {
        resourcesCount: resources.length,
        flashcardsCount: flashcards.length,
        quizzesCompletedCount: quizzes.filter((q) => q.status === 'completed').length,
      }).catch(() => {});
    }
  };

  const handleRunAutopilot = async () => {
    if (subjects.length === 0) return;
    setAutopilotLoading(true);
    setAutopilotError(null);
    setWarmupAnswers({});
    try {
      const res = await runAutopilot({
        subjects: subjects.map((s) => ({
          id: s.id,
          name: s.name,
          examDate: s.examDate,
          confidence: s.confidence,
          topics: s.topics,
        })),
        resources: resources.slice(0, 12).map((r) => ({
          subjectId: r.subjectId,
          title: r.title,
          summary: r.summary,
        })),
        quizzes: quizzes
          .filter((q) => q.status === 'completed')
          .slice(0, 8)
          .map((q) => ({
            subjectId: q.subjectId,
            score: q.score,
            maxScore: q.maxScore,
            weakTopics: q.weakTopics,
          })),
        flashcardsDueCount: dueFlashcards.length,
        todayDate: today,
        dailyGoalMinutes: profile?.dailyGoalMinutes || 90,
      });

      if (res.tasks.length > 0) {
        await createStudyPlanTasksBatch(uid, res.tasks);
      }
      if (res.microNoteContent) {
        await createNote(uid, {
          subjectId: res.focusSubjectId,
          resourceId: '',
          title: res.microNoteTitle,
          style: 'quick',
          content: res.microNoteContent,
        });
      }
      await awardLearningXp(uid, academicMemory, 20);
      setAutopilotData({
        focusSubjectId: res.focusSubjectId,
        briefing: res.briefing,
        nextActionLabel: res.nextActionLabel,
        microNoteTitle: res.microNoteTitle,
        microNoteContent: res.microNoteContent,
        practiceQuestions: res.practiceQuestions,
      });
    } catch (err) {
      setAutopilotError(err instanceof Error ? err.message : 'Unable to start Study Autopilot.');
    } finally {
      setAutopilotLoading(false);
    }
  };

  const handleGenerateCoachRecommendations = async () => {
    if (subjects.length === 0) return;
    setCoachLoading(true);
    setCoachError(null);
    try {
      const data = await fetchDashboardRecommendations({
        subjects: subjects.map((s) => ({
          id: s.id,
          name: s.name,
          examDate: s.examDate,
          confidence: s.confidence,
        })),
        recentQuizzes: quizzes
          .filter((q) => q.status === 'completed')
          .slice(0, 5)
          .map((q) => ({
            title: q.title,
            score: q.score,
            maxScore: q.maxScore,
            weakTopics: q.weakTopics,
          })),
        flashcardsDueCount: dueFlashcards.length,
        resourcesCount: resources.length,
        studyMinutesToday: todayMinutes,
        dailyGoalMinutes: profile?.dailyGoalMinutes || 90,
      });
      setCoachData(data);
    } catch (err) {
      setCoachError(err instanceof Error ? err.message : 'Unable to fetch recommendations.');
    } finally {
      setCoachLoading(false);
    }
  };

  const handleQuickTutorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTutorSubject) return;
    onOpenQuickTutor(selectedTutorSubject, quickPrompt.trim() || undefined);
    setQuickPrompt('');
  };

  const goalMinutes = profile?.dailyGoalMinutes || 90;
  const goalPct = Math.min(100, Math.round((todayMinutes / goalMinutes) * 100));
  const totalHours = ((profile?.totalStudyMinutes || 0) / 60).toFixed(1);
  const flashcardCaughtUpPct =
    flashcards.length > 0
      ? Math.max(0, Math.min(100, Math.round(((flashcards.length - dueFlashcards.length) / flashcards.length) * 100)))
      : 0;

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const capitalizedFirstName = useMemo(() => {
    const raw = profile?.displayName?.trim().split(/\s+/)[0] || 'Scholar';
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, [profile?.displayName]);

  const renderWidget = (widgetId: string) => {
    if (widgetId === 'autopilot') {
      return (
        <div
          key="autopilot"
          draggable
          onDragStart={() => setDragWidgetId('autopilot')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleWidgetDrop('autopilot')}
          className="rounded-2xl border border-slate-200/80 dark:border-slate-700/70 border-t-2 border-t-indigo-500 dark:border-t-indigo-400 bg-white/85 dark:bg-[#1A202C]/85 backdrop-blur-md shadow-sm hover:shadow-md transition-shadow p-6 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <GripVertical className="w-4 h-4 text-slate-300 mt-1 cursor-grab shrink-0" />
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  Daily AI Experience · Personalized Coach Briefing
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Evaluates upcoming exams, spaced-repetition reviews ({dueFlashcards.length} due), and knowledge gaps to build your daily focus path.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleRunAutopilot()}
              disabled={autopilotLoading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold tracking-wide disabled:opacity-60 whitespace-nowrap"
            >
              {autopilotLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {autopilotLoading ? 'PREPARING YOUR DAY...' : 'START MY DAY'}
            </button>
          </div>

          {autopilotError && <p className="text-xs text-rose-600">{autopilotError}</p>}

          {autopilotData && (
            <div className="space-y-4 pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  Focus Subject: {subjectMap.get(autopilotData.focusSubjectId)?.name || 'Priority Subject'}
                </p>
                <button
                  type="button"
                  onClick={() => onOpenSubject(autopilotData.focusSubjectId, 'notes')}
                  className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  {autopilotData.nextActionLabel} →
                </button>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{autopilotData.briefing}</p>

              <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/50 p-4 space-y-2">
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  Saved Daily Micro-Note: {autopilotData.microNoteTitle}
                </p>
                <MarkdownView content={autopilotData.microNoteContent} className="text-xs" />
              </div>

              {autopilotData.practiceQuestions.length > 0 && (
                <div className="space-y-2.5">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Warm-Up Practice Questions
                  </p>
                  {autopilotData.practiceQuestions.map((pq, i) => {
                    const picked = warmupAnswers[pq.id];
                    return (
                      <div key={pq.id || i} className="rounded-xl border border-slate-100 dark:border-slate-800 p-3.5 text-xs space-y-2">
                        <p className="font-medium text-slate-900 dark:text-white">{pq.prompt}</p>
                        {pq.options?.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {pq.options.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => setWarmupAnswers((p) => ({ ...p, [pq.id]: opt }))}
                                className={`text-left px-3 py-1.5 rounded-lg border ${
                                  picked === opt
                                    ? opt === pq.correctAnswer
                                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
                                      : 'border-rose-500 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200'
                                    : 'border-slate-200 dark:border-slate-700'
                                }`}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        )}
                        {picked && (
                          <p className="text-slate-500 dark:text-slate-400">
                            Answer: <strong>{pq.correctAnswer}</strong> — {pq.explanation}
                          </p>
                        )}
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

    if (widgetId === 'quick_tutor') {
      return (
        <div
          key="quick_tutor"
          draggable
          onDragStart={() => setDragWidgetId('quick_tutor')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleWidgetDrop('quick_tutor')}
          className="rounded-2xl border border-slate-200/80 dark:border-slate-700/70 border-t-2 border-t-blue-500/80 dark:border-t-blue-400/75 bg-white/85 dark:bg-[#1A202C]/85 backdrop-blur-md shadow-sm hover:shadow-md transition-shadow p-6"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-slate-300 dark:text-slate-600 cursor-grab shrink-0" />
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Quick-Access AI Tutor
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Ask a question grounded in your uploaded subject materials
                </p>
              </div>
            </div>
            <MessageSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <form onSubmit={handleQuickTutorSubmit} className="flex flex-col sm:flex-row gap-2.5">
            <select
              value={selectedTutorSubject}
              onChange={(e) => setQuickSubjectId(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 sm:w-44 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={quickPrompt}
              onChange={(e) => setQuickPrompt(e.target.value)}
              placeholder="Ask a question or request a quick quiz..."
              className="flex-1 min-w-0 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
            >
              Ask Tutor
            </button>
          </form>
        </div>
      );
    }

    if (widgetId === 'today_plan') {
      return (
        <div
          key="today_plan"
          draggable
          onDragStart={() => setDragWidgetId('today_plan')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleWidgetDrop('today_plan')}
          className="rounded-2xl border border-slate-200/80 dark:border-slate-700/70 border-t-2 border-t-emerald-500/75 dark:border-t-emerald-400/70 bg-white/85 dark:bg-[#1A202C]/85 backdrop-blur-md shadow-sm hover:shadow-md transition-shadow p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-slate-300 cursor-grab shrink-0" />
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Today’s Study Plan
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {today} · Check off tasks as you finish
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('planner')}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
            >
              Open Planner
            </button>
          </div>

          {todaysTasks.length === 0 ? (
            <div className="py-6 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
              <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
                No tasks scheduled for today yet.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('planner')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
              >
                Generate AI Study Plan
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {todaysTasks.map((task) => {
                const subj = subjectMap.get(task.subjectId);
                return (
                  <div key={task.id} className="py-3 flex items-center justify-between gap-4">
                    <button
                      type="button"
                      onClick={() => handleToggleTask(task)}
                      className="flex items-start gap-3 text-left flex-1 min-w-0"
                    >
                      {task.completed ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <p
                          className={`text-sm font-medium truncate ${
                            task.completed
                              ? 'line-through text-slate-400 dark:text-slate-500'
                              : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {task.title}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                          {subj?.name || 'Subject'} · {task.startTime} · {task.durationMinutes}m · {task.taskType}
                        </p>
                      </div>
                    </button>
                    {subj && (
                      <button
                        type="button"
                        onClick={() => onOpenSubject(subj.id)}
                        className="text-xs font-medium text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 whitespace-nowrap"
                      >
                        Open
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    if (widgetId === 'subject_progress') {
      return (
        <div
          key="subject_progress"
          draggable
          onDragStart={() => setDragWidgetId('subject_progress')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleWidgetDrop('subject_progress')}
          className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-[#1A202C]/90 shadow-xs p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-slate-300 cursor-grab shrink-0" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Subject Progress
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('analytics')}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Full Analytics
            </button>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {subjectStats.map(({ subj, avgQuiz, cardCount, dueCount, resourceCount }) => (
              <div
                key={subj.id}
                className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onOpenSubject(subj.id)}
                    className="text-sm font-semibold text-slate-900 dark:text-white hover:text-indigo-600 dark:hover:text-indigo-400 text-left truncate block"
                  >
                    {subj.name} {subj.code ? `(${subj.code})` : ''}
                  </button>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                    {resourceCount} resources · {cardCount} cards ({dueCount} due) · Confidence {subj.confidence}/5
                  </p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Quiz Avg</p>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white tabular-nums">
                      {avgQuiz !== null ? `${avgQuiz}%` : '—'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenSubject(subj.id)}
                    className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                  >
                    Workspace
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    if (widgetId === 'recommendations') {
      return (
        <div
          key="recommendations"
          draggable
          onDragStart={() => setDragWidgetId('recommendations')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleWidgetDrop('recommendations')}
          className="rounded-2xl border border-slate-200/80 dark:border-slate-700/70 border-t-2 border-t-violet-500/75 dark:border-t-violet-400/70 bg-white/85 dark:bg-[#1A202C]/85 backdrop-blur-md shadow-sm hover:shadow-md transition-shadow p-6"
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-slate-300 cursor-grab shrink-0" />
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  AI Revision Recommendations
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Personalized from your exams, streaks & quiz gaps
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleGenerateCoachRecommendations}
              disabled={coachLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${coachLoading ? 'animate-spin' : ''}`} />
              {coachData ? 'Refresh' : 'Analyze Now'}
            </button>
          </div>

          {coachError && <p className="text-xs text-rose-600 dark:text-rose-400 mb-3">{coachError}</p>}

          {!coachData ? (
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Click <strong>Analyze Now</strong> to let Gemini inspect your upcoming exam dates, flashcard queue, and past mistakes to suggest the highest-impact tasks right now.
            </p>
          ) : (
            <div className="space-y-3">
              {coachData.coachMessage && (
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed pb-2 border-b border-slate-100 dark:border-slate-800">
                  {coachData.coachMessage}
                </p>
              )}
              {coachData.recommendations.map((rec, idx) => (
                <div
                  key={idx}
                  className="py-2.5 flex items-start justify-between gap-3 border-b last:border-b-0 border-slate-100 dark:border-slate-800"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{rec.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {rec.reason} · {rec.estimatedMinutes} min
                    </p>
                  </div>
                  {rec.subjectId && subjectMap.has(rec.subjectId) && (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenSubject(
                          rec.subjectId,
                          rec.actionType === 'flashcards'
                            ? 'flashcards'
                            : rec.actionType === 'quiz'
                              ? 'quizzes'
                              : 'notes'
                        )
                      }
                      className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
                    >
                      Go
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (widgetId === 'upcoming_exams') {
      return (
        <div
          key="upcoming_exams"
          draggable
          onDragStart={() => setDragWidgetId('upcoming_exams')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleWidgetDrop('upcoming_exams')}
          className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-[#1A202C]/90 shadow-xs p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-slate-300 cursor-grab shrink-0" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Upcoming Exams & Deadlines
              </h2>
            </div>
            <CalendarClock className="w-4 h-4 text-slate-400" />
          </div>
          {upcomingExams.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add exam dates inside your subjects to track countdowns and prioritize study sessions.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {upcomingExams.map((exam) => (
                <div key={exam.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{exam.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{exam.examDate}</p>
                  </div>
                  <span
                    className={`text-xs font-semibold tabular-nums ${
                      exam.daysLeft <= 7
                        ? 'text-rose-600 dark:text-rose-400'
                        : exam.daysLeft <= 21
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {exam.daysLeft === 0 ? 'Today' : `${exam.daysLeft}d left`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    if (widgetId === 'recent_docs') {
      return (
        <div
          key="recent_docs"
          draggable
          onDragStart={() => setDragWidgetId('recent_docs')}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleWidgetDrop('recent_docs')}
          className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-[#1A202C]/90 shadow-xs p-6"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <GripVertical className="w-4 h-4 text-slate-300 cursor-grab shrink-0" />
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Recently Uploaded Documents
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('library')}
              className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Search All
            </button>
          </div>
          {recentResources.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Upload PDFs, Word docs, slides, or images inside any subject workspace.
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {recentResources.map((res) => {
                const subj = subjectMap.get(res.subjectId);
                return (
                  <div key={res.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                          {res.title}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {subj?.name || 'Subject'} · {res.fileType.toUpperCase()}
                        </p>
                      </div>
                    </div>
                    {subj && (
                      <button
                        type="button"
                        onClick={() => onOpenSubject(subj.id, 'resources')}
                        className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline shrink-0"
                      >
                        View
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  const leftColIds = ['autopilot', 'quick_tutor', 'today_plan', 'subject_progress'];
  const orderedLeft = activeWidgets.filter((id) => leftColIds.includes(id));
  const orderedRight = activeWidgets.filter((id) => !leftColIds.includes(id) && id !== 'metrics');

  return (
    <div className="space-y-8">
      {/* Welcome Header & Primary CTA */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {greeting}, {capitalizedFirstName}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {subjects.length === 0
              ? 'Create your first subject workspace to upload materials and build your study plan.'
              : `${todaysTasks.filter((t) => !t.completed).length} tasks scheduled today · ${dueFlashcards.length} flashcards due for review`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setCustomizeOpen((o) => !o)}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-600 dark:text-slate-300 shadow-2xs transition-colors"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Customize Widgets
          </button>
          <button
            type="button"
            onClick={onCreateSubject}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 shadow-2xs transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            New Subject
          </button>
          <button
            type="button"
            onClick={() => onNavigate('pdf_solver')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors shadow-sm whitespace-nowrap"
          >
            <FileCheck2 className="w-4 h-4" />
            Solve a PDF
          </button>
        </div>
      </div>

      {/* Widget Customizer Drawer */}
      {customizeOpen && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-900 dark:text-white">
              Toggle Widgets or Drag Widget Headers Below to Reorder
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleUndoWidgets()}
                disabled={widgetUndoStack.length === 0}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 disabled:opacity-40"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Undo
              </button>
              <button
                type="button"
                onClick={() => void saveWidgetOrder(DEFAULT_DASHBOARD_WIDGETS)}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Reset Default
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_DASHBOARD_WIDGETS.map((wid) => {
              const visible = activeWidgets.includes(wid);
              return (
                <button
                  key={wid}
                  type="button"
                  onClick={() => toggleWidgetVisibility(wid)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium ${
                    visible
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-400'
                  }`}
                >
                  {visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  {WIDGET_LABELS[wid]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 4-Column Metric Strip */}
      {activeWidgets.includes('metrics') && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 border-t-2 border-t-amber-400/80 dark:border-t-amber-400/70 bg-white/90 dark:bg-[#1A202C]/85 backdrop-blur-sm shadow-xs hover:shadow-sm transition-shadow p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Daily Study Streak</span>
              <Flame className="w-4 h-4 text-amber-500" />
            </div>
            <p className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
              {profile?.streakDays || 0} days
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">
              {profile?.lastStudyDate === today ? 'Goal active today' : 'Complete a session today'}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 border-t-2 border-t-indigo-500/80 dark:border-t-indigo-400/75 bg-white/90 dark:bg-[#1A202C]/85 backdrop-blur-sm shadow-xs hover:shadow-sm transition-shadow p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Today’s Study Goal</span>
              <Timer className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="flex items-baseline justify-between gap-2 mt-2">
              <p className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                {todayMinutes}{' '}
                <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
                  / {goalMinutes} min
                </span>
              </p>
              <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                {goalPct}%
              </span>
            </div>
            <div
              className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800/90 mt-3 overflow-hidden"
              role="progressbar"
              aria-valuenow={goalPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Daily study goal progress"
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-500 dark:from-indigo-500 dark:to-indigo-400 transition-all duration-500"
                style={{ width: `${goalPct}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 tabular-nums">
              {studyTimeDelta >= 0 ? `+${studyTimeDelta}m vs yesterday` : `${studyTimeDelta}m vs yesterday`} · Suggested:{' '}
              {Math.max(25, Math.min(60, goalMinutes - todayMinutes || 25))}m
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-800 border-t-2 border-t-blue-500/75 dark:border-t-blue-400/70 bg-white/90 dark:bg-[#1A202C]/85 backdrop-blur-sm shadow-xs hover:shadow-sm transition-shadow p-5">
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Total Study Time</span>
              <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <p className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
              {totalHours} hrs
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 tabular-nums">
              {sessions.length} logged sessions
            </p>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onNavigate('flashcards_studio')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate('flashcards_studio');
              }
            }}
            className="rounded-2xl border border-slate-200/80 dark:border-slate-800 border-t-2 border-t-violet-500/80 dark:border-t-violet-400/75 bg-white/90 dark:bg-[#1A202C]/85 backdrop-blur-sm shadow-xs hover:shadow-sm transition-shadow p-5 cursor-pointer text-left"
          >
            <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
              <span>Flashcards Due</span>
              <Layers className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="flex items-baseline justify-between gap-2 mt-2">
              <p className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                {dueFlashcards.length}{' '}
                <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
                  / {flashcards.length}
                </span>
              </p>
              <span className="text-xs font-semibold text-violet-600 dark:text-violet-400 tabular-nums">
                {flashcards.length > 0 ? `${flashcardCaughtUpPct}% caught up` : '0 cards'}
              </span>
            </div>
            <div
              className="w-full h-2 rounded-full bg-slate-100 dark:bg-slate-800/90 mt-3 overflow-hidden"
              role="progressbar"
              aria-valuenow={flashcardCaughtUpPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Flashcard review progress"
            >
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  flashcards.length > 0 && dueFlashcards.length === 0
                    ? 'bg-emerald-500 dark:bg-emerald-400'
                    : 'bg-gradient-to-r from-violet-600 to-indigo-500 dark:from-violet-500 dark:to-indigo-400'
                }`}
                style={{ width: `${flashcardCaughtUpPct}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 tabular-nums">
              {flashcards.length === 0
                ? 'Open Flashcards Studio to create a deck'
                : dueFlashcards.length === 0
                  ? 'All scheduled reviews complete'
                  : `${dueFlashcards.length} card${dueFlashcards.length === 1 ? '' : 's'} ready for review`}
            </p>
          </div>
        </div>
      )}

      {/* Onboarding Empty State if no subjects */}
      {subjects.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] shadow-xs overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          <div className="lg:col-span-7 p-8 flex flex-col justify-center">
            <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white mb-2">
              Build your first subject workspace
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed mb-6 max-w-lg">
              Each subject workspace houses your uploaded textbooks, lecture slides, AI-generated notes, spaced-repetition flashcards, adaptive practice exams, interactive labs, and a personal AI tutor.
            </p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onCreateSubject}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create First Subject
              </button>
            </div>
          </div>
          <div className="lg:col-span-5 min-h-[220px] bg-slate-100 dark:bg-slate-800">
            <img
              src={emptyWorkspaceImg}
              alt="Minimalist stacked academic books and prism"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-7">
          <div className="lg:col-span-7 space-y-7">{orderedLeft.map((id) => renderWidget(id))}</div>
          <div className="lg:col-span-5 space-y-7">{orderedRight.map((id) => renderWidget(id))}</div>
        </div>
      )}
    </div>
  );
}
