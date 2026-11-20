import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BookOpen,
  FileText,
  Layers,
  Loader2,
  PenTool,
  Search,
  Sparkles,
} from 'lucide-react';
import type {
  AcademicMemory,
  Flashcard,
  MistakeEntry,
  StudyNote,
  StudyResource,
  Subject,
  WhiteboardBoard,
  WorkspaceTab,
} from '../types';
import { compareResources } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';

interface KnowledgeVaultViewProps {
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
  resources: StudyResource[];
  notes: StudyNote[];
  flashcards: Flashcard[];
  mistakes: MistakeEntry[];
  whiteboards: WhiteboardBoard[];
  onOpenSubject: (subjectId: string, tab?: WorkspaceTab) => void;
}

type VaultCategory =
  | 'all'
  | 'definitions'
  | 'formulas'
  | 'concepts'
  | 'notes'
  | 'explanations'
  | 'whiteboards'
  | 'mistakes';

export function KnowledgeVaultView({
  academicMemory,
  subjects,
  resources,
  notes,
  flashcards,
  mistakes,
  whiteboards,
  onOpenSubject,
}: KnowledgeVaultViewProps) {
  const [query, setQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [category, setCategory] = useState<VaultCategory>('all');

  // Vault Gemini Q&A
  const [vaultPrompt, setVaultPrompt] = useState('');
  const [asking, setAsking] = useState(false);
  const [vaultAnswer, setVaultAnswer] = useState('');
  const [vaultError, setVaultError] = useState<string | null>(null);

  const subjectMap = useMemo(() => {
    const m = new Map<string, Subject>();
    subjects.forEach((s) => m.set(s.id, s));
    return m;
  }, [subjects]);

  const vaultItems = useMemo(() => {
    const items: Array<{
      id: string;
      kind: Exclude<VaultCategory, 'all'>;
      kindLabel: string;
      subjectId: string;
      subjectName: string;
      title: string;
      body: string;
      tab?: WorkspaceTab;
    }> = [];

    resources.forEach((r) => {
      const sName = subjectMap.get(r.subjectId)?.name || 'General';
      r.definitions.forEach((def, idx) => {
        items.push({
          id: `def_${r.id}_${idx}`,
          kind: 'definitions',
          kindLabel: 'Definition',
          subjectId: r.subjectId,
          subjectName: sName,
          title: r.title,
          body: def,
          tab: 'resources',
        });
      });
      r.formulas.forEach((f, idx) => {
        items.push({
          id: `form_${r.id}_${idx}`,
          kind: 'formulas',
          kindLabel: 'Formula / Law',
          subjectId: r.subjectId,
          subjectName: sName,
          title: r.title,
          body: f,
          tab: 'resources',
        });
      });
      r.keyConcepts.forEach((c, idx) => {
        items.push({
          id: `con_${r.id}_${idx}`,
          kind: 'concepts',
          kindLabel: 'Key Concept',
          subjectId: r.subjectId,
          subjectName: sName,
          title: r.title,
          body: c,
          tab: 'resources',
        });
      });
    });

    notes.forEach((n) => {
      items.push({
        id: `note_${n.id}`,
        kind: 'notes',
        kindLabel: `${n.style} note`,
        subjectId: n.subjectId,
        subjectName: subjectMap.get(n.subjectId)?.name || 'General',
        title: n.title,
        body: n.content.slice(0, 320),
        tab: 'notes',
      });
    });

    (academicMemory?.savedExplanations || []).forEach((ex) => {
      items.push({
        id: `ex_${ex.id}`,
        kind: 'explanations',
        kindLabel: `Explanation (${ex.style})`,
        subjectId: ex.subjectId,
        subjectName: subjectMap.get(ex.subjectId)?.name || 'General',
        title: ex.topic,
        body: ex.keyTakeaway || ex.contentMarkdown.slice(0, 260),
      });
    });

    whiteboards.forEach((wb) => {
      if (!wb.aiNotes && !wb.title) return;
      items.push({
        id: `wb_${wb.id}`,
        kind: 'whiteboards',
        kindLabel: 'Whiteboard',
        subjectId: wb.subjectId,
        subjectName: subjectMap.get(wb.subjectId)?.name || 'General',
        title: wb.title,
        body: wb.aiNotes ? wb.aiNotes.slice(0, 280) : 'Saved whiteboard sketch',
      });
    });

    mistakes.forEach((m) => {
      items.push({
        id: `mist_${m.id}`,
        kind: 'mistakes',
        kindLabel: m.resolved ? 'Resolved Mistake' : 'Active Misconception',
        subjectId: m.subjectId,
        subjectName: subjectMap.get(m.subjectId)?.name || 'General',
        title: `${m.topic} — ${m.question.slice(0, 80)}`,
        body: m.misconception || m.explanation,
      });
    });

    return items;
  }, [resources, notes, academicMemory?.savedExplanations, whiteboards, mistakes, subjectMap]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vaultItems.filter((item) => {
      if (subjectFilter !== 'all' && item.subjectId !== subjectFilter) return false;
      if (category !== 'all' && item.kind !== category) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.body.toLowerCase().includes(q) ||
        item.subjectName.toLowerCase().includes(q)
      );
    });
  }, [vaultItems, query, subjectFilter, category]);

  const handleAskVault = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vaultPrompt.trim()) return;
    const blocked = new Set(academicMemory?.aiPrivacyBlockedSubjectIds || []);
    const docs = filtered
      .filter((i) => !blocked.has(i.subjectId))
      .slice(0, 14)
      .map((i) => ({
        title: `[${i.kindLabel}] ${i.title}`,
        summary: i.subjectName,
        excerpt: i.body,
      }));
    if (docs.length === 0) {
      setVaultError('No unlocked vault entries match your current filter.');
      return;
    }
    setAsking(true);
    setVaultError(null);
    try {
      const subjLabel =
        subjectFilter === 'all' ? 'All Subjects' : subjectMap.get(subjectFilter)?.name || 'Subject';
      const res = await compareResources({
        subjectName: subjLabel,
        documents: docs,
        question: vaultPrompt.trim(),
      });
      setVaultAnswer(res.answer);
    } catch (err) {
      setVaultError(err instanceof Error ? err.message : 'Unable to query Knowledge Vault.');
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
          Personal Knowledge Vault
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Every extracted definition, formula, saved note, whiteboard analysis, explanation, and resolved misconception unified in one searchable archive.
        </p>
      </div>

      {/* Vault Summary Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Vault Entries</span>
            <Archive className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
            {vaultItems.length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Saved Notes</span>
            <BookOpen className="w-4 h-4 text-blue-600" />
          </div>
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
            {notes.length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Flashcards</span>
            <Layers className="w-4 h-4 text-violet-600" />
          </div>
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
            {flashcards.length}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Whiteboards & Mistakes</span>
            <PenTool className="w-4 h-4 text-amber-600" />
          </div>
          <p className="font-display text-2xl font-bold text-slate-900 dark:text-white mt-1 tabular-nums">
            {whiteboards.length + mistakes.length}
          </p>
        </div>
      </div>

      {/* Filters + Ask Vault Gemini */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-6 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter definitions, formulas, notes, or misconceptions..."
              className="w-full pl-9 pr-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
            />
          </div>
          <div className="md:col-span-3">
            <select
              value={subjectFilter}
              onChange={(e) => setSubjectFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="all">All Subjects</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-3">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as VaultCategory)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              <option value="all">All Knowledge Types</option>
              <option value="definitions">Definitions</option>
              <option value="formulas">Formulas & Laws</option>
              <option value="concepts">Key Concepts</option>
              <option value="notes">Study Notes</option>
              <option value="explanations">Saved Explanations</option>
              <option value="whiteboards">Whiteboard Notes</option>
              <option value="mistakes">Mistakes Log</option>
            </select>
          </div>
        </div>

        <form onSubmit={handleAskVault} className="flex flex-col sm:flex-row gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
          <input
            type="text"
            value={vaultPrompt}
            onChange={(e) => setVaultPrompt(e.target.value)}
            placeholder="Ask Gemini a question synthesized from your filtered Knowledge Vault..."
            className="flex-1 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
          <button
            type="submit"
            disabled={asking || !vaultPrompt.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-60 whitespace-nowrap"
          >
            {asking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {asking ? 'Synthesizing...' : 'Synthesize Vault Answer'}
          </button>
        </form>

        {vaultError && <p className="text-xs text-rose-600">{vaultError}</p>}
        {vaultAnswer && (
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-4">
            <MarkdownView content={vaultAnswer} className="text-sm" />
          </div>
        )}
      </div>

      {/* Vault Entries */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6">
        <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white mb-4 tabular-nums">
          Matching Entries ({filtered.length})
        </h2>

        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
            <FileText className="w-7 h-7 mx-auto text-slate-400 mb-2" />
            No knowledge entries match your current filter. Upload study documents, generate notes, or log mistakes to populate your vault.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filtered.slice(0, 60).map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 flex flex-col justify-between"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400 capitalize">
                      {item.kindLabel}
                    </span>
                    <span>{item.subjectName}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</p>
                  <p
                    className={`text-xs text-slate-600 dark:text-slate-300 leading-relaxed ${
                      item.kind === 'formulas' ? 'font-mono bg-slate-50 dark:bg-slate-900 p-2 rounded-lg' : ''
                    }`}
                  >
                    {item.kind === 'mistakes' && (
                      <AlertTriangle className="w-3.5 h-3.5 inline mr-1 text-amber-500" />
                    )}
                    {item.body}
                  </p>
                </div>
                {item.tab && subjectMap.has(item.subjectId) && (
                  <button
                    type="button"
                    onClick={() => onOpenSubject(item.subjectId, item.tab)}
                    className="self-start text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline pt-1"
                  >
                    Open in Subject Workspace →
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
