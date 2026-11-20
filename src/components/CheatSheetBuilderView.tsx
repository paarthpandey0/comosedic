import { useEffect, useState } from 'react';
import {
  Columns2,
  Columns3,
  Download,
  Edit3,
  FileSpreadsheet,
  Loader2,
  Plus,
  Printer,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  AcademicMemory,
  CheatSheet,
  CheatSheetSection,
  StudyResource,
  Subject,
} from '../types';
import {
  awardLearningXp,
  buildSubjectAiContext,
  createCheatSheet,
  deleteCheatSheet,
  makeId,
  updateCheatSheet,
} from '../services/studyDb';
import { generateExamCheatSheet } from '../services/geminiApi';

interface CheatSheetBuilderViewProps {
  uid: string;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
  resources: StudyResource[];
  cheatSheets: CheatSheet[];
}

export function CheatSheetBuilderView({
  uid,
  academicMemory,
  subjects,
  resources,
  cheatSheets,
}: CheatSheetBuilderViewProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || 'general');
  const [focusTopics, setFocusTopics] = useState('');
  const [layoutColumns, setLayoutColumns] = useState<2 | 3>(2);
  const [selectedId, setSelectedId] = useState<string>(cheatSheets[0]?.id || '');

  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftColumns, setDraftColumns] = useState<2 | 3>(2);
  const [draftSections, setDraftSections] = useState<CheatSheetSection[]>([]);

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeSheet = cheatSheets.find((s) => s.id === selectedId) || cheatSheets[0] || null;

  useEffect(() => {
    if (!selectedId && cheatSheets.length > 0) {
      setSelectedId(cheatSheets[0].id);
    }
  }, [cheatSheets, selectedId]);

  useEffect(() => {
    if (activeSheet && !isEditing) {
      setDraftTitle(activeSheet.title);
      setDraftColumns(activeSheet.layoutColumns === 3 ? 3 : 2);
      setDraftSections(activeSheet.sections);
    }
  }, [activeSheet, isEditing]);

  const handleGenerate = async () => {
    const subject = subjects.find((s) => s.id === subjectId);
    const topicQuery = focusTopics.trim() || subject?.topics.slice(0, 6).join(', ') || subject?.name || '';
    if (!topicQuery) {
      setError('Enter the topics or exam chapters to condense into a crib sheet.');
      return;
    }

    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const context = buildSubjectAiContext(subjectId, resources, academicMemory, 24000);
      const res = await generateExamCheatSheet({
        subjectName: subject?.name || 'General Exam',
        focusTopics: topicQuery,
        layoutColumns,
        context,
      });

      const newId = await createCheatSheet(uid, {
        subjectId: subjectId || 'general',
        title: res.title,
        layoutColumns,
        sections: res.sections,
      });
      void awardLearningXp(uid, academicMemory, 30);
      setSelectedId(newId);
      setIsEditing(false);
      setFocusTopics('');
      setNotice(`Generated "${res.title}" (${res.sections.length} high-density sections).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate cheat sheet.');
    } finally {
      setGenerating(false);
    }
  };

  const handleToggleColumns = async (cols: 2 | 3) => {
    setDraftColumns(cols);
    if (activeSheet && !isEditing) {
      await updateCheatSheet(activeSheet.id, { layoutColumns: cols });
    }
  };

  const handleSaveEdits = async () => {
    if (!activeSheet) return;
    setSaving(true);
    setError('');
    try {
      await updateCheatSheet(activeSheet.id, {
        title: draftTitle,
        layoutColumns: draftColumns,
        sections: draftSections,
      });
      setIsEditing(false);
      setNotice('Cheat sheet edits saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSectionField = (
    sectionId: string,
    field: 'heading' | 'keyPoints' | 'formulas' | 'mnemonics' | 'pitfalls',
    rawValue: string
  ) => {
    setDraftSections((prev) =>
      prev.map((sec) => {
        if (sec.id !== sectionId) return sec;
        if (field === 'heading') {
          return { ...sec, heading: rawValue };
        }
        const lines = rawValue
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        return { ...sec, [field]: lines };
      })
    );
  };

  const handleAddBlankSection = () => {
    setDraftSections((prev) => [
      ...prev,
      {
        id: makeId('sec'),
        heading: 'New High-Yield Section',
        keyPoints: ['Core concept summary'],
        formulas: [],
        mnemonics: [],
        pitfalls: [],
      },
    ]);
  };

  const handleRemoveSection = (sectionId: string) => {
    setDraftSections((prev) => prev.filter((s) => s.id !== sectionId));
  };

  const handleExportMarkdown = () => {
    if (!activeSheet) return;
    const md = [
      `# ${activeSheet.title}`,
      '',
      ...activeSheet.sections.flatMap((sec) => {
        const block = [`## ${sec.heading}`];
        if (sec.keyPoints.length > 0) {
          block.push('### Key Points', ...sec.keyPoints.map((p) => `- ${p}`));
        }
        if (sec.formulas.length > 0) {
          block.push('### Formulas & Rules', ...sec.formulas.map((f) => `- \`${f}\``));
        }
        if (sec.mnemonics.length > 0) {
          block.push('### Mnemonics', ...sec.mnemonics.map((m) => `- ${m}`));
        }
        if (sec.pitfalls.length > 0) {
          block.push('### Exam Pitfalls', ...sec.pitfalls.map((p) => `- ${p}`));
        }
        block.push('');
        return block;
      }),
    ].join('\n');

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeSheet.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const renderedColumns = isEditing ? draftColumns : activeSheet?.layoutColumns === 3 ? 3 : 2;
  const renderedSections = isEditing ? draftSections : activeSheet?.sections || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <FileSpreadsheet className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Exam Cheat-Sheet Builder
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Condense entire units into ultra-dense 2- or 3-column printable crib sheets with formulas, mnemonics, and common exam traps.
          </p>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
          {cheatSheets.length} saved crib sheet{cheatSheets.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Generator Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="md:col-span-3 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
          >
            <option value="general">General Exam</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={focusTopics}
            onChange={(e) => setFocusTopics(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !generating) void handleGenerate();
            }}
            placeholder="Chapters or exam topics (e.g., Thermodynamics Laws, Carnot Cycle, Entropy, PV Diagrams)"
            className="md:col-span-6 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
          />

          <div className="md:col-span-3 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setLayoutColumns(2)}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-medium ${
                layoutColumns === 2
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              2-Col
            </button>
            <button
              type="button"
              onClick={() => setLayoutColumns(3)}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border text-xs font-medium ${
                layoutColumns === 3
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              <Columns3 className="w-3.5 h-3.5" />
              3-Col
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium whitespace-nowrap"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Build One-Page Cheat Sheet
          </button>
          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          {notice && <p className="text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>}
        </div>
      </div>

      {/* Main Split: Library + Sheet Canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Saved List */}
        <div className="lg:col-span-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 space-y-2.5 print:hidden">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 px-1">
            Saved Sheets
          </h2>
          {cheatSheets.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-6 text-center">
              Generate your first exam crib sheet above.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
              {cheatSheets.map((sheet) => {
                const active = activeSheet?.id === sheet.id;
                const subjName = subjects.find((s) => s.id === sheet.subjectId)?.name || 'General';
                return (
                  <div
                    key={sheet.id}
                    className={`rounded-xl border p-3 transition-colors ${
                      active
                        ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/30'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedId(sheet.id);
                          setIsEditing(false);
                        }}
                        className="text-left flex-1 min-w-0"
                      >
                        <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {sheet.title}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                          {subjName} · {sheet.sections.length} blocks · {sheet.layoutColumns}-col
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteCheatSheet(sheet.id)}
                        className="p-1 text-slate-400 hover:text-rose-600"
                        aria-label="Delete cheat sheet"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Active Sheet Viewport */}
        <div className="lg:col-span-9 print:col-span-12">
          {!activeSheet ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-12 text-center text-sm text-slate-500 dark:text-slate-400">
              Select or generate a cheat sheet to preview, edit, export, or print.
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5 print:border-0 print:p-0 print:bg-white">
              {/* Sheet Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-4">
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-display text-lg font-bold text-slate-900 dark:text-white"
                    />
                  ) : (
                    <>
                      <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white print:text-black">
                        {activeSheet.title}
                      </h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums print:text-slate-600">
                        {subjects.find((s) => s.id === activeSheet.subjectId)?.name || 'General Exam'} ·{' '}
                        {activeSheet.sections.length} condensed blocks · {renderedColumns}-column print grid
                      </p>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 print:hidden">
                  <button
                    type="button"
                    onClick={() => void handleToggleColumns(renderedColumns === 2 ? 3 : 2)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    {renderedColumns === 2 ? <Columns3 className="w-3.5 h-3.5" /> : <Columns2 className="w-3.5 h-3.5" />}
                    Switch to {renderedColumns === 2 ? '3-Col' : '2-Col'}
                  </button>

                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={handleAddBlankSection}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add Block
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSaveEdits()}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
                      >
                        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsEditing(false)}
                        className="px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setDraftTitle(activeSheet.title);
                          setDraftColumns(activeSheet.layoutColumns === 3 ? 3 : 2);
                          setDraftSections(activeSheet.sections);
                          setIsEditing(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={handleExportMarkdown}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Markdown
                      </button>
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-700 text-white text-xs font-medium"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        Print PDF
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Dense Crib-Sheet Multi-Column Grid */}
              <div
                className={`grid gap-4 ${
                  renderedColumns === 3
                    ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3 print:grid-cols-3'
                    : 'grid-cols-1 md:grid-cols-2 print:grid-cols-2'
                }`}
              >
                {renderedSections.map((sec) => (
                  <div
                    key={sec.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 p-4 space-y-3 break-inside-avoid print:bg-white print:border-slate-300"
                  >
                    {isEditing ? (
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={sec.heading}
                            onChange={(e) => handleUpdateSectionField(sec.id, 'heading', e.target.value)}
                            className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveSection(sec.id)}
                            className="p-1 text-slate-400 hover:text-rose-600"
                            aria-label="Remove block"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Key Points (1 per line)</label>
                          <textarea
                            rows={3}
                            value={sec.keyPoints.join('\n')}
                            onChange={(e) => handleUpdateSectionField(sec.id, 'keyPoints', e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Formulas (1 per line)</label>
                          <textarea
                            rows={2}
                            value={sec.formulas.join('\n')}
                            onChange={(e) => handleUpdateSectionField(sec.id, 'formulas', e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs text-slate-900 dark:text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Mnemonics (1 per line)</label>
                          <textarea
                            rows={2}
                            value={sec.mnemonics.join('\n')}
                            onChange={(e) => handleUpdateSectionField(sec.id, 'mnemonics', e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] text-slate-500 mb-1">Exam Pitfalls (1 per line)</label>
                          <textarea
                            rows={2}
                            value={sec.pitfalls.join('\n')}
                            onChange={(e) => handleUpdateSectionField(sec.id, 'pitfalls', e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3 className="font-display text-sm font-bold text-slate-900 dark:text-white border-b border-slate-200 dark:border-slate-700 pb-1.5 print:text-black">
                          {sec.heading}
                        </h3>

                        {sec.keyPoints.length > 0 && (
                          <ul className="space-y-1 text-xs leading-relaxed text-slate-700 dark:text-slate-200 print:text-slate-800">
                            {sec.keyPoints.map((pt, i) => (
                              <li key={i}>• {pt}</li>
                            ))}
                          </ul>
                        )}

                        {sec.formulas.length > 0 && (
                          <div className="space-y-1 pt-1">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                              Formulas
                            </p>
                            <div className="space-y-1">
                              {sec.formulas.map((f, i) => (
                                <p
                                  key={i}
                                  className="font-mono text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1 text-slate-900 dark:text-slate-100"
                                >
                                  {f}
                                </p>
                              ))}
                            </div>
                          </div>
                        )}

                        {sec.mnemonics.length > 0 && (
                          <div className="space-y-1 pt-1">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                              Memory Hooks
                            </p>
                            <ul className="space-y-0.5 text-xs text-slate-700 dark:text-slate-300">
                              {sec.mnemonics.map((m, i) => (
                                <li key={i}>→ {m}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {sec.pitfalls.length > 0 && (
                          <div className="space-y-1 pt-1">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                              Common Traps
                            </p>
                            <ul className="space-y-0.5 text-xs text-slate-700 dark:text-slate-300">
                              {sec.pitfalls.map((p, i) => (
                                <li key={i}>! {p}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
