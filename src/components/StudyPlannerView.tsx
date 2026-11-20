import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Circle,
  List,
  Loader2,
  Plus,
  RotateCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  Flashcard,
  Quiz,
  StudyPlanTask,
  Subject,
  TaskCategory,
  TaskPriority,
  TaskType,
  UserProfile,
} from '../types';
import {
  createStudyPlanTasksBatch,
  deleteStudyPlanTask,
  getTodayIsoDate,
  logStudySession,
  markTaskMissed,
  rescheduleStudyPlanTask,
  toggleTaskCompleted,
} from '../services/studyDb';
import { generateStudyPlan } from '../services/geminiApi';

interface StudyPlannerViewProps {
  uid: string;
  profile: UserProfile | null;
  subjects: Subject[];
  quizzes: Quiz[];
  flashcards: Flashcard[];
  tasks: StudyPlanTask[];
  onCreateSubject: () => void;
}

export function StudyPlannerView({
  uid,
  profile,
  subjects,
  quizzes,
  flashcards,
  tasks,
  onCreateSubject,
}: StudyPlannerViewProps) {
  const today = getTodayIsoDate();
  const [availableHours, setAvailableHours] = useState(3);
  const [daysCount, setDaysCount] = useState(7);
  const [generating, setGenerating] = useState(false);
  const [rationale, setRationale] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'list' | 'week'>('list');
  const [importMsg, setImportMsg] = useState<string | null>(null);

  // Manual task form
  const [manualTitle, setManualTitle] = useState('');
  const [manualSubjectId, setManualSubjectId] = useState(subjects[0]?.id || '');
  const [manualDate, setManualDate] = useState(today);
  const [manualTime, setManualTime] = useState('16:00');
  const [manualDuration, setManualDuration] = useState(45);
  const [manualType, setManualType] = useState<TaskType>('revision');
  const [manualCategory, setManualCategory] = useState<TaskCategory>('revision');

  const subjectMap = useMemo(() => {
    const m = new Map<string, Subject>();
    subjects.forEach((s) => m.set(s.id, s));
    return m;
  }, [subjects]);

  const weakTopics = useMemo(() => {
    const set = new Set<string>();
    quizzes
      .filter((q) => q.status === 'completed')
      .forEach((q) => q.weakTopics.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [quizzes]);

  const missedTasks = useMemo(
    () => tasks.filter((t) => t.missed || (!t.completed && t.scheduledDate < today)),
    [tasks, today]
  );

  const uniqueDates = useMemo(() => {
    const set = new Set<string>(tasks.map((t) => t.scheduledDate));
    return Array.from(set).sort();
  }, [tasks]);

  const visibleTasks = useMemo(() => {
    return tasks
      .filter((t) => (selectedDateFilter === 'all' ? true : t.scheduledDate === selectedDateFilter))
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate) || a.startTime.localeCompare(b.startTime));
  }, [tasks, selectedDateFilter]);

  const handleGeneratePlan = async () => {
    if (subjects.length === 0) return;
    setGenerating(true);
    setError(null);
    try {
      const plan = await generateStudyPlan({
        subjects: subjects.map((s) => ({
          id: s.id,
          name: s.name,
          examDate: s.examDate,
          confidence: s.confidence,
          topics: s.topics,
        })),
        availableHoursPerDay: availableHours,
        startDate: today,
        daysCount,
        weakTopics,
        missedTasks: missedTasks.map((t) => ({
          title: t.title,
          subjectId: t.subjectId,
          topic: t.topic,
        })),
      });

      await createStudyPlanTasksBatch(uid, plan.tasks);
      setRationale(plan.rationale);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate study plan.');
    } finally {
      setGenerating(false);
    }
  };

  const handleAddManualTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const subjId = manualSubjectId || subjects[0]?.id;
    if (!subjId || !manualTitle.trim()) return;
    await createStudyPlanTasksBatch(uid, [
      {
        subjectId: subjId,
        title: manualTitle.trim(),
        topic: 'Scheduled Session',
        scheduledDate: manualDate,
        startTime: manualTime,
        durationMinutes: manualDuration,
        priority: manualCategory === 'exam' ? 'high' : ('medium' as TaskPriority),
        taskType: manualType,
        category: manualCategory,
      },
    ]);
    setManualTitle('');
  };

  const handleImportIcs = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setImportMsg(null);
    try {
      const text = await file.text();
      const blocks = text.split('BEGIN:VEVENT').slice(1);
      const parsed: Array<{
        subjectId: string;
        title: string;
        topic: string;
        scheduledDate: string;
        startTime: string;
        durationMinutes: number;
        priority: TaskPriority;
        taskType: TaskType;
        category: TaskCategory;
      }> = [];
      const fallbackSubjId = subjects[0]?.id || 'general';

      for (const block of blocks.slice(0, 30)) {
        const endBlock = block.split('END:VEVENT')[0] || block;
        const summaryMatch = endBlock.match(/SUMMARY[^:]*:([^\r\n]+)/i);
        const dtStartMatch = endBlock.match(/DTSTART[^:]*:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/i);
        if (!summaryMatch || !dtStartMatch) continue;
        const title = summaryMatch[1].trim();
        const scheduledDate = `${dtStartMatch[1]}-${dtStartMatch[2]}-${dtStartMatch[3]}`;
        const startTime = dtStartMatch[4] && dtStartMatch[5] ? `${dtStartMatch[4]}:${dtStartMatch[5]}` : '09:00';
        const matchedSubj = subjects.find((s) => title.toLowerCase().includes(s.name.toLowerCase()));
        const isExam = /exam|test|quiz|midterm|final/i.test(title);
        const isAssignment = /assignment|essay|project|paper/i.test(title);
        parsed.push({
          subjectId: matchedSubj?.id || fallbackSubjId,
          title,
          topic: 'Imported Calendar Event',
          scheduledDate,
          startTime,
          durationMinutes: isExam ? 90 : 45,
          priority: isExam ? 'high' : 'medium',
          taskType: isExam ? 'quiz' : 'revision',
          category: isExam ? 'exam' : isAssignment ? 'assignment' : 'revision',
        });
      }

      if (parsed.length === 0) {
        setError('No valid VEVENT entries were found in that .ics file.');
        return;
      }
      await createStudyPlanTasksBatch(uid, parsed);
      setImportMsg(`Imported ${parsed.length} event${parsed.length === 1 ? '' : 's'} from ${file.name}.`);
    } catch {
      setError('Could not read the selected .ics calendar file.');
    }
  };

  const getTomorrowIsoDate = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const weekDays = useMemo(() => {
    const arr: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    return arr;
  }, []);

  const handleToggleComplete = async (task: StudyPlanTask) => {
    const nextDone = !task.completed;
    await toggleTaskCompleted(task.id, nextDone);
    if (nextDone) {
      const actType =
        task.taskType === 'flashcards'
          ? 'flashcards'
          : task.taskType === 'quiz'
            ? 'quiz'
            : task.taskType === 'reading'
              ? 'notes'
              : 'focus';
      await logStudySession(uid, profile, task.subjectId, actType, task.durationMinutes, {
        flashcardsCount: flashcards.length,
        quizzesCompletedCount: quizzes.filter((q) => q.status === 'completed').length,
      }).catch(() => {});
    }
  };

  if (subjects.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-12 text-center space-y-4">
        <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
          Add subjects to build your timetable
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          Enter your subjects, exam dates, and confidence levels so Gemini can generate an adaptive daily and weekly study schedule.
        </p>
        <button
          type="button"
          onClick={onCreateSubject}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          Create Subject
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & AI Generator Controls */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
              Smart Study Planner
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Prioritizes upcoming exams, low-confidence subjects, spaced repetition, and missed tasks ({missedTasks.length} overdue/missed).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer whitespace-nowrap">
              <Upload className="w-3.5 h-3.5" />
              Import .ics
              <input
                type="file"
                accept=".ics,text/calendar"
                onChange={(e) => {
                  void handleImportIcs(e.target.files?.[0] || null);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
            <button
              type="button"
              onClick={handleGeneratePlan}
              disabled={generating}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium transition-colors whitespace-nowrap"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? 'Scheduling...' : missedTasks.length > 0 ? 'Adapt & Reschedule Plan' : 'Generate AI Timetable'}
            </button>
          </div>
        </div>
        {importMsg && <p className="text-xs text-emerald-600 dark:text-emerald-400">{importMsg}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Daily Available Study Time ({availableHours} hrs/day)
            </label>
            <input
              type="range"
              min={1}
              max={10}
              step={0.5}
              value={availableHours}
              onChange={(e) => setAvailableHours(Number(e.target.value))}
              className="w-full accent-indigo-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Planning Horizon
            </label>
            <div className="flex items-center gap-2">
              {[3, 7, 14].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDaysCount(d)}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    daysCount === d
                      ? 'bg-slate-900 dark:bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {d} Days
                </button>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-2 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {rationale && (
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/30 px-4 py-3 text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
            <strong>Gemini Planning Rationale:</strong> {rationale}
          </div>
        )}
      </div>

      {/* Add Manual Task */}
      <form
        onSubmit={handleAddManualTask}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 grid grid-cols-1 md:grid-cols-12 gap-3 items-end"
      >
        <div className="md:col-span-3">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Task Title</label>
          <input
            type="text"
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
            placeholder="Revise Chapter 3"
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            required
          />
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Subject</label>
          <select
            value={manualSubjectId || subjects[0]?.id}
            onChange={(e) => setManualSubjectId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Date</label>
          <input
            type="date"
            value={manualDate}
            onChange={(e) => setManualDate(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
        </div>
        <div className="md:col-span-3">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Time, Type & Category</label>
          <div className="flex gap-1.5">
            <input
              type="time"
              value={manualTime}
              onChange={(e) => setManualTime(e.target.value)}
              className="w-1/3 px-2 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
            <select
              value={manualType}
              onChange={(e) => setManualType(e.target.value as TaskType)}
              className="w-1/3 px-1.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            >
              <option value="revision">Revision</option>
              <option value="flashcards">Cards</option>
              <option value="quiz">Quiz</option>
              <option value="reading">Reading</option>
            </select>
            <select
              value={manualCategory}
              onChange={(e) => setManualCategory(e.target.value as TaskCategory)}
              className="w-1/3 px-1.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            >
              <option value="revision">Study</option>
              <option value="exam">Exam</option>
              <option value="assignment">Assign.</option>
              <option value="homework">HW</option>
            </select>
          </div>
        </div>
        <div className="md:col-span-1">
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Mins</label>
          <input
            type="number"
            min={10}
            max={240}
            value={manualDuration}
            onChange={(e) => setManualDuration(Number(e.target.value))}
            className="w-full px-2.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm tabular-nums"
          />
        </div>
        <div className="md:col-span-1">
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-slate-900 dark:bg-indigo-600 text-white text-sm font-medium hover:opacity-90"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
      </form>

      {/* Date Filter & Timetable */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setSelectedDateFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                selectedDateFilter === 'all'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
              }`}
            >
              All Dates ({tasks.length})
            </button>
            {uniqueDates.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setSelectedDateFilter(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium tabular-nums whitespace-nowrap ${
                  selectedDateFilter === d
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {d === today ? `Today (${d})` : d}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium ${
                viewMode === 'list' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('week')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium ${
                viewMode === 'week' ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              7-Day Grid
            </button>
          </div>
        </div>

        {viewMode === 'week' ? (
          <div className="grid grid-cols-1 md:grid-cols-7 gap-2.5">
            {weekDays.map((dayIso) => {
              const dayTasks = tasks
                .filter((t) => t.scheduledDate === dayIso)
                .sort((a, b) => a.startTime.localeCompare(b.startTime));
              const dayName = new Date(`${dayIso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
              return (
                <div
                  key={dayIso}
                  className={`rounded-xl border p-3 space-y-2 min-h-[180px] ${
                    dayIso === today
                      ? 'border-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/20'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30'
                  }`}
                >
                  <p className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{dayName}</p>
                  {dayTasks.length === 0 ? (
                    <p className="text-[11px] text-slate-400">Open</p>
                  ) : (
                    <div className="space-y-1.5">
                      {dayTasks.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => void handleToggleComplete(t)}
                          className={`w-full text-left p-2 rounded-lg border text-[11px] ${
                            t.completed
                              ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 line-through opacity-70'
                              : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C]'
                          }`}
                        >
                          <p className="font-medium text-slate-900 dark:text-white truncate">{t.title}</p>
                          <p className="text-slate-500 dark:text-slate-400 tabular-nums">
                            {t.startTime} · {t.durationMinutes}m · {t.category || 'revision'}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : visibleTasks.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            <Calendar className="w-7 h-7 mx-auto text-slate-400 mb-2" />
            No scheduled study tasks yet. Click <strong>Generate AI Timetable</strong> above to plan your week.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {visibleTasks.map((task) => {
              const subj = subjectMap.get(task.subjectId);
              const isOverdue = !task.completed && (task.missed || task.scheduledDate < today);

              return (
                <div key={task.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => void handleToggleComplete(task)}
                    className="flex items-start gap-3 text-left flex-1 min-w-0"
                  >
                    {task.completed ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <Circle className="w-5 h-5 text-slate-300 dark:text-slate-600 shrink-0 mt-0.5" />
                    )}
                    <div className="min-w-0">
                      <p
                        className={`text-sm font-medium ${
                          task.completed
                            ? 'line-through text-slate-400 dark:text-slate-500'
                            : 'text-slate-900 dark:text-white'
                        }`}
                      >
                        {task.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                        {subj?.name || 'Subject'} · {task.scheduledDate} at {task.startTime} · {task.durationMinutes}m ·{' '}
                        {task.category || task.taskType} · {task.priority} priority
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-3 shrink-0 pl-8 sm:pl-0">
                    {isOverdue && (
                      <>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Missed
                        </span>
                        <button
                          type="button"
                          onClick={() => void rescheduleStudyPlanTask(task.id, getTomorrowIsoDate())}
                          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                        >
                          <RotateCw className="w-3 h-3" />
                          Reschedule Tomorrow
                        </button>
                      </>
                    )}
                    {!task.completed && !task.missed && !isOverdue && (
                      <button
                        type="button"
                        onClick={() => markTaskMissed(task.id, true)}
                        className="text-xs text-slate-500 hover:text-amber-600"
                      >
                        Mark Missed
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteStudyPlanTask(task.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600"
                      aria-label="Delete task"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
