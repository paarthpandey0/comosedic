import { useMemo, useState } from 'react';
import { BookmarkPlus, Lightbulb, Loader2, Sparkles } from 'lucide-react';
import type { AcademicMemory, ExplanationStyle, SavedExplanationItem, StudyResource, Subject } from '../types';
import { buildSubjectAiContext, createNote, makeId, updateAcademicMemory } from '../services/studyDb';
import { explainTopicInStyle } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';
import { sanitizeSvgMarkup } from '../utils/safeSvg';

interface ExplanationStudioViewProps {
  uid: string;
  subjects: Subject[];
  resources: StudyResource[];
  academicMemory: AcademicMemory | null;
}

const STYLES: Array<{ id: ExplanationStyle; label: string; hint: string }> = [
  { id: 'eli10', label: "Explain like I'm 10", hint: 'Friendly intuition, everyday language' },
  { id: 'school_level', label: 'Simple School Level', hint: 'Clear curriculum breakdown' },
  { id: 'academic', label: 'Detailed Academic', hint: 'Rigorous university-level depth' },
  { id: 'real_world', label: 'Real-World Example', hint: 'Practical everyday applications' },
  { id: 'visual', label: 'Visual Explanation', hint: 'Spatial layout + diagram' },
  { id: 'analogy', label: 'Analogy-Based', hint: 'Memorable extended metaphor' },
  { id: 'step_by_step', label: 'Step-by-Step', hint: 'Numbered logical derivation' },
  { id: 'exam_answer', label: 'Exam-Answer Style', hint: 'High-scoring mark scheme wording' },
];

export function ExplanationStudioView({
  uid,
  subjects,
  resources,
  academicMemory,
}: ExplanationStudioViewProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || 'general');
  const [topic, setTopic] = useState('');
  const [activeStyle, setActiveStyle] = useState<ExplanationStyle>('eli10');
  const [cache, setCache] = useState<Record<string, { contentMarkdown: string; keyTakeaway: string; diagramSvg: string }>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const cacheKey = `${subjectId}::${topic.trim().toLowerCase()}::${activeStyle}`;
  const currentResult = cache[cacheKey] || null;

  const runExplanation = async (styleToRun: ExplanationStyle) => {
    if (!topic.trim()) {
      setError('Enter a topic or concept to explore.');
      return;
    }
    setActiveStyle(styleToRun);
    const key = `${subjectId}::${topic.trim().toLowerCase()}::${styleToRun}`;
    if (cache[key]) return;

    setLoading(true);
    setError('');
    setNotice('');
    try {
      const subjectName = subjects.find((s) => s.id === subjectId)?.name || 'General Study';
      const ctx = buildSubjectAiContext(subjectId, resources, academicMemory, 18000);
      const res = await explainTopicInStyle({
        subjectName,
        topic: topic.trim(),
        style: styleToRun,
        context: ctx,
      });
      setCache((prev) => ({ ...prev, [key]: res }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate explanation.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToVault = async () => {
    if (!currentResult) return;
    const item: SavedExplanationItem = {
      id: makeId('exp'),
      subjectId,
      topic: topic.trim(),
      style: activeStyle,
      contentMarkdown: currentResult.contentMarkdown.slice(0, 6000),
      keyTakeaway: currentResult.keyTakeaway.slice(0, 400),
      createdAt: new Date().toISOString(),
    };
    const existing = academicMemory?.savedExplanations || [];
    await updateAcademicMemory(uid, {
      savedExplanations: [item, ...existing].slice(0, 35),
    });
    await createNote(uid, {
      subjectId: subjectId || 'general',
      resourceId: '',
      title: `${topic.trim()} (${STYLES.find((s) => s.id === activeStyle)?.label || activeStyle})`,
      style: 'quick',
      content: `${currentResult.contentMarkdown}\n\n**Key Takeaway:** ${currentResult.keyTakeaway}`,
      isBookmarked: true,
    });
    setNotice('Saved to your Personal Knowledge Vault & Bookmarked Notes.');
  };

  const safeSvg = useMemo(
    () => (currentResult?.diagramSvg ? sanitizeSvgMarkup(currentResult.diagramSvg) : ''),
    [currentResult]
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
          <Lightbulb className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          AI Explanation Studio
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Switch effortlessly between 8 tailored explanation styles — from Explain Like I&apos;m 10 to formal Exam-Answer precision.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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
            placeholder="Concept to explain (e.g., Quantum Tunneling, Opportunity Cost, Chain Rule)"
            className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
          />

          <button
            type="button"
            disabled={loading}
            onClick={() => void runExplanation(activeStyle)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Explain
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {STYLES.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => {
                if (topic.trim()) {
                  void runExplanation(st.id);
                } else {
                  setActiveStyle(st.id);
                }
              }}
              className={`px-3 py-2.5 rounded-xl border text-left transition-colors ${
                activeStyle === st.id
                  ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-700 dark:text-slate-300'
              }`}
            >
              <span className="block text-xs font-semibold">{st.label}</span>
              <span className="block text-[11px] opacity-70 truncate">{st.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300">{error}</div>}
      {notice && <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">{notice}</div>}

      {loading && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-12 text-center text-sm text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600 mx-auto mb-2" />
          Crafting explanation...
        </div>
      )}

      {!loading && currentResult && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                {STYLES.find((s) => s.id === activeStyle)?.label}
              </p>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">{topic}</h2>
            </div>
            <button
              type="button"
              onClick={() => void handleSaveToVault()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-900 dark:bg-indigo-600 text-white text-xs font-medium"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              Save to Vault &amp; Notes
            </button>
          </div>

          <div className="rounded-xl bg-indigo-50/70 dark:bg-indigo-950/30 p-3.5 text-xs font-medium text-indigo-900 dark:text-indigo-200">
            <strong>Key Takeaway:</strong> {currentResult.keyTakeaway}
          </div>

          {safeSvg && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-3">
              <div dangerouslySetInnerHTML={{ __html: safeSvg }} />
            </div>
          )}

          <MarkdownView content={currentResult.contentMarkdown} />
        </div>
      )}
    </div>
  );
}
