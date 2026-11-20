import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, HelpCircle, Loader2, Plus, RotateCw, Trash2 } from 'lucide-react';
import type { Flashcard, Quiz, StudyResource, Subject, UserProfile } from '../../types';
import {
  createFlashcardsBatch,
  deleteFlashcard,
  logStudySession,
  reviewFlashcard,
} from '../../services/studyDb';
import { generateFlashcards } from '../../services/geminiApi';

interface FlashcardsPanelProps {
  uid: string;
  profile: UserProfile | null;
  subject: Subject;
  resources: StudyResource[];
  flashcards: Flashcard[];
  quizzes: Quiz[];
  preselectedResourceId?: string;
}

export function FlashcardsPanel({
  uid,
  profile,
  subject,
  resources,
  flashcards,
  quizzes,
  preselectedResourceId,
}: FlashcardsPanelProps) {
  const subjectResources = resources.filter((r) => r.subjectId === subject.id);
  const subjectCards = flashcards.filter((c) => c.subjectId === subject.id);

  const [selectedResourceId, setSelectedResourceId] = useState(
    preselectedResourceId || subjectResources[0]?.id || ''
  );
  const [cardCount, setCardCount] = useState(8);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [studyMode, setStudyMode] = useState<'due' | 'all'>('due');
  const [currentIdx, setCurrentIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [reviewedThisSession, setReviewedThisSession] = useState(0);

  // Manual card creation
  const [showManualForm, setShowManualForm] = useState(false);
  const [manualFront, setManualFront] = useState('');
  const [manualBack, setManualBack] = useState('');
  const [manualTopic, setManualTopic] = useState('');

  useEffect(() => {
    if (preselectedResourceId) setSelectedResourceId(preselectedResourceId);
  }, [preselectedResourceId]);

  const nowIso = new Date().toISOString();
  const dueCards = useMemo(
    () => subjectCards.filter((c) => c.nextReviewAt <= nowIso),
    [subjectCards, nowIso]
  );

  const deck = studyMode === 'due' ? dueCards : subjectCards;
  const activeCard = deck[currentIdx] || deck[0] || null;

  const accuracyPct = useMemo(() => {
    const totalReviews = subjectCards.reduce((acc, c) => acc + c.timesReviewed, 0);
    const totalCorrect = subjectCards.reduce((acc, c) => acc + c.timesCorrect, 0);
    return totalReviews > 0 ? Math.round((totalCorrect / totalReviews) * 100) : null;
  }, [subjectCards]);

  const weakTopics = useMemo(() => {
    const set = new Set<string>();
    quizzes
      .filter((q) => q.subjectId === subject.id && q.status === 'completed')
      .forEach((q) => q.weakTopics.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [quizzes, subject.id]);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = subjectResources.find((r) => r.id === selectedResourceId) || subjectResources[0];
    if (!res) {
      setError('Upload a study resource first to generate flashcards.');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const result = await generateFlashcards({
        subjectName: subject.name,
        resourceTitle: res.title,
        resourceContent: res.extractedText || res.summary,
        count: cardCount,
        weakTopics,
      });
      await createFlashcardsBatch(uid, subject.id, res.id, result.flashcards);
      setCurrentIdx(0);
      setFlipped(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate flashcards.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualFront.trim() || !manualBack.trim()) return;
    await createFlashcardsBatch(uid, subject.id, '', [
      {
        front: manualFront.trim(),
        back: manualBack.trim(),
        hint: '',
        topic: manualTopic.trim() || 'Custom',
        difficulty: 'medium',
      },
    ]);
    setManualFront('');
    setManualBack('');
    setManualTopic('');
    setShowManualForm(false);
  };

  const handleRate = async (rating: 'hard' | 'medium' | 'easy') => {
    if (!activeCard) return;
    await reviewFlashcard(activeCard, rating);
    const nextCount = reviewedThisSession + 1;
    setReviewedThisSession(nextCount);
    if (nextCount % 5 === 0) {
      await logStudySession(uid, profile, subject.id, 'flashcards', 5, {
        flashcardsCount: subjectCards.length,
      }).catch(() => {});
    }
    setFlipped(false);
    setShowHint(false);
    setCurrentIdx((prev) => (deck.length <= 1 ? 0 : prev >= deck.length - 1 ? 0 : prev + 1));
  };

  return (
    <div className="space-y-6">
      {/* Generator & Stats Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Smart Spaced-Repetition Flashcards
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {subjectCards.length} total cards · {dueCards.length} due now · Retention accuracy:{' '}
              {accuracyPct !== null ? `${accuracyPct}%` : 'No reviews yet'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowManualForm((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 self-start sm:self-center"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Card Manually
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-2 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        <form onSubmit={handleGenerate} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-6">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Generate From Resource
            </label>
            <select
              value={selectedResourceId || subjectResources[0]?.id || ''}
              onChange={(e) => setSelectedResourceId(e.target.value)}
              disabled={subjectResources.length === 0}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {subjectResources.length === 0 ? (
                <option value="">Upload a resource first</option>
              ) : (
                subjectResources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Number of Cards ({cardCount})
            </label>
            <input
              type="range"
              min={4}
              max={20}
              value={cardCount}
              onChange={(e) => setCardCount(Number(e.target.value))}
              className="w-full accent-indigo-600"
            />
          </div>

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={generating || subjectResources.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {generating && <Loader2 className="w-4 h-4 animate-spin" />}
              {generating ? 'Generating...' : 'Generate Cards'}
            </button>
          </div>
        </form>

        {showManualForm && (
          <form
            onSubmit={handleCreateManual}
            className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-3"
          >
            <input
              type="text"
              value={manualFront}
              onChange={(e) => setManualFront(e.target.value)}
              placeholder="Question / Front"
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              required
            />
            <input
              type="text"
              value={manualBack}
              onChange={(e) => setManualBack(e.target.value)}
              placeholder="Answer / Back"
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              required
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={manualTopic}
                onChange={(e) => setManualTopic(e.target.value)}
                placeholder="Topic"
                className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-indigo-600 text-white text-sm font-medium"
              >
                Add
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Interactive Study Deck */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => {
                setStudyMode('due');
                setCurrentIdx(0);
                setFlipped(false);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                studyMode === 'due'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Due for Review ({dueCards.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setStudyMode('all');
                setCurrentIdx(0);
                setFlipped(false);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                studyMode === 'all'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              All Cards ({subjectCards.length})
            </button>
          </div>

          {deck.length > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              Card {Math.min(currentIdx + 1, deck.length)} of {deck.length}
            </span>
          )}
        </div>

        {!activeCard ? (
          <div className="py-12 text-center space-y-3">
            <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
            <p className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {subjectCards.length === 0 ? 'No flashcards yet' : 'All due reviews complete'}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {subjectCards.length === 0
                ? 'Generate flashcards from an uploaded resource above to begin spaced-repetition practice.'
                : 'You are caught up on spaced repetition! Switch to "All Cards" to review anytime.'}
            </p>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-5">
            {/* 3D Flip Card */}
            <div
              onClick={() => setFlipped((f) => !f)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  setFlipped((f) => !f);
                }
              }}
              className="perspective-1000 cursor-pointer select-none"
            >
              <div
                className={`relative w-full min-h-[260px] transition-transform duration-500 transform-style-3d ${
                  flipped ? 'rotate-y-180' : ''
                }`}
              >
                {/* Front */}
                <div className="absolute inset-0 backface-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/70 p-8 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                    <span>
                      {activeCard.topic} · {activeCard.difficulty}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <RotateCw className="w-3.5 h-3.5" />
                      Click to flip
                    </span>
                  </div>
                  <p className="font-display text-lg sm:text-xl font-semibold text-slate-900 dark:text-white text-center leading-relaxed my-auto">
                    {activeCard.front}
                  </p>
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="tabular-nums">Interval: {activeCard.intervalDays}d</span>
                    {activeCard.hint && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowHint((h) => !h);
                        }}
                        className="inline-flex items-center gap-1 text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                        {showHint ? activeCard.hint : 'Show hint'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Back */}
                <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-2xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-950/30 p-8 flex flex-col justify-between">
                  <div className="flex items-center justify-between text-xs text-indigo-600 dark:text-indigo-300">
                    <span>Answer · {activeCard.topic}</span>
                    <span>Click to flip back</span>
                  </div>
                  <p className="text-base sm:text-lg text-slate-900 dark:text-slate-100 text-center leading-relaxed my-auto">
                    {activeCard.back}
                  </p>
                  <div className="text-xs text-slate-500 dark:text-slate-400 text-center tabular-nums">
                    Reviewed {activeCard.timesReviewed} times
                  </div>
                </div>
              </div>
            </div>

            {/* Spaced Repetition Rating Buttons */}
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => void handleRate('hard')}
                className="py-2.5 px-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-sm font-medium transition-colors"
              >
                Hard · 12h
              </button>
              <button
                type="button"
                onClick={() => void handleRate('medium')}
                className="py-2.5 px-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-sm font-medium transition-colors"
              >
                Medium · {Math.max(1, activeCard.intervalDays || 1)}d
              </button>
              <button
                type="button"
                onClick={() => void handleRate('easy')}
                className="py-2.5 px-4 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-sm font-medium transition-colors"
              >
                Easy · {Math.max(3, Math.round((activeCard.intervalDays || 1) * activeCard.easeFactor))}d
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Card Inventory List */}
      {subjectCards.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6">
          <h4 className="font-display text-sm font-semibold text-slate-900 dark:text-white mb-3">
            All Cards in {subject.name}
          </h4>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
            {subjectCards.map((c) => (
              <div key={c.id} className="py-2.5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{c.front}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {c.topic} · {c.difficulty} · {c.timesCorrect}/{c.timesReviewed} correct
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => deleteFlashcard(c.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 shrink-0"
                  aria-label="Delete flashcard"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
