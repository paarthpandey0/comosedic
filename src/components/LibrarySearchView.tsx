import { useMemo, useState } from 'react';
import { Bookmark, BookOpen, FileText, Layers, Loader2, MessageSquare, Search, Sparkles } from 'lucide-react';
import type {
  Flashcard,
  Quiz,
  StudyNote,
  StudyResource,
  Subject,
  TutorMessage,
  WorkspaceTab,
} from '../types';
import { toggleNoteBookmark, toggleTutorMessageBookmark } from '../services/studyDb';
import { semanticSearchLibrary } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';

interface LibrarySearchViewProps {
  subjects: Subject[];
  resources: StudyResource[];
  notes: StudyNote[];
  flashcards: Flashcard[];
  quizzes: Quiz[];
  tutorMessages: TutorMessage[];
  onOpenSubject: (subjectId: string, tab: WorkspaceTab) => void;
}

export function LibrarySearchView({
  subjects,
  resources,
  notes,
  flashcards,
  quizzes,
  tutorMessages,
  onOpenSubject,
}: LibrarySearchViewProps) {
  const [queryText, setQueryText] = useState('');
  const [activeTab, setActiveTab] = useState<'search' | 'bookmarks'>('search');
  const [aiSearching, setAiSearching] = useState(false);
  const [aiAnswer, setAiAnswer] = useState('');
  const [aiRankedIds, setAiRankedIds] = useState<string[]>([]);

  const subjectMap = useMemo(() => {
    const m = new Map<string, Subject>();
    subjects.forEach((s) => m.set(s.id, s));
    return m;
  }, [subjects]);

  const allIndexItems = useMemo(() => {
    const resItems = resources.map((r) => ({
      id: r.id,
      kind: 'Document',
      subjectId: r.subjectId,
      tab: 'resources' as WorkspaceTab,
      title: r.title,
      snippet: `${r.summary} ${r.keyConcepts.join(' ')}`,
    }));
    const noteItems = notes.map((n) => ({
      id: n.id,
      kind: 'Note',
      subjectId: n.subjectId,
      tab: 'notes' as WorkspaceTab,
      title: n.title,
      snippet: n.content.slice(0, 300),
    }));
    const cardItems = flashcards.map((c) => ({
      id: c.id,
      kind: 'Flashcard',
      subjectId: c.subjectId,
      tab: 'flashcards' as WorkspaceTab,
      title: c.front,
      snippet: `${c.topic} — ${c.back}`,
    }));
    const tutorItems = tutorMessages.map((t) => ({
      id: t.id,
      kind: 'Tutor Chat',
      subjectId: t.subjectId,
      tab: 'tutor' as WorkspaceTab,
      title: `${t.role === 'user' ? 'Question' : 'Explanation'}: ${t.content.slice(0, 65)}`,
      snippet: t.content.slice(0, 300),
    }));
    const mistakeItems = quizzes
      .filter((q) => q.status === 'completed')
      .flatMap((q) =>
        q.results
          .filter((r) => !r.isCorrect)
          .map((r) => {
            const qq = q.questions.find((x) => x.id === r.questionId);
            return {
              id: `${q.id}_${r.questionId}`,
              kind: 'Past Mistake',
              subjectId: q.subjectId,
              tab: 'quizzes' as WorkspaceTab,
              title: qq?.prompt || q.title,
              snippet: `Feedback: ${r.feedback} · Topic: ${qq?.topic || 'General'}`,
            };
          })
      );
    return [...resItems, ...noteItems, ...cardItems, ...tutorItems, ...mistakeItems];
  }, [resources, notes, flashcards, tutorMessages, quizzes]);

  const handleSemanticSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryText.trim()) return;
    setAiSearching(true);
    setAiAnswer('');
    try {
      const res = await semanticSearchLibrary({
        queryText: queryText.trim(),
        indexItems: allIndexItems.slice(0, 60).map(({ id, kind, subjectId, title, snippet }) => ({
          id,
          kind,
          subjectId,
          title,
          snippet: snippet.slice(0, 220),
        })),
      });
      setAiAnswer(res.answer);
      setAiRankedIds(res.rankedIds);
    } finally {
      setAiSearching(false);
    }
  };

  const q = queryText.trim().toLowerCase();

  const matchedResources = useMemo(
    () =>
      resources.filter((r) =>
        !q
          ? true
          : r.title.toLowerCase().includes(q) ||
            r.summary.toLowerCase().includes(q) ||
            r.extractedText.toLowerCase().includes(q) ||
            r.keyConcepts.some((c) => c.toLowerCase().includes(q)) ||
            r.formulas.some((f) => f.toLowerCase().includes(q))
      ),
    [resources, q]
  );

  const matchedNotes = useMemo(
    () =>
      notes.filter((n) =>
        !q ? true : n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q)
      ),
    [notes, q]
  );

  const matchedFlashcards = useMemo(
    () =>
      flashcards.filter((c) =>
        !q
          ? true
          : c.front.toLowerCase().includes(q) ||
            c.back.toLowerCase().includes(q) ||
            c.topic.toLowerCase().includes(q)
      ),
    [flashcards, q]
  );

  const bookmarkedNotes = useMemo(() => notes.filter((n) => n.isBookmarked), [notes]);
  const bookmarkedTutor = useMemo(() => tutorMessages.filter((m) => m.isBookmarked), [tutorMessages]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            AI Search Everything & Bookmarks
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Natural-language semantic search across documents, notes, flashcards, tutor chats, quizzes, and past mistakes
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 self-start">
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'search'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Search All
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bookmarks')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'bookmarks'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Bookmarks ({bookmarkedNotes.length + bookmarkedTutor.length})
          </button>
        </div>
      </div>

      {activeTab === 'search' ? (
        <div className="space-y-6">
          <form onSubmit={handleSemanticSearch} className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={queryText}
                onChange={(e) => setQueryText(e.target.value)}
                placeholder='Ask or search anything (e.g., "where did I struggle with kinetics?" or "Bernoulli formula")...'
                className="w-full pl-11 pr-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <button
              type="submit"
              disabled={aiSearching || !queryText.trim()}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-60 whitespace-nowrap"
            >
              {aiSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {aiSearching ? 'Searching Library...' : 'Ask Gemini Search'}
            </button>
          </form>

          {aiAnswer && (
            <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/20 p-5 space-y-3">
              <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                Gemini Cross-Library Answer
              </p>
              <p className="text-sm text-slate-800 dark:text-slate-100 leading-relaxed">{aiAnswer}</p>
              {aiRankedIds.length > 0 && (
                <div className="pt-2 border-t border-indigo-200/60 dark:border-indigo-900/40 flex flex-wrap gap-2">
                  {aiRankedIds.map((rid) => {
                    const hit = allIndexItems.find((item) => item.id === rid);
                    if (!hit) return null;
                    return (
                      <button
                        key={rid}
                        type="button"
                        onClick={() => onOpenSubject(hit.subjectId, hit.tab)}
                        className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-800 text-xs text-left hover:border-indigo-500"
                      >
                        <span className="font-semibold text-indigo-600 dark:text-indigo-400">{hit.kind}:</span>{' '}
                        <span className="text-slate-800 dark:text-slate-200">{hit.title.slice(0, 48)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Documents */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                Documents ({matchedResources.length})
              </div>
              {matchedResources.length === 0 ? (
                <p className="text-xs text-slate-500">No matching documents.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {matchedResources.slice(0, 12).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onOpenSubject(r.subjectId, 'resources')}
                      className="w-full py-2.5 text-left hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      <p className="text-sm font-medium truncate">{r.title}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {subjectMap.get(r.subjectId)?.name || 'Subject'} · {r.fileType.toUpperCase()}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                Notes ({matchedNotes.length})
              </div>
              {matchedNotes.length === 0 ? (
                <p className="text-xs text-slate-500">No matching notes.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {matchedNotes.slice(0, 12).map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => onOpenSubject(n.subjectId, 'notes')}
                      className="w-full py-2.5 text-left hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      <p className="text-sm font-medium truncate">{n.title}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {subjectMap.get(n.subjectId)?.name || 'Subject'} · {n.style}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Flashcards */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
                <Layers className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                Flashcards ({matchedFlashcards.length})
              </div>
              {matchedFlashcards.length === 0 ? (
                <p className="text-xs text-slate-500">No matching flashcards.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {matchedFlashcards.slice(0, 12).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onOpenSubject(c.subjectId, 'flashcards')}
                      className="w-full py-2.5 text-left hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      <p className="text-sm font-medium truncate">{c.front}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {subjectMap.get(c.subjectId)?.name || 'Subject'} · {c.topic}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Bookmark className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              Saved AI Tutor Explanations ({bookmarkedTutor.length})
            </h2>
            {bookmarkedTutor.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Bookmark helpful AI Tutor explanations inside any subject to review them quickly here.
              </p>
            ) : (
              <div className="space-y-4">
                {bookmarkedTutor.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1.5 font-medium text-indigo-600 dark:text-indigo-400">
                        <MessageSquare className="w-3.5 h-3.5" />
                        {subjectMap.get(m.subjectId)?.name || 'Subject'}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleTutorMessageBookmark(m.id, false)}
                        className="hover:text-rose-600"
                      >
                        Remove bookmark
                      </button>
                    </div>
                    <MarkdownView content={m.content} className="text-sm" />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Bookmarked Notes ({bookmarkedNotes.length})
            </h2>
            {bookmarkedNotes.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No bookmarked notes yet.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {bookmarkedNotes.map((n) => (
                  <div key={n.id} className="py-3 flex items-center justify-between gap-4">
                    <div>
                      <button
                        type="button"
                        onClick={() => onOpenSubject(n.subjectId, 'notes')}
                        className="text-sm font-semibold text-slate-900 dark:text-white hover:text-indigo-600"
                      >
                        {n.title}
                      </button>
                      <p className="text-xs text-slate-500">
                        {subjectMap.get(n.subjectId)?.name || 'Subject'} · {n.style}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleNoteBookmark(n.id, false)}
                      className="text-xs text-slate-500 hover:text-rose-600"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
