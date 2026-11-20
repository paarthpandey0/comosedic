import { useMemo, useState } from 'react';
import {
  Award,
  Check,
  CheckSquare,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AcademicMemory,
  DailyHabitItem,
  GradeCategoryItem,
  GradeCourse,
  Subject,
} from '../types';
import {
  createGradeCourse,
  deleteGradeCourse,
  getTodayIsoDate,
  makeId,
  updateAcademicMemory,
  updateGradeCourse,
} from '../services/studyDb';
import { generateGradeStrategy } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';

interface GradeTrackerViewProps {
  uid: string;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
  gradeCourses: GradeCourse[];
}

function percentToGpa(pct: number): number {
  if (pct >= 93) return 4.0;
  if (pct >= 90) return 3.7;
  if (pct >= 87) return 3.3;
  if (pct >= 83) return 3.0;
  if (pct >= 80) return 2.7;
  if (pct >= 77) return 2.3;
  if (pct >= 73) return 2.0;
  if (pct >= 70) return 1.7;
  if (pct >= 67) return 1.3;
  if (pct >= 63) return 1.0;
  if (pct >= 60) return 0.7;
  return 0.0;
}

function percentToLetter(pct: number): string {
  if (pct >= 93) return 'A';
  if (pct >= 90) return 'A-';
  if (pct >= 87) return 'B+';
  if (pct >= 83) return 'B';
  if (pct >= 80) return 'B-';
  if (pct >= 77) return 'C+';
  if (pct >= 73) return 'C';
  if (pct >= 70) return 'C-';
  if (pct >= 67) return 'D+';
  if (pct >= 63) return 'D';
  if (pct >= 60) return 'D-';
  return 'F';
}

function computeCourseMetrics(course: GradeCourse) {
  let completedWeight = 0;
  let weightedEarned = 0;
  let totalWeight = 0;

  course.categories.forEach((cat) => {
    const w = Math.max(0, Number(cat.weightPercent) || 0);
    totalWeight += w;
    if (cat.scorePercent !== null && !Number.isNaN(Number(cat.scorePercent))) {
      completedWeight += w;
      weightedEarned += (w * Number(cat.scorePercent)) / 100;
    }
  });

  const currentPercent = completedWeight > 0 ? (weightedEarned / completedWeight) * 100 : null;
  const remainingWeight = Math.max(0, 100 - completedWeight);
  const neededOnRemaining =
    remainingWeight > 0 ? ((course.targetGradePercent - weightedEarned) / remainingWeight) * 100 : null;

  return {
    totalWeight,
    completedWeight,
    remainingWeight,
    currentPercent,
    neededOnRemaining,
  };
}

function getLast14Days(): Array<{ iso: string; dayShort: string; dateNum: string }> {
  const days: Array<{ iso: string; dayShort: string; dateNum: string }> = [];
  const base = new Date();
  for (let offset = 13; offset >= 0; offset--) {
    const d = new Date(base);
    d.setDate(base.getDate() - offset);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    days.push({
      iso: `${y}-${m}-${day}`,
      dayShort: d.toLocaleDateString('en-US', { weekday: 'narrow' }),
      dateNum: String(d.getDate()),
    });
  }
  return days;
}

const DEFAULT_HABITS: DailyHabitItem[] = [
  { id: 'hab_recall', label: '20 min active recall flashcards', targetPerWeek: 6, completedDates: [] },
  { id: 'hab_problems', label: 'Solve 5 unseen practice problems', targetPerWeek: 5, completedDates: [] },
  { id: 'hab_review', label: 'Review lecture notes same day', targetPerWeek: 5, completedDates: [] },
];

export function GradeTrackerView({
  uid,
  academicMemory,
  subjects,
  gradeCourses,
}: GradeTrackerViewProps) {
  const [activeTab, setActiveTab] = useState<'grades' | 'habits'>('grades');

  // New Course Form
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || 'general');
  const [courseName, setCourseName] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [credits, setCredits] = useState(3);
  const [targetGrade, setTargetGrade] = useState(90);
  const [creatingCourse, setCreatingCourse] = useState(false);

  // Advisor State
  const [strategyMarkdown, setStrategyMarkdown] = useState('');
  const [loadingStrategy, setLoadingStrategy] = useState(false);

  // Habit Form
  const [newHabitLabel, setNewHabitLabel] = useState('');
  const [newHabitTarget, setNewHabitTarget] = useState(5);

  const [error, setError] = useState('');

  const last14Days = useMemo(() => getLast14Days(), []);
  const todayIso = getTodayIsoDate();

  const habits = useMemo(() => {
    const saved = academicMemory?.dailyHabits;
    if (saved && saved.length > 0) return saved;
    return DEFAULT_HABITS;
  }, [academicMemory?.dailyHabits]);

  const gpaSummary = useMemo(() => {
    let totalCredits = 0;
    let gradedCredits = 0;
    let qualityPoints = 0;

    gradeCourses.forEach((c) => {
      totalCredits += c.credits;
      const m = computeCourseMetrics(c);
      if (m.currentPercent !== null) {
        gradedCredits += c.credits;
        qualityPoints += percentToGpa(m.currentPercent) * c.credits;
      }
    });

    return {
      totalCredits,
      currentGpa: gradedCredits > 0 ? qualityPoints / gradedCredits : null,
    };
  }, [gradeCourses]);

  const handleCreateCourse = async () => {
    const linkedSubject = subjects.find((s) => s.id === subjectId);
    const resolvedName = courseName.trim() || linkedSubject?.name || '';
    if (!resolvedName) {
      setError('Enter a course name or select a subject workspace.');
      return;
    }

    setCreatingCourse(true);
    setError('');
    try {
      const defaultCategories: GradeCategoryItem[] = [
        { id: makeId('cat'), name: 'Assignments & Labs', weightPercent: 25, scorePercent: 92 },
        { id: makeId('cat'), name: 'Midterm Exam', weightPercent: 35, scorePercent: 84 },
        { id: makeId('cat'), name: 'Final Exam', weightPercent: 40, scorePercent: null, isFinalExam: true },
      ];
      await createGradeCourse(uid, {
        subjectId: subjectId || 'general',
        courseName: resolvedName,
        code: courseCode.trim() || linkedSubject?.code || '',
        credits,
        targetGradePercent: targetGrade,
        categories: defaultCategories,
      });
      setCourseName('');
      setCourseCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create course.');
    } finally {
      setCreatingCourse(false);
    }
  };

  const handleUpdateCategory = async (
    course: GradeCourse,
    catId: string,
    patch: Partial<GradeCategoryItem>
  ) => {
    const next = course.categories.map((c) => (c.id === catId ? { ...c, ...patch } : c));
    await updateGradeCourse(course.id, { categories: next });
  };

  const handleAddCategory = async (course: GradeCourse) => {
    const next: GradeCategoryItem[] = [
      ...course.categories,
      { id: makeId('cat'), name: 'Quizzes', weightPercent: 10, scorePercent: null },
    ];
    await updateGradeCourse(course.id, { categories: next });
  };

  const handleDeleteCategory = async (course: GradeCourse, catId: string) => {
    const next = course.categories.filter((c) => c.id !== catId);
    await updateGradeCourse(course.id, { categories: next });
  };

  const handleRunStrategy = async () => {
    if (gradeCourses.length === 0) {
      setError('Add at least one course with grades first.');
      return;
    }
    setLoadingStrategy(true);
    setError('');
    try {
      const payload = gradeCourses.map((c) => {
        const m = computeCourseMetrics(c);
        return {
          courseName: c.courseName,
          credits: c.credits,
          currentPercent: m.currentPercent !== null ? Math.round(m.currentPercent * 10) / 10 : null,
          targetGradePercent: c.targetGradePercent,
          neededOnRemainingPercent:
            m.neededOnRemaining !== null ? Math.round(m.neededOnRemaining * 10) / 10 : null,
          remainingWeightPercent: m.remainingWeight,
        };
      });
      const res = await generateGradeStrategy({ courses: payload });
      setStrategyMarkdown(res.strategyMarkdown);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate GPA strategy.');
    } finally {
      setLoadingStrategy(false);
    }
  };

  const handleToggleHabitDate = async (habitId: string, dateIso: string) => {
    const next = habits.map((h) => {
      if (h.id !== habitId) return h;
      const exists = h.completedDates.includes(dateIso);
      const completedDates = exists
        ? h.completedDates.filter((d) => d !== dateIso)
        : [...h.completedDates, dateIso].slice(-90);
      return { ...h, completedDates };
    });
    await updateAcademicMemory(uid, { dailyHabits: next });
  };

  const handleAddHabit = async () => {
    if (!newHabitLabel.trim()) return;
    const next: DailyHabitItem[] = [
      ...habits,
      {
        id: makeId('hab'),
        label: newHabitLabel.trim().slice(0, 100),
        targetPerWeek: Math.min(Math.max(newHabitTarget, 1), 7),
        completedDates: [],
      },
    ];
    await updateAcademicMemory(uid, { dailyHabits: next });
    setNewHabitLabel('');
  };

  const handleDeleteHabit = async (habitId: string) => {
    const next = habits.filter((h) => h.id !== habitId);
    await updateAcademicMemory(uid, { dailyHabits: next });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Award className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Grade Calculator, Final Exam Solver &amp; Habits
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Calculate exact final-exam scores needed to hit your target GPA, get AI study-hour ROI advice, and track daily study habits.
          </p>
        </div>

        <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] p-1">
          <button
            type="button"
            onClick={() => setActiveTab('grades')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'grades'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Grades &amp; Final Solver
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('habits')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              activeTab === 'habits'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            14-Day Habit Grid
          </button>
        </div>
      </div>

      {activeTab === 'grades' ? (
        <div className="space-y-6">
          {/* Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Projected Term GPA (4.0)</p>
              <p className="font-mono text-3xl font-bold text-indigo-600 dark:text-indigo-400 tabular-nums mt-1">
                {gpaSummary.currentGpa !== null ? gpaSummary.currentGpa.toFixed(2) : '—'}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
              <p className="text-xs text-slate-500 dark:text-slate-400">Active Courses &amp; Credits</p>
              <p className="font-mono text-3xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                {gradeCourses.length}{' '}
                <span className="text-sm font-sans font-normal text-slate-500 dark:text-slate-400">
                  · {gpaSummary.totalCredits} credits
                </span>
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 flex flex-col justify-between gap-2">
              <p className="text-xs text-slate-500 dark:text-slate-400">AI GPA Study-Time ROI Advisor</p>
              <button
                type="button"
                onClick={() => void handleRunStrategy()}
                disabled={loadingStrategy || gradeCourses.length === 0}
                className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-medium"
              >
                {loadingStrategy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Optimize My Study Allocation
              </button>
            </div>
          </div>

          {strategyMarkdown && (
            <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-white dark:bg-[#1A202C] p-6 space-y-2">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Gemini GPA &amp; Final Exam Strategy
              </h2>
              <MarkdownView content={strategyMarkdown} />
            </div>
          )}

          {/* Add Course Form */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Add Course to Gradebook</h2>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
              <select
                value={subjectId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSubjectId(id);
                  const found = subjects.find((s) => s.id === id);
                  if (found && !courseName) {
                    setCourseName(found.name);
                    setCourseCode(found.code || '');
                  }
                }}
                className="sm:col-span-3 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
              >
                <option value="general">Custom Course</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>

              <input
                type="text"
                value={courseName}
                onChange={(e) => setCourseName(e.target.value)}
                placeholder="Course name (e.g., Organic Chemistry II)"
                className="sm:col-span-4 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
              />

              <input
                type="number"
                min={0.5}
                max={12}
                step={0.5}
                value={credits}
                onChange={(e) => setCredits(Number(e.target.value) || 3)}
                aria-label="Credits"
                className="sm:col-span-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white tabular-nums"
                title="Course credits"
              />

              <input
                type="number"
                min={50}
                max={100}
                value={targetGrade}
                onChange={(e) => setTargetGrade(Number(e.target.value) || 90)}
                aria-label="Target grade percent"
                className="sm:col-span-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white tabular-nums"
                title="Target course percentage"
              />

              <button
                type="button"
                onClick={() => void handleCreateCourse()}
                disabled={creatingCourse}
                className="sm:col-span-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Course
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Credits default to 3 · Target grade defaults to 90% (A-) · Pre-loaded with editable syllabus weights.
            </p>
            {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          </div>

          {/* Courses Grid */}
          {gradeCourses.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-10 text-center text-sm text-slate-500 dark:text-slate-400">
              Add your courses above to track weighted averages and compute exact Final Exam targets.
            </div>
          ) : (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              {gradeCourses.map((course) => {
                const metrics = computeCourseMetrics(course);
                const feasible =
                  metrics.neededOnRemaining === null || metrics.neededOnRemaining <= 100;

                return (
                  <div
                    key={course.id}
                    className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4"
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
                      <div className="min-w-0">
                        <h3 className="font-display text-base font-bold text-slate-900 dark:text-white truncate">
                          {course.courseName}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                          {course.code ? `${course.code} · ` : ''}
                          {course.credits} credits · Target {course.targetGradePercent}% · Syllabus weight{' '}
                          {metrics.totalWeight}%
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <p className="font-mono text-xl font-bold text-slate-900 dark:text-white tabular-nums">
                            {metrics.currentPercent !== null
                              ? `${metrics.currentPercent.toFixed(1)}%`
                              : '—'}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {metrics.currentPercent !== null
                              ? `${percentToLetter(metrics.currentPercent)} (${percentToGpa(metrics.currentPercent).toFixed(1)})`
                              : 'No scores yet'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void deleteGradeCourse(course.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600"
                          aria-label="Delete course"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Target Slider + Final Exam Solver Callout */}
                    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 p-3.5 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-slate-600 dark:text-slate-300">
                          Target Grade ({course.targetGradePercent}%)
                        </span>
                        <input
                          type="range"
                          min={60}
                          max={100}
                          value={course.targetGradePercent}
                          onChange={(e) =>
                            void updateGradeCourse(course.id, {
                              targetGradePercent: Number(e.target.value),
                            })
                          }
                          className="w-32 accent-indigo-600"
                        />
                      </div>

                      {metrics.remainingWeight > 0 && metrics.neededOnRemaining !== null ? (
                        <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200 tabular-nums">
                          Need{' '}
                          <span
                            className={`font-mono font-bold ${
                              feasible
                                ? 'text-indigo-600 dark:text-indigo-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {Math.max(0, metrics.neededOnRemaining).toFixed(1)}%
                          </span>{' '}
                          average across the remaining {metrics.remainingWeight}% weight to finish with{' '}
                          {course.targetGradePercent}%.
                          {!feasible && ' (Above 100% — consider extra credit or adjusting target.)'}
                        </p>
                      ) : (
                        <p className="text-xs text-emerald-700 dark:text-emerald-400">
                          All 100% of graded syllabus weight is recorded.
                        </p>
                      )}
                    </div>

                    {/* Category Weight & Score Rows */}
                    <div className="space-y-2">
                      <div className="grid grid-cols-12 gap-2 text-[11px] font-semibold text-slate-400 px-1">
                        <span className="col-span-5">Assessment Category</span>
                        <span className="col-span-3">Weight %</span>
                        <span className="col-span-3">Score %</span>
                        <span className="col-span-1" />
                      </div>
                      {course.categories.map((cat) => (
                        <div key={cat.id} className="grid grid-cols-12 gap-2 items-center">
                          <input
                            type="text"
                            value={cat.name}
                            onChange={(e) =>
                              void handleUpdateCategory(course, cat.id, { name: e.target.value })
                            }
                            className="col-span-5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
                          />
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={cat.weightPercent}
                            onChange={(e) =>
                              void handleUpdateCategory(course, cat.id, {
                                weightPercent: Number(e.target.value) || 0,
                              })
                            }
                            className="col-span-3 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-xs text-slate-900 dark:text-white tabular-nums"
                          />
                          <input
                            type="number"
                            min={0}
                            max={120}
                            placeholder="Pending"
                            value={cat.scorePercent === null ? '' : cat.scorePercent}
                            onChange={(e) => {
                              const raw = e.target.value;
                              void handleUpdateCategory(course, cat.id, {
                                scorePercent: raw === '' ? null : Number(raw),
                              });
                            }}
                            className="col-span-3 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-xs text-slate-900 dark:text-white tabular-nums"
                          />
                          <button
                            type="button"
                            onClick={() => void handleDeleteCategory(course, cat.id)}
                            className="col-span-1 p-1 text-slate-400 hover:text-rose-600 justify-self-center"
                            aria-label="Remove category"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() => void handleAddCategory(course)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline pt-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Assessment Category
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* 14-Day Daily Study Habit Grid */
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  14-Day Study Consistency Matrix
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Click any day to log completion. Habits sync to your Academic Memory across devices.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newHabitLabel}
                  onChange={(e) => setNewHabitLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleAddHabit();
                  }}
                  placeholder="New study habit (e.g., 1 past-paper question)"
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-white w-60"
                />
                <select
                  value={newHabitTarget}
                  onChange={(e) => setNewHabitTarget(Number(e.target.value))}
                  className="px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-200"
                >
                  {[3, 4, 5, 6, 7].map((n) => (
                    <option key={n} value={n}>
                      {n}d/wk
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void handleAddHabit()}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800">
                    <th className="py-2 pr-4 text-xs font-semibold text-slate-500 dark:text-slate-400 min-w-[220px]">
                      Habit
                    </th>
                    {last14Days.map((d) => (
                      <th
                        key={d.iso}
                        className={`py-2 px-1 text-center text-[11px] font-mono tabular-nums ${
                          d.iso === todayIso
                            ? 'text-indigo-600 dark:text-indigo-400 font-bold'
                            : 'text-slate-400'
                        }`}
                      >
                        <div>{d.dayShort}</div>
                        <div>{d.dateNum}</div>
                      </th>
                    ))}
                    <th className="py-2 pl-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400">
                      14d Rate
                    </th>
                    <th className="py-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {habits.map((habit) => {
                    const last14Hits = last14Days.filter((d) =>
                      habit.completedDates.includes(d.iso)
                    ).length;
                    const rate = Math.round((last14Hits / 14) * 100);
                    return (
                      <tr key={habit.id}>
                        <td className="py-3 pr-4">
                          <p className="text-sm font-medium text-slate-900 dark:text-white">
                            {habit.label}
                          </p>
                          <p className="text-[11px] text-slate-400 tabular-nums">
                            Goal: {habit.targetPerWeek} days / week
                          </p>
                        </td>
                        {last14Days.map((d) => {
                          const done = habit.completedDates.includes(d.iso);
                          return (
                            <td key={d.iso} className="py-3 px-1 text-center">
                              <button
                                type="button"
                                onClick={() => void handleToggleHabitDate(habit.id, d.iso)}
                                aria-label={`Toggle ${habit.label} on ${d.iso}`}
                                className={`w-7 h-7 rounded-lg border inline-flex items-center justify-center transition-colors ${
                                  done
                                    ? 'bg-emerald-600 border-emerald-600 text-white'
                                    : d.iso === todayIso
                                      ? 'border-indigo-400 dark:border-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/40'
                                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                              >
                                {done && <Check className="w-3.5 h-3.5" />}
                              </button>
                            </td>
                          );
                        })}
                        <td className="py-3 pl-3 text-right font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                          {rate}%
                        </td>
                        <td className="py-3 text-right">
                          <button
                            type="button"
                            onClick={() => void handleDeleteHabit(habit.id)}
                            className="p-1 text-slate-400 hover:text-rose-600"
                            aria-label="Delete habit"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
