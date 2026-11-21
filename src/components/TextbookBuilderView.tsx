import { useMemo, useState } from 'react';
import {
  BookMarked,
  CheckCircle2,
  Download,
  Edit3,
  Loader2,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { AcademicMemory, QuizDifficulty, StudyResource, Subject, Textbook, TextbookChapter } from '../types';
import { buildSubjectAiContext, createTextbook, deleteTextbook, updateTextbook } from '../services/studyDb';
import { generatePersonalTextbook } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';
import { sanitizeSvgMarkup } from '../utils/safeSvg';

interface TextbookBuilderViewProps {
  uid: string;
  subjects: Subject[];
  resources: StudyResource[];
  academicMemory: AcademicMemory | null;
  textbooks: Textbook[];
}

export function TextbookBuilderView({
  uid,
  subjects,
  resources,
  academicMemory,
  textbooks,
}: TextbookBuilderViewProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || 'general');
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('standard');
  const [chapterCount, setChapterCount] = useState(3);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [activeBookId, setActiveBookId] = useState<string>(textbooks[0]?.id || '');
  const [activeChapterIdx, setActiveChapterIdx] = useState(0);
  const [editingExplanation, setEditingExplanation] = useState(false);
  const [draftExplanation, setDraftExplanation] = useState('');
  const [revealedAnswers, setRevealedAnswers] = useState<Record<string, boolean>>({});
  const [testAnswers, setTestAnswers] = useState<Record<string, string>>({});
  const [testSubmitted, setTestSubmitted] = useState(false);

  const activeBook = useMemo(
    () => textbooks.find((b) => b.id === activeBookId) || textbooks[0] || null,
    [textbooks, activeBookId]
  );

  const activeChapter: TextbookChapter | null = activeBook?.chapters?.[activeChapterIdx] || null;
  const safeIllustration = useMemo(
    () => (activeChapter?.illustrationSvg ? sanitizeSvgMarkup(activeChapter.illustrationSvg) : ''),
    [activeChapter]
  );

  const handleGenerate = async () => {
    if (!topic.trim()) {
      setError('Enter a topic to generate your textbook.');
      return;
    }
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const subjectName = subjects.find((s) => s.id === subjectId)?.name || 'General Study';
      const ctx = buildSubjectAiContext(subjectId, resources, academicMemory, 28000);
      const res = await generatePersonalTextbook({
        subjectName,
        topic: topic.trim(),
        difficulty,
        chapterCount,
        resourcesContext: ctx,
      });
      const newId = await createTextbook(uid, {
        subjectId,
        title: res.title,
        topic: topic.trim(),
        difficulty,
        chapters: res.chapters,
      });
      setActiveBookId(newId);
      setActiveChapterIdx(0);
      setNotice('Personalized textbook generated and saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate textbook.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveChapterEdit = async () => {
    if (!activeBook || !activeChapter) return;
    const updatedChapters = activeBook.chapters.map((ch, idx) =>
      idx === activeChapterIdx ? { ...ch, explanationMarkdown: draftExplanation } : ch
    );
    await updateTextbook(activeBook.id, { chapters: updatedChapters });
    setEditingExplanation(false);
    setNotice('Chapter edits saved.');
  };

  const handleExportMarkdown = () => {
    if (!activeBook) return;
    const md = [
      `# ${activeBook.title}`,
      `Difficulty: ${activeBook.difficulty} · Topic: ${activeBook.topic}`,
      '',
      ...activeBook.chapters.flatMap((ch, idx) => [
        `## Chapter ${idx + 1}: ${ch.title}`,
        '### Learning Objectives',
        ...ch.objectives.map((o) => `- ${o}`),
        '',
        ch.explanationMarkdown,
        '',
        '### Key Terminology',
        ...ch.terminology.map((t) => `- **${t.term}**: ${t.definition}`),
        '',
        '### Chapter Summary',
        ch.summary,
        '',
      ]),
    ].join('\n');

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeBook.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <BookMarked className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Personal Textbook Builder
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Generate editable custom textbooks complete with objectives, diagrams, worked examples, terminology, and chapter tests.
          </p>
        </div>

        {activeBook && (
          <button
            type="button"
            onClick={handleExportMarkdown}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5" />
            Export Markdown
          </button>
        )}
      </div>

      {/* Generator Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 grid grid-cols-1 md:grid-cols-5 gap-3">
        <select
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
        >
          <option value="general">General Study</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Textbook topic (e.g., Thermodynamics, Cellular Respiration)"
          className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
        />

        <div className="flex gap-2">
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as QuizDifficulty)}
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            <option value="foundation">Foundation</option>
            <option value="standard">Standard</option>
            <option value="advanced">Advanced</option>
          </select>
          <select
            value={chapterCount}
            onChange={(e) => setChapterCount(Number(e.target.value))}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-2.5 py-2 text-sm text-slate-900 dark:text-white"
          >
            <option value={2}>2 Ch</option>
            <option value={3}>3 Ch</option>
            <option value={4}>4 Ch</option>
          </select>
        </div>

        <button
          type="button"
          disabled={generating}
          onClick={() => void handleGenerate()}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          Build Textbook
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</div>
      )}

      {textbooks.length > 0 && activeBook && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Library + Chapters Sidebar */}
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Your Textbooks</p>
              {textbooks.map((book) => (
                <div key={book.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveBookId(book.id);
                      setActiveChapterIdx(0);
                      setEditingExplanation(false);
                      setTestSubmitted(false);
                    }}
                    className={`flex-1 text-left px-3 py-2 rounded-xl text-xs font-medium truncate ${
                      activeBook.id === book.id
                        ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {book.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteTextbook(book.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600"
                    aria-label="Delete textbook"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Chapters</p>
              {activeBook.chapters.map((ch, idx) => (
                <button
                  key={ch.id || idx}
                  type="button"
                  onClick={() => {
                    setActiveChapterIdx(idx);
                    setEditingExplanation(false);
                    setTestSubmitted(false);
                    setTestAnswers({});
                  }}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
                    activeChapterIdx === idx
                      ? 'bg-slate-900 dark:bg-indigo-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  Ch {idx + 1}. {ch.title}
                </button>
              ))}
            </div>
          </div>

          {/* Chapter Content */}
          {activeChapter && (
            <div className="lg:col-span-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-6">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    {activeBook.title} · Chapter {activeChapterIdx + 1}
                  </p>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white mt-1">{activeChapter.title}</h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setDraftExplanation(activeChapter.explanationMarkdown);
                    setEditingExplanation((v) => !v);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  {editingExplanation ? 'Cancel Edit' : 'Edit Chapter'}
                </button>
              </div>

              <div className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-4 space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Learning Objectives</p>
                <ul className="list-disc pl-5 text-sm text-slate-700 dark:text-slate-200 space-y-1">
                  {activeChapter.objectives.map((obj, i) => (
                    <li key={i}>{obj}</li>
                  ))}
                </ul>
              </div>

              {safeIllustration && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-900/40">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    Chapter Illustration
                  </p>
                  <div dangerouslySetInnerHTML={{ __html: safeIllustration }} />
                </div>
              )}

              {editingExplanation ? (
                <div className="space-y-3">
                  <textarea
                    rows={12}
                    value={draftExplanation}
                    onChange={(e) => setDraftExplanation(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 p-3 text-sm font-mono text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSaveChapterEdit()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-medium"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save Chapter Changes
                  </button>
                </div>
              ) : (
                <MarkdownView content={activeChapter.explanationMarkdown} />
              )}

              {/* Worked Examples */}
              <div className="space-y-3">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Worked Examples</h3>
                {activeChapter.workedExamples.map((ex, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{ex.problem}</p>
                    <MarkdownView content={ex.solution} />
                  </div>
                ))}
              </div>

              {/* Key Terminology */}
              <div className="space-y-2">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Key Terminology</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {activeChapter.terminology.map((t, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                      <p className="text-xs font-bold text-indigo-700 dark:text-indigo-400">{t.term}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">{t.definition}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Practice Exercises */}
              <div className="space-y-3">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">Practice Exercises</h3>
                {activeChapter.exercises.map((ex, i) => {
                  const key = `${activeChapterIdx}_${i}`;
                  return (
                    <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{i + 1}. {ex.prompt}</p>
                      <p className="text-xs text-slate-500">Hint: {ex.hint}</p>
                      <button
                        type="button"
                        onClick={() => setRevealedAnswers((prev) => ({ ...prev, [key]: !prev[key] }))}
                        className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        {revealedAnswers[key] ? 'Hide Solution' : 'Reveal Solution'}
                      </button>
                      {revealedAnswers[key] && (
                        <p className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-2.5 rounded-lg">
                          {ex.answer}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* End-of-Chapter Test */}
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/40 dark:bg-indigo-950/20 p-5 space-y-4">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">End-of-Chapter Test</h3>
                {activeChapter.chapterTest.map((q, i) => (
                  <div key={i} className="space-y-2">
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{i + 1}. {q.prompt}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {q.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setTestAnswers((prev) => ({ ...prev, [String(i)]: opt }))}
                          className={`px-3 py-2 rounded-lg border text-left text-xs ${
                            testAnswers[String(i)] === opt
                              ? 'border-indigo-600 bg-white dark:bg-slate-800 font-semibold'
                              : 'border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                    {testSubmitted && (
                      <p className="text-xs text-slate-700 dark:text-slate-300">
                        {testAnswers[String(i)] === q.correctAnswer ? '✓ Correct.' : `✗ Correct: ${q.correctAnswer}.`} {q.explanation}
                      </p>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setTestSubmitted(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-medium"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Check Chapter Test
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
