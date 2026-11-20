import { useState } from 'react';
import { BookMarked, Check, FileEdit, Loader2, Sparkles } from 'lucide-react';
import type { AcademicMemory, Subject } from '../types';
import { analyzeWritingDraft } from '../services/geminiApi';
import { awardLearningXp, createNote } from '../services/studyDb';
import { MarkdownView } from './MarkdownView';

interface WritingLabViewProps {
  uid: string;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
}

export function WritingLabView({ uid, academicMemory, subjects }: WritingLabViewProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || 'general');
  const [rubricGoal, setRubricGoal] = useState(
    'Academic essay with clear thesis, strong textual/empirical evidence, cohesive paragraph transitions, and formal tone.'
  );
  const [mode, setMode] = useState<'full' | 'argument' | 'concise'>('full');
  const [essayText, setEssayText] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const [result, setResult] = useState<{
    overallScore: number;
    rubricBreakdown: Array<{ criterion: string; score: number; feedback: string }>;
    grammarAndVocabulary: Array<{ original: string; improved: string; reason: string }>;
    argumentStrength: string;
    improvedDraft: string;
  } | null>(null);

  const wordCount = essayText.trim() ? essayText.trim().split(/\s+/).length : 0;

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!essayText.trim()) return;
    setAnalyzing(true);
    setError(null);
    setSavedNotice(false);
    try {
      const subjName = subjects.find((s) => s.id === subjectId)?.name || 'Academic Writing';
      const res = await analyzeWritingDraft({
        essayText,
        subjectName: subjName,
        rubricGoal,
        mode,
      });
      setResult(res);
      await awardLearningXp(uid, academicMemory, 25);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to evaluate draft.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveToNotes = async () => {
    if (!result) return;
    const targetSubj = subjectId !== 'general' ? subjectId : subjects[0]?.id || 'general';
    await createNote(uid, {
      subjectId: targetSubj,
      resourceId: '',
      title: `Writing Lab Revision (${result.overallScore}/100)`,
      style: 'detailed',
      content: `## Argument Evaluation\n${result.argumentStrength}\n\n## Improved Draft\n${result.improvedDraft}`,
    });
    setSavedNotice(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          AI Essay & Writing Lab
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Evaluates thesis clarity, argument evidence, rubric criteria, and sentence-level academic style with a side-by-side improved revision.
        </p>
      </div>

      <form
        onSubmit={handleAnalyze}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Subject Context
            </label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="general">General Essay / Paper</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-6">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Grading Rubric / Assignment Prompt
            </label>
            <input
              type="text"
              value={rubricGoal}
              onChange={(e) => setRubricGoal(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Feedback Focus
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'full' | 'argument' | 'concise')}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="full">Full Rubric + Style</option>
              <option value="argument">Thesis & Argument Logic</option>
              <option value="concise">Concision & Clarity</option>
            </select>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Your Draft ({wordCount} words)
            </label>
          </div>
          <textarea
            rows={9}
            value={essayText}
            onChange={(e) => setEssayText(e.target.value)}
            placeholder="Paste your essay paragraph, lab report conclusion, or extended exam response here..."
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm leading-relaxed"
            required
          />
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={analyzing || !essayText.trim()}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-60"
          >
            {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {analyzing ? 'Critiquing & Rewriting...' : 'Evaluate & Polish Draft'}
          </button>
        </div>
      </form>

      {result && (
        <div className="space-y-6">
          {/* Score & 4-Criterion Rubric */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  Rubric Assessment · {result.overallScore} / 100
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Evaluated against your stated rubric goal
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSaveToNotes()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                {savedNotice ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <BookMarked className="w-3.5 h-3.5" />}
                {savedNotice ? 'Saved to Notes' : 'Save Feedback & Draft to Notes'}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {result.rubricBreakdown.map((item, idx) => (
                <div key={idx} className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-900 dark:text-white">{item.criterion}</span>
                    <span className="font-mono text-indigo-600 dark:text-indigo-400 tabular-nums">{item.score}/25</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{item.feedback}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 p-4 space-y-1">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">Argument & Evidence Evaluation</p>
              <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{result.argumentStrength}</p>
            </div>
          </div>

          {/* Sentence-Level Upgrades */}
          {result.grammarAndVocabulary.length > 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-3">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                <FileEdit className="w-4 h-4 text-indigo-600" />
                Targeted Sentence & Vocabulary Upgrades
              </h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {result.grammarAndVocabulary.map((g, i) => (
                  <div key={i} className="py-3 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div className="text-rose-700 dark:text-rose-300 line-through decoration-rose-400/70">
                      {g.original}
                    </div>
                    <div className="text-emerald-700 dark:text-emerald-300 font-medium">{g.improved}</div>
                    <div className="text-slate-500 dark:text-slate-400">{g.reason}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Side-by-Side Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-2">
              <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">Original Draft</h3>
              <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                {essayText}
              </p>
            </div>
            <div className="rounded-2xl border border-indigo-200 dark:border-indigo-900/60 bg-white dark:bg-[#1A202C] p-6 space-y-2">
              <h3 className="font-display text-sm font-semibold text-indigo-700 dark:text-indigo-300">
                Suggested Polished Revision
              </h3>
              <MarkdownView content={result.improvedDraft} className="text-sm" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
