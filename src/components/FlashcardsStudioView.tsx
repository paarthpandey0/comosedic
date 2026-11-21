import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  Keyboard,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  Shuffle,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  AcademicMemory,
  CardDifficulty,
  Flashcard,
  StudyNote,
  StudyResource,
  Subject,
} from '../types';
import {
  awardLearningXp,
  buildSubjectAiContext,
  createFlashcardsBatch,
  deleteFlashcard,
  reviewFlashcard,
} from '../services/studyDb';
import { generateFlashcards } from '../services/geminiApi';

interface FlashcardsStudioViewProps {
  uid: string;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
  resources: StudyResource[];
  notes: StudyNote[];
  flashcards: Flashcard[];
}

type StudioPanel = 'none' | 'generate' | 'create';

export function FlashcardsStudioView({
  uid,
  academicMemory,
  subjects,
  resources,
  notes,
  flashcards,
}: FlashcardsStudioViewProps) {
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('all');
  const [studyFilter, setStudyFilter] = useState<'all' | 'due'>('all');
  const [topicFilter, setTopicFilter] = useState<string>('all');

  // Deck ordering & study stage state
  const [shuffledOrder, setShuffledOrder] = useState<string[] | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [sessionReviewed, setSessionReviewed] = useState(0);
  const [sessionEasy, setSessionEasy] = useState(0);
  const [sessionGood, setSessionGood] = useState(0);
  const [sessionAgain, setSessionAgain] = useState(0);

  // Panels: AI Generator & Manual Card Creator
  const [activePanel, setActivePanel] = useState<StudioPanel>('none');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // AI Generation form state
  const [genSubjectId, setGenSubjectId] = useState<string>(subjects[0]?.id || 'general');
  const [genSourceMode, setGenSourceMode] = useState<'materials' | 'custom'>('materials');
  const [genResourceId, setGenResourceId] = useState<string>('all_subject');
  const [genCustomNotes, setGenCustomNotes] = useState('');
  const [genTopicTitle, setGenTopicTitle] = useState('');
  const [genCount, setGenCount] = useState<10 | 12 | 15>(12);
  const [generating, setGenerating] = useState(false);

  // Manual card creation form state
  const [manualSubjectId, setManualSubjectId] = useState<string>(subjects[0]?.id || 'general');
  const [manualFront, setManualFront] = useState('');
  const [manualBack, setManualBack] = useState('');
  const [manualHint, setManualHint] = useState('');
  const [manualTopic, setManualTopic] = useState('');
  const [manualDifficulty, setManualDifficulty] = useState<CardDifficulty>('medium');
  const [creatingManual, setCreatingManual] = useState(false);

  useEffect(() => {
    if (subjects.length > 0) {
      if (genSubjectId === 'general' && !subjects.some((s) => s.id === genSubjectId)) {
        setGenSubjectId(subjects[0].id);
      }
      if (manualSubjectId === 'general' && !subjects.some((s) => s.id === manualSubjectId)) {
        setManualSubjectId(subjects[0].id);
      }
    }
  }, [subjects, genSubjectId, manualSubjectId]);

  const subjectMap = useMemo(() => {
    const m = new Map<string, Subject>();
    subjects.forEach((s) => m.set(s.id, s));
    return m;
  }, [subjects]);

  const nowIso = new Date().toISOString();

  // Filter cards by selected deck (subject)
  const deckCardsAll = useMemo(() => {
    if (selectedSubjectId === 'all') return flashcards;
    return flashcards.filter((c) => c.subjectId === selectedSubjectId);
  }, [flashcards, selectedSubjectId]);

  const availableTopics = useMemo(() => {
    const set = new Set<string>();
    deckCardsAll.forEach((c) => {
      if (c.topic) set.add(c.topic);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [deckCardsAll]);

  const filteredCards = useMemo(() => {
    let list = deckCardsAll;
    if (studyFilter === 'due') {
      list = list.filter((c) => c.nextReviewAt <= nowIso);
    }
    if (topicFilter !== 'all') {
      list = list.filter((c) => c.topic === topicFilter);
    }
    return list;
  }, [deckCardsAll, studyFilter, topicFilter, nowIso]);

  // Apply shuffle order if active
  const orderedCards = useMemo(() => {
    if (!shuffledOrder) return filteredCards;
    const byId = new Map(filteredCards.map((c) => [c.id, c]));
    const inOrder = shuffledOrder
      .map((id) => byId.get(id))
      .filter((c): c is Flashcard => Boolean(c));
    const seen = new Set(inOrder.map((c) => c.id));
    const extras = filteredCards.filter((c) => !seen.has(c.id));
    return [...inOrder, ...extras];
  }, [filteredCards, shuffledOrder]);

  // Keep currentIndex clamped cleanly
  const safeIndex = orderedCards.length > 0 ? Math.min(currentIndex, orderedCards.length - 1) : 0;
  const activeCard = orderedCards[safeIndex] || null;

  // Deck mastery telemetry
  const deckStats = useMemo(() => {
    const total = deckCardsAll.length;
    const due = deckCardsAll.filter((c) => c.nextReviewAt <= nowIso).length;
    const mastered = deckCardsAll.filter(
      (c) => c.repetitions >= 2 && c.timesReviewed > 0 && c.timesCorrect / c.timesReviewed >= 0.75
    ).length;
    const totalReviews = deckCardsAll.reduce((acc, c) => acc + (c.timesReviewed || 0), 0);
    const totalCorrect = deckCardsAll.reduce((acc, c) => acc + (c.timesCorrect || 0), 0);
    const accuracy = totalReviews > 0 ? Math.round((totalCorrect / totalReviews) * 100) : 0;
    const masteryPct = total > 0 ? Math.round((mastered / total) * 100) : 0;
    return { total, due, mastered, accuracy, masteryPct };
  }, [deckCardsAll, nowIso]);

  const handlePrev = useCallback(() => {
    if (orderedCards.length === 0) return;
    setFlipped(false);
    setShowHint(false);
    setCurrentIndex((prev) => (prev <= 0 ? orderedCards.length - 1 : prev - 1));
  }, [orderedCards.length]);

  const handleNext = useCallback(() => {
    if (orderedCards.length === 0) return;
    setFlipped(false);
    setShowHint(false);
    setCurrentIndex((prev) => (prev + 1) % orderedCards.length);
  }, [orderedCards.length]);

  const handleShuffle = () => {
    if (orderedCards.length <= 1) return;
    const ids = orderedCards.map((c) => c.id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    setShuffledOrder(ids);
    setCurrentIndex(0);
    setFlipped(false);
    setShowHint(false);
    setNotice('Deck shuffled.');
  };

  const handleRate = useCallback(
    async (rating: 'hard' | 'medium' | 'easy') => {
      if (!activeCard || ratingBusy) return;
      setRatingBusy(true);
      setError(null);
      try {
        await reviewFlashcard(activeCard, rating);
        await awardLearningXp(uid, academicMemory, rating === 'easy' ? 12 : rating === 'medium' ? 8 : 5);
        setSessionReviewed((n) => n + 1);
        if (rating === 'easy') setSessionEasy((n) => n + 1);
        else if (rating === 'medium') setSessionGood((n) => n + 1);
        else setSessionAgain((n) => n + 1);

        setFlipped(false);
        setShowHint(false);
        if (orderedCards.length > 1) {
          setCurrentIndex((prev) => (prev + 1) % orderedCards.length);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to save card rating.');
      } finally {
        setRatingBusy(false);
      }
    },
    [activeCard, ratingBusy, uid, academicMemory, orderedCards.length]
  );

  // Keyboard shortcuts: Space to flip, Left/Right to navigate, 1/2/3 to rate when flipped
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }
      if (!activeCard) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      } else if (flipped && !ratingBusy) {
        if (e.key === '1') {
          e.preventDefault();
          void handleRate('hard');
        } else if (e.key === '2') {
          e.preventDefault();
          void handleRate('medium');
        } else if (e.key === '3') {
          e.preventDefault();
          void handleRate('easy');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeCard, flipped, ratingBusy, handleNext, handlePrev, handleRate]);

  // Resources + notes available for selected generator subject
  const subjectResources = useMemo(
    () => resources.filter((r) => r.subjectId === genSubjectId),
    [resources, genSubjectId]
  );
  const subjectNotes = useMemo(
    () => notes.filter((n) => n.subjectId === genSubjectId),
    [notes, genSubjectId]
  );

  const handleGenerateDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);

    const subj = subjectMap.get(genSubjectId);
    const subjectName = subj?.name || 'General Study';
    let resourceTitle = genTopicTitle.trim() || `${subjectName} Study Deck`;
    let resourceContent = '';
    let linkedResourceId = 'studio_custom';

    if (genSourceMode === 'custom') {
      if (!genCustomNotes.trim() && !genTopicTitle.trim()) {
        setError('Paste study notes or enter a topic to generate flashcards.');
        return;
      }
      resourceContent = genCustomNotes.trim() || `Topic: ${genTopicTitle.trim()} in ${subjectName}`;
    } else {
      if (genResourceId === 'all_subject') {
        const ctx = buildSubjectAiContext(genSubjectId, resources, academicMemory, 32000);
        const notesBlob = subjectNotes
          .map((n) => `## ${n.title}\n${n.content.slice(0, 5000)}`)
          .join('\n\n');
        resourceContent = [ctx, notesBlob].filter(Boolean).join('\n\n').slice(0, 36000);
        if (!resourceContent.trim()) {
          if (genTopicTitle.trim()) {
            resourceContent = `Topic focus: ${genTopicTitle.trim()} for ${subjectName}`;
          } else {
            setError(
              'No uploaded documents or notes found in this subject yet. Switch to "Paste Notes / Topic" or upload materials in a Subject Workspace.'
            );
            return;
          }
        }
      } else if (genResourceId.startsWith('res:')) {
        const id = genResourceId.slice(4);
        const found = subjectResources.find((r) => r.id === id);
        if (found) {
          resourceTitle = genTopicTitle.trim() || found.title;
          resourceContent = `${found.summary}\n\n${found.extractedText}`.slice(0, 36000);
          linkedResourceId = found.id;
        }
      } else if (genResourceId.startsWith('note:')) {
        const id = genResourceId.slice(5);
        const found = subjectNotes.find((n) => n.id === id);
        if (found) {
          resourceTitle = genTopicTitle.trim() || found.title;
          resourceContent = found.content.slice(0, 36000);
          linkedResourceId = found.id;
        }
      }
    }

    setGenerating(true);
    try {
      const res = await generateFlashcards({
        subjectName,
        resourceTitle,
        resourceContent,
        count: genCount,
        weakTopics: academicMemory?.strugglingTopics || [],
      });

      if (!res.flashcards || res.flashcards.length === 0) {
        throw new Error('No flashcards were returned. Try adding more detail to your notes.');
      }

      const targetSubjId = genSubjectId || 'general';
      await createFlashcardsBatch(uid, targetSubjId, linkedResourceId, res.flashcards);
      await awardLearningXp(uid, academicMemory, 25);

      setSelectedSubjectId(targetSubjId === 'general' ? 'all' : targetSubjId);
      setStudyFilter('all');
      setTopicFilter('all');
      setShuffledOrder(null);
      setCurrentIndex(0);
      setFlipped(false);
      setActivePanel('none');
      setGenCustomNotes('');
      setGenTopicTitle('');
      setNotice(`Generated and synced ${res.flashcards.length} flashcards to your account.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate flashcards.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateManualCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualFront.trim() || !manualBack.trim()) {
      setError('Both Front (Question/Term) and Back (Answer/Explanation) are required.');
      return;
    }
    setCreatingManual(true);
    setError(null);
    setNotice(null);
    try {
      const targetSubjId = manualSubjectId || 'general';
      await createFlashcardsBatch(uid, targetSubjId, 'manual_studio', [
        {
          front: manualFront.trim(),
          back: manualBack.trim(),
          hint: manualHint.trim(),
          topic: manualTopic.trim() || 'Custom Card',
          difficulty: manualDifficulty,
        },
      ]);
      await awardLearningXp(uid, academicMemory, 5);
      setManualFront('');
      setManualBack('');
      setManualHint('');
      setManualTopic('');
      setNotice('Custom flashcard saved to Firestore.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create flashcard.');
    } finally {
      setCreatingManual(false);
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    try {
      await deleteFlashcard(cardId);
      setFlipped(false);
      setShowHint(false);
      setNotice('Flashcard removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete flashcard.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Studio Actions */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Layers className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Interactive Flashcards Studio
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Generate 10–15 spaced-repetition cards from your notes, create custom cards, flip in 3D, and sync mastery progress.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActivePanel((p) => (p === 'generate' ? 'none' : 'generate'))}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Generate AI Deck
          </button>
          <button
            type="button"
            onClick={() => setActivePanel((p) => (p === 'create' ? 'none' : 'create'))}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 text-xs font-medium transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            New Custom Card
          </button>
        </div>
      </div>

      {/* Feedback Alerts */}
      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* AI Flashcard Deck Generator Drawer */}
      {activePanel === 'generate' && (
        <form
          onSubmit={handleGenerateDeck}
          className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-white dark:bg-[#1A202C] p-6 space-y-4 shadow-xs"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Generate 10–15 Flashcards from Study Notes
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Builds active-recall question &amp; explanation pairs and saves them directly to Firestore.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActivePanel('none')}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              aria-label="Close generator"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Deck Subject
              </label>
              <select
                value={genSubjectId}
                onChange={(e) => {
                  setGenSubjectId(e.target.value);
                  setGenResourceId('all_subject');
                }}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value="general">General Study</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Source Material
              </label>
              <div className="grid grid-cols-2 rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setGenSourceMode('materials')}
                  className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    genSourceMode === 'materials'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Uploaded Docs
                </button>
                <button
                  type="button"
                  onClick={() => setGenSourceMode('custom')}
                  className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    genSourceMode === 'custom'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Paste Notes
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Cards to Generate
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {([10, 12, 15] as const).map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => setGenCount(cnt)}
                    className={`py-2 rounded-xl border text-xs font-semibold tabular-nums transition-colors ${
                      genCount === cnt
                        ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {cnt}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {genSourceMode === 'materials' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Document or Saved Note
                </label>
                <select
                  value={genResourceId}
                  onChange={(e) => setGenResourceId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                >
                  <option value="all_subject">
                    All Subject Documents &amp; Notes ({subjectResources.length + subjectNotes.length})
                  </option>
                  {subjectResources.map((r) => (
                    <option key={r.id} value={`res:${r.id}`}>
                      Doc: {r.title}
                    </option>
                  ))}
                  {subjectNotes.map((n) => (
                    <option key={n.id} value={`note:${n.id}`}>
                      Note: {n.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Topic Focus (Optional)
                </label>
                <input
                  type="text"
                  value={genTopicTitle}
                  onChange={(e) => setGenTopicTitle(e.target.value)}
                  placeholder="e.g. Cellular Respiration, Integration by Parts..."
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="text"
                value={genTopicTitle}
                onChange={(e) => setGenTopicTitle(e.target.value)}
                placeholder="Deck title or topic (e.g. Organic Chemistry Functional Groups)"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
              <textarea
                rows={4}
                value={genCustomNotes}
                onChange={(e) => setGenCustomNotes(e.target.value)}
                placeholder="Paste lecture notes, textbook excerpts, definitions, or key concepts..."
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white"
              />
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={generating}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? `Generating ${genCount} Cards...` : `Generate ${genCount} Flashcards`}
            </button>
          </div>
        </form>
      )}

      {/* Manual Custom Card Creator Drawer */}
      {activePanel === 'create' && (
        <form
          onSubmit={handleCreateManualCard}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4 shadow-xs"
        >
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Create Custom Flashcard
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Add your own question/term and explanation directly into your synced deck.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActivePanel('none')}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              aria-label="Close card creator"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Subject Deck
              </label>
              <select
                value={manualSubjectId}
                onChange={(e) => setManualSubjectId(e.target.value)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value="general">General Study</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Topic Tag
              </label>
              <input
                type="text"
                value={manualTopic}
                onChange={(e) => setManualTopic(e.target.value)}
                placeholder="e.g. Thermodynamics"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Initial Difficulty
              </label>
              <select
                value={manualDifficulty}
                onChange={(e) => setManualDifficulty(e.target.value as CardDifficulty)}
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Front — Question or Term
              </label>
              <textarea
                rows={3}
                value={manualFront}
                onChange={(e) => setManualFront(e.target.value)}
                placeholder="What is the Second Law of Thermodynamics?"
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Back — Answer &amp; Explanation
              </label>
              <textarea
                rows={3}
                value={manualBack}
                onChange={(e) => setManualBack(e.target.value)}
                placeholder="In any isolated system, total entropy never decreases over time (Delta S >= 0)."
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Optional Recall Hint
            </label>
            <input
              type="text"
              value={manualHint}
              onChange={(e) => setManualHint(e.target.value)}
              placeholder="Think about disorder / entropy direction..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="submit"
              disabled={creatingManual}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {creatingManual ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {creatingManual ? 'Saving...' : 'Save Flashcard'}
            </button>
          </div>
        </form>
      )}

      {/* Deck Selector & Mastery Progress Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selectedSubjectId}
              onChange={(e) => {
                setSelectedSubjectId(e.target.value);
                setTopicFilter('all');
                setShuffledOrder(null);
                setCurrentIndex(0);
                setFlipped(false);
              }}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm font-medium text-slate-900 dark:text-white"
              aria-label="Select flashcard deck"
            >
              <option value="all">All Decks ({flashcards.length} cards)</option>
              {subjects.map((s) => {
                const count = flashcards.filter((c) => c.subjectId === s.id).length;
                return (
                  <option key={s.id} value={s.id}>
                    {s.name} ({count})
                  </option>
                );
              })}
              {flashcards.some((c) => c.subjectId === 'general') && (
                <option value="general">
                  General Study ({flashcards.filter((c) => c.subjectId === 'general').length})
                </option>
              )}
            </select>

            {availableTopics.length > 1 && (
              <select
                value={topicFilter}
                onChange={(e) => {
                  setTopicFilter(e.target.value);
                  setShuffledOrder(null);
                  setCurrentIndex(0);
                  setFlipped(false);
                }}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-xs text-slate-800 dark:text-slate-200"
                aria-label="Filter by topic"
              >
                <option value="all">All Topics</option>
                {availableTopics.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}

            <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => {
                  setStudyFilter('all');
                  setCurrentIndex(0);
                  setFlipped(false);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  studyFilter === 'all'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                All ({deckCardsAll.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setStudyFilter('due');
                  setCurrentIndex(0);
                  setFlipped(false);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  studyFilter === 'due'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Due Now ({deckStats.due})
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-300 tabular-nums">
            <span>
              Mastered:{' '}
              <strong className="text-emerald-600 dark:text-emerald-400">
                {deckStats.mastered}/{deckStats.total} ({deckStats.masteryPct}%)
              </strong>
            </span>
            <span>
              Recall Rate:{' '}
              <strong className="text-slate-900 dark:text-white">
                {deckStats.accuracy}%
              </strong>
            </span>
          </div>
        </div>

        {/* Mastery Progress Bar */}
        <div className="space-y-1.5">
          <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-indigo-600 dark:bg-indigo-500 transition-all duration-500"
              style={{ width: `${deckStats.masteryPct}%` }}
            />
          </div>
          {sessionReviewed > 0 && (
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              <span>This session: {sessionReviewed} rated</span>
              <span className="text-rose-600 dark:text-rose-400">Again: {sessionAgain}</span>
              <span className="text-indigo-600 dark:text-indigo-400">Good: {sessionGood}</span>
              <span className="text-emerald-600 dark:text-emerald-400">Easy: {sessionEasy}</span>
            </div>
          )}
        </div>
      </div>

      {/* Interactive 3D Flashcard Stage */}
      {orderedCards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-[#1A202C] p-12 text-center space-y-4">
          <BookOpen className="w-8 h-8 text-indigo-500 mx-auto" />
          <div className="space-y-1">
            <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-white">
              {studyFilter === 'due' && deckCardsAll.length > 0
                ? 'All due cards reviewed!'
                : 'No flashcards in this deck yet'}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {studyFilter === 'due' && deckCardsAll.length > 0
                ? 'You are completely caught up on scheduled reviews. Switch to "All" to keep practicing or generate fresh cards.'
                : 'Generate 10–15 flashcards automatically from your uploaded documents and notes, or create custom cards manually.'}
            </p>
          </div>
          <div className="flex items-center justify-center gap-3">
            {studyFilter === 'due' && deckCardsAll.length > 0 ? (
              <button
                type="button"
                onClick={() => setStudyFilter('all')}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
              >
                Study All {deckCardsAll.length} Cards
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setActivePanel('generate')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Generate 10–15 Cards
                </button>
                <button
                  type="button"
                  onClick={() => setActivePanel('create')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create Manually
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        activeCard && (
          <div className="space-y-4">
            {/* Stage Controls Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                <span className="font-semibold text-slate-900 dark:text-white">
                  Card {safeIndex + 1} of {orderedCards.length}
                </span>
                <span>·</span>
                <span>{subjectMap.get(activeCard.subjectId)?.name || 'General Study'}</span>
                <span>·</span>
                <span>{activeCard.topic || 'Core'}</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleShuffle}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  Shuffle
                </button>
                {shuffledOrder && (
                  <button
                    type="button"
                    onClick={() => {
                      setShuffledOrder(null);
                      setCurrentIndex(0);
                      setFlipped(false);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    title="Restore original order"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleDeleteCard(activeCard.id)}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                  aria-label="Delete flashcard"
                  title="Delete card"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* 3D Flip Card */}
            <div className="perspective-1000 max-w-3xl mx-auto">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setFlipped((f) => !f)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    setFlipped((f) => !f);
                  }
                }}
                className={`relative w-full min-h-[300px] sm:min-h-[340px] cursor-pointer transition-transform duration-500 transform-style-3d ${
                  flipped ? 'rotate-y-180' : ''
                }`}
                aria-label={flipped ? 'Flashcard answer side. Press Space to flip back.' : 'Flashcard question side. Press Space to flip.'}
              >
                {/* FRONT FACE */}
                <div className="absolute inset-0 backface-hidden rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] shadow-sm p-7 sm:p-10 flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      Front · Question / Term
                    </span>
                    <span className="text-slate-400 dark:text-slate-500 tabular-nums">
                      Interval: {activeCard.intervalDays || 0}d · Rep {activeCard.repetitions || 0}
                    </span>
                  </div>

                  <div className="my-auto py-4 text-center space-y-4">
                    <p className="font-display text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white leading-snug">
                      {activeCard.front}
                    </p>

                    {activeCard.hint && (
                      <div>
                        {showHint ? (
                          <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-xl px-4 py-2 inline-block">
                            Hint: {activeCard.hint}
                          </p>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowHint(true);
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                          >
                            <HelpCircle className="w-3.5 h-3.5" />
                            Show hint
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <p className="text-center text-xs text-slate-400 dark:text-slate-500">
                    Click card or press <kbd className="font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">Space</kbd> to reveal answer
                  </p>
                </div>

                {/* BACK FACE */}
                <div className="absolute inset-0 backface-hidden rotate-y-180 rounded-2xl border-2 border-indigo-500/70 dark:border-indigo-500/60 bg-slate-50 dark:bg-[#1E2433] shadow-sm p-7 sm:p-10 flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      Back · Answer &amp; Explanation
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">
                      Rate your recall below
                    </span>
                  </div>

                  <div className="my-auto py-4 text-center overflow-y-auto max-h-52">
                    <p className="text-base sm:text-lg font-medium text-slate-900 dark:text-slate-100 leading-relaxed whitespace-pre-line">
                      {activeCard.back}
                    </p>
                  </div>

                  <p className="text-center text-xs text-slate-500 dark:text-slate-400">
                    Press <kbd className="font-mono px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300">1</kbd> Again ·{' '}
                    <kbd className="font-mono px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300">2</kbd> Good ·{' '}
                    <kbd className="font-mono px-1.5 py-0.5 rounded bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300">3</kbd> Easy
                  </p>
                </div>
              </div>
            </div>

            {/* Navigation & Self-Rating Bar */}
            <div className="max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrev}
                  className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setFlipped((f) => !f)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-100 transition-colors"
                >
                  {flipped ? 'Show Front' : 'Flip Card'}
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Self-Rating Buttons (Again / Good / Easy) */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={ratingBusy}
                  onClick={() => void handleRate('hard')}
                  className="px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-950/70 text-rose-700 dark:text-rose-300 text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  Again (1)
                </button>
                <button
                  type="button"
                  disabled={ratingBusy}
                  onClick={() => void handleRate('medium')}
                  className="px-4 py-2 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  Good (2)
                </button>
                <button
                  type="button"
                  disabled={ratingBusy}
                  onClick={() => void handleRate('easy')}
                  className="px-4 py-2 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 text-xs font-semibold transition-colors disabled:opacity-50"
                >
                  Easy (3)
                </button>
              </div>
            </div>

            {/* Keyboard Shortcuts Hint */}
            <div className="max-w-3xl mx-auto flex items-center justify-center gap-2 text-[11px] text-slate-400 dark:text-slate-500">
              <Keyboard className="w-3.5 h-3.5" />
              <span>Shortcuts: Space = Flip · Left/Right Arrows = Navigate · 1/2/3 = Rate (when flipped)</span>
            </div>

            {/* Deck Card Index */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                  Cards in This Deck ({orderedCards.length})
                </h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Click any card to jump directly to it
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                {orderedCards.map((card, idx) => {
                  const isCurrent = idx === safeIndex;
                  const isMastered =
                    card.repetitions >= 2 &&
                    card.timesReviewed > 0 &&
                    card.timesCorrect / card.timesReviewed >= 0.75;
                  return (
                    <button
                      key={card.id}
                      type="button"
                      onClick={() => {
                        setCurrentIndex(idx);
                        setFlipped(false);
                        setShowHint(false);
                      }}
                      className={`text-left rounded-xl border p-3 transition-colors flex items-start justify-between gap-3 ${
                        isCurrent
                          ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {idx + 1}. {card.front}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {card.back}
                        </p>
                      </div>
                      <div className="shrink-0 flex items-center gap-1.5">
                        {isMastered && (
                          <CheckCircle2
                            className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400"
                            aria-label="Mastered"
                          />
                        )}
                        <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 tabular-nums">
                          {card.timesReviewed > 0
                            ? `${Math.round((card.timesCorrect / card.timesReviewed) * 100)}%`
                            : 'New'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}
