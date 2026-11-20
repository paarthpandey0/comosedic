import { useEffect, useMemo, useState } from 'react';
import { Award, Check, Flame, Medal, Play, RotateCcw, ShieldCheck, Star, Timer, Trophy } from 'lucide-react';
import type { AcademicMemory, Flashcard, Quiz, StudySession, Subject, UserProfile } from '../types';
import { ACHIEVEMENT_CATALOG, awardLearningXp, logStudySession, updateAcademicMemory } from '../services/studyDb';

interface BattleModeViewProps {
  uid: string;
  profile: UserProfile | null;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
  flashcards: Flashcard[];
  quizzes: Quiz[];
  sessions: StudySession[];
}

interface SprintQuestion {
  id: string;
  subjectId: string;
  prompt: string;
  answer: string;
  options: string[];
}

export function BattleModeView({
  uid,
  profile,
  academicMemory,
  subjects,
  flashcards,
  quizzes,
  sessions,
}: BattleModeViewProps) {
  const [selectedSubjectId, setSelectedSubjectId] = useState('all');
  const [running, setRunning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [finished, setFinished] = useState(false);

  const [highScore, setHighScore] = useState<number>(() => {
    try {
      return Number(localStorage.getItem('lumina_battle_highscore') || '0');
    } catch {
      return 0;
    }
  });

  const pool: SprintQuestion[] = useMemo(() => {
    const filteredCards = flashcards.filter(
      (c) => selectedSubjectId === 'all' || c.subjectId === selectedSubjectId
    );
    const cardQs: SprintQuestion[] = filteredCards.map((c, i) => {
      const distractors = flashcards
        .filter((other) => other.id !== c.id)
        .slice(0, 3)
        .map((other) => other.back.slice(0, 90));
      const opts = [c.back.slice(0, 90), ...distractors].sort((a, b) => a.localeCompare(b));
      return {
        id: `fc_${c.id}_${i}`,
        subjectId: c.subjectId,
        prompt: c.front,
        answer: c.back.slice(0, 90),
        options: opts.length >= 2 ? opts : [c.back.slice(0, 90), 'Not covered in this topic'],
      };
    });

    const quizQs: SprintQuestion[] = quizzes
      .filter((q) => selectedSubjectId === 'all' || q.subjectId === selectedSubjectId)
      .flatMap((q) =>
        q.questions
          .filter((qq) => qq.options.length >= 2)
          .map((qq) => ({
            id: `qz_${q.id}_${qq.id}`,
            subjectId: q.subjectId,
            prompt: qq.prompt,
            answer: qq.correctAnswer,
            options: qq.options,
          }))
      );

    return [...quizQs, ...cardQs];
  }, [flashcards, quizzes, selectedSubjectId]);

  useEffect(() => {
    if (!running) return;
    if (secondsLeft <= 0) {
      setRunning(false);
      setFinished(true);
      if (score > highScore) {
        setHighScore(score);
        try {
          localStorage.setItem('lumina_battle_highscore', String(score));
        } catch {
          // ignore storage errors
        }
      }
      if (score > 0) {
        void logStudySession(uid, profile, subjects[0]?.id || 'general', 'quiz', 2);
        void awardLearningXp(uid, academicMemory, Math.min(80, Math.round(score / 4) + 10));
      }
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [running, secondsLeft, score, highScore, uid, profile, academicMemory, subjects]);

  const startBattle = () => {
    if (pool.length === 0) return;
    setScore(0);
    setCombo(0);
    setIdx(0);
    setSecondsLeft(60);
    setFinished(false);
    setRunning(true);
  };

  const handleAnswer = (opt: string) => {
    const q = pool[idx % pool.length];
    if (!q) return;
    if (opt === q.answer) {
      const nextCombo = combo + 1;
      setCombo(nextCombo);
      setScore((s) => s + 10 + Math.min(nextCombo * 2, 20));
    } else {
      setCombo(0);
    }
    setIdx((i) => i + 1);
  };

  const weeklyMinutes = useMemo(() => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const cutoff = weekAgo.toISOString().slice(0, 10);
    return sessions.filter((s) => s.date >= cutoff).reduce((sum, s) => sum + s.durationMinutes, 0);
  }, [sessions]);

  const weeklyGoalMinutes = (profile?.dailyGoalMinutes || 90) * 7;
  const weeklyPct = Math.min(100, Math.round((weeklyMinutes / Math.max(1, weeklyGoalMinutes)) * 100));

  const totalXp = useMemo(() => {
    const stored = academicMemory?.xpPoints ?? 0;
    const derived = sessions.length * 20 + quizzes.filter((q) => q.status === 'completed').length * 30;
    return Math.max(stored, derived);
  }, [academicMemory?.xpPoints, sessions.length, quizzes]);

  const scholarLevel = Math.floor(totalXp / 250) + 1;
  const xpInLevel = totalXp % 250;
  const xpPct = Math.round((xpInLevel / 250) * 100);

  const subjectMasteryTiers = useMemo(() => {
    return subjects.map((s) => {
      const sQuizzes = quizzes.filter((q) => q.subjectId === s.id && q.status === 'completed');
      const avg = sQuizzes.length
        ? Math.round(
            sQuizzes.reduce((acc, q) => acc + (q.score / Math.max(1, q.maxScore)) * 100, 0) / sQuizzes.length
          )
        : 0;
      const cardsReviewed = flashcards
        .filter((c) => c.subjectId === s.id)
        .reduce((acc, c) => acc + c.timesReviewed, 0);
      const pts = avg + Math.min(40, cardsReviewed * 2);
      const tier =
        pts >= 110 && sQuizzes.length >= 2
          ? 'Scholar'
          : pts >= 80
            ? 'Gold'
            : pts >= 45
              ? 'Silver'
              : 'Bronze';
      return { subject: s, tier, avg, cardsReviewed };
    });
  }, [subjects, quizzes, flashcards]);

  const weeklyChallenges = useMemo(() => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const cutoff = weekAgo.toISOString().slice(0, 10);
    const weekSessions = sessions.filter((s) => s.date >= cutoff).length;
    const completedQuizzesCount = quizzes.filter((q) => q.status === 'completed').length;
    const cardsMastered = flashcards.filter((c) => c.repetitions >= 2).length;
    return [
      { id: 'c1', label: 'Log 5 focused study sessions this week', current: weekSessions, target: 5 },
      { id: 'c2', label: 'Complete 3 practice assessments', current: completedQuizzesCount, target: 3 },
      { id: 'c3', label: 'Review 15 flashcards with spaced repetition', current: cardsMastered, target: 15 },
    ];
  }, [sessions, quizzes, flashcards]);

  const activeBadgeKey = academicMemory?.activeBadge || profile?.achievements?.[0] || '';

  const currentQ = pool.length > 0 ? pool[idx % pool.length] : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Revision Battle Mode & Achievements
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Beat your personal high score in 60-second active-recall sprints powered by your own flashcards and quizzes.
        </p>
      </div>

      {/* Top Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
          <Trophy className="w-4 h-4 text-amber-500 mb-2" />
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{highScore}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Personal High Score</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
          <Flame className="w-4 h-4 text-orange-500 mb-2" />
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {profile?.streakDays || 0}d
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Revision Streak</p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
          <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400 mb-2" />
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{weeklyPct}%</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Weekly Goal ({weeklyMinutes} / {weeklyGoalMinutes}m)
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
          <Award className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mb-2" />
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {profile?.achievements?.length || 0}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">Unlocked Badges</p>
        </div>
      </div>

      {/* 60-Second Timed Challenge Arena */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              60-Second Knowledge Sprint
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {pool.length} recall prompts available from your study workspaces
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              disabled={running}
              className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            >
              <option value="all">All Subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {!running && (
              <button
                type="button"
                onClick={startBattle}
                disabled={pool.length === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-50"
              >
                {finished ? <RotateCcw className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                {finished ? 'Play Again' : 'Start 60s Sprint'}
              </button>
            )}
          </div>
        </div>

        {pool.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
            Generate flashcards or a practice quiz in any subject workspace first to unlock Sprint challenges.
          </p>
        ) : running && currentQ ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs font-medium px-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60">
              <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-mono font-bold">
                <Timer className="w-3.5 h-3.5" />
                {secondsLeft}s
              </span>
              <span className="text-slate-600 dark:text-slate-300">Combo: x{combo}</span>
              <span className="text-indigo-600 dark:text-indigo-400 font-bold">Score: {score}</span>
            </div>

            <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 space-y-3">
              <p className="text-base font-semibold text-slate-900 dark:text-white">{currentQ.prompt}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {currentQ.options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleAnswer(opt)}
                    className="text-left px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30 text-sm text-slate-800 dark:text-slate-200 transition-colors"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : finished ? (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/60 dark:bg-emerald-950/20 p-5 text-center space-y-1">
            <p className="font-display text-xl font-bold text-emerald-900 dark:text-emerald-200">
              Sprint Complete · Final Score: {score}
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              {score >= highScore && score > 0
                ? 'New personal high score recorded!'
                : `Personal best remains ${highScore} points.`}
            </p>
          </div>
        ) : null}
      </div>

      {/* XP Level & Weekly Challenges */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">Scholar Progression</p>
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white tabular-nums">
                Level {scholarLevel} · {totalXp.toLocaleString()} XP
              </h2>
            </div>
            <Star className="w-6 h-6 text-amber-500 fill-amber-400" />
          </div>
          <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${xpPct}%` }} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {xpInLevel} / 250 XP toward Level {scholarLevel + 1} · Active Badge:{' '}
            <strong className="text-slate-800 dark:text-slate-200">
              {ACHIEVEMENT_CATALOG[activeBadgeKey]?.title || 'None selected'}
            </strong>
          </p>
        </div>

        <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-3">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Weekly Study Challenges
          </h2>
          <div className="space-y-3">
            {weeklyChallenges.map((ch) => {
              const pct = Math.min(100, Math.round((ch.current / ch.target) * 100));
              return (
                <div key={ch.id} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium text-slate-800 dark:text-slate-200">{ch.label}</span>
                    <span className="tabular-nums text-slate-500 dark:text-slate-400">
                      {Math.min(ch.current, ch.target)} / {ch.target}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${pct >= 100 ? 'bg-emerald-500' : 'bg-indigo-600'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Subject Mastery Tiers */}
      {subjectMasteryTiers.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Medal className="w-4 h-4 text-indigo-600" />
            Subject Mastery Tiers
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {subjectMasteryTiers.map(({ subject, tier, avg, cardsReviewed }) => (
              <div key={subject.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{subject.name}</p>
                  <span
                    className={`text-xs font-bold ${
                      tier === 'Scholar'
                        ? 'text-indigo-600 dark:text-indigo-400'
                        : tier === 'Gold'
                          ? 'text-amber-600 dark:text-amber-400'
                          : tier === 'Silver'
                            ? 'text-slate-500'
                            : 'text-orange-700 dark:text-orange-400'
                    }`}
                  >
                    {tier}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  Quiz Avg {avg}% · {cardsReviewed} flashcard reviews
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Achievement Gallery & Profile Badge Picker */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Subject & Academic Milestones
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Click an unlocked milestone to equip it as your Profile Badge
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Object.entries(ACHIEVEMENT_CATALOG).map(([key, info]) => {
            const unlocked = profile?.achievements?.includes(key);
            const equipped = activeBadgeKey === key;
            return (
              <button
                key={key}
                type="button"
                disabled={!unlocked}
                onClick={() => unlocked && void updateAcademicMemory(uid, { activeBadge: key })}
                className={`text-left rounded-xl border p-4 space-y-1 transition-colors ${
                  equipped
                    ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40'
                    : unlocked
                      ? 'border-indigo-200 dark:border-indigo-800/70 bg-indigo-50/30 dark:bg-indigo-950/10 hover:border-indigo-400'
                      : 'border-slate-100 dark:border-slate-800 opacity-55 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{info.title}</p>
                  {equipped && <Check className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{info.description}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
