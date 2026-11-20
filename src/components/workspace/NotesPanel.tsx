import React, { useEffect, useState } from 'react';
import { Bookmark, Download, Edit3, Eye, Loader2, Plus, Trash2 } from 'lucide-react';
import type { NoteStyle, StudyNote, StudyResource, Subject } from '../../types';
import {
  createNote,
  deleteNote,
  toggleNoteBookmark,
  updateNoteContent,
} from '../../services/studyDb';
import { generateStudyNotes } from '../../services/geminiApi';
import { MarkdownView } from '../MarkdownView';

interface NotesPanelProps {
  uid: string;
  subject: Subject;
  resources: StudyResource[];
  notes: StudyNote[];
  preselectedResourceId?: string;
}

const STYLE_LABELS: Record<NoteStyle, string> = {
  quick: 'Quick Revision',
  detailed: 'Detailed Notes',
  exam: 'Exam-Focused',
  personal: 'Personal Note',
};

export function NotesPanel({
  uid,
  subject,
  resources,
  notes,
  preselectedResourceId,
}: NotesPanelProps) {
  const subjectResources = resources.filter((r) => r.subjectId === subject.id);
  const subjectNotes = notes.filter((n) => n.subjectId === subject.id);

  const [selectedResourceId, setSelectedResourceId] = useState(
    preselectedResourceId || subjectResources[0]?.id || ''
  );
  const [noteStyle, setNoteStyle] = useState<Exclude<NoteStyle, 'personal'>>('detailed');
  const [customFocus, setCustomFocus] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeNoteId, setActiveNoteId] = useState<string | null>(subjectNotes[0]?.id || null);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (preselectedResourceId) {
      setSelectedResourceId(preselectedResourceId);
    }
  }, [preselectedResourceId]);

  const activeNote = subjectNotes.find((n) => n.id === activeNoteId) || subjectNotes[0] || null;

  useEffect(() => {
    if (activeNote && !editing) {
      setDraftTitle(activeNote.title);
      setDraftContent(activeNote.content);
    }
  }, [activeNote, editing]);

  const handleGenerateNotes = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = subjectResources.find((r) => r.id === selectedResourceId) || subjectResources[0];
    if (!res) {
      setError('Upload at least one study resource first, or create a personal note.');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const result = await generateStudyNotes({
        subjectName: subject.name,
        resourceTitle: res.title,
        resourceContent: res.extractedText || res.summary,
        style: noteStyle,
        customFocus: customFocus.trim(),
      });
      const newId = await createNote(uid, {
        subjectId: subject.id,
        resourceId: res.id,
        title: result.title,
        style: noteStyle,
        content: result.content,
      });
      setActiveNoteId(newId);
      setEditing(false);
      setCustomFocus('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate notes.');
    } finally {
      setGenerating(false);
    }
  };

  const handleCreatePersonalNote = async () => {
    const id = await createNote(uid, {
      subjectId: subject.id,
      resourceId: '',
      title: `${subject.name} — Personal Note`,
      style: 'personal',
      content: '## Key Takeaways\n\nWrite your revision notes here...',
    });
    setActiveNoteId(id);
    setDraftTitle(`${subject.name} — Personal Note`);
    setDraftContent('## Key Takeaways\n\nWrite your revision notes here...');
    setEditing(true);
  };

  const handleSaveEdit = async () => {
    if (!activeNote) return;
    setSavingEdit(true);
    try {
      await updateNoteContent(activeNote.id, {
        title: draftTitle,
        content: draftContent,
        style: activeNote.style,
      });
      setEditing(false);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleExportMarkdown = (note: StudyNote) => {
    const blob = new Blob([`# ${note.title}\n\n${note.content}`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${note.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* AI Notes Generator Bar */}
      <form
        onSubmit={handleGenerateNotes}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              AI Notes Generator
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Synthesize uploaded documents into Quick Revision, Detailed Notes, or Exam-Focused sheets.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCreatePersonalNote}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            New Personal Note
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-2 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Source Resource
            </label>
            <select
              value={selectedResourceId || subjectResources[0]?.id || ''}
              onChange={(e) => setSelectedResourceId(e.target.value)}
              disabled={subjectResources.length === 0}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {subjectResources.length === 0 ? (
                <option value="">No resources uploaded yet</option>
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
              Note Style
            </label>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-900">
              {(['quick', 'detailed', 'exam'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setNoteStyle(s)}
                  className={`py-1.5 px-2 rounded-lg text-xs font-medium capitalize transition-colors ${
                    noteStyle === s
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Focus Instructions (optional)
            </label>
            <input
              type="text"
              value={customFocus}
              onChange={(e) => setCustomFocus(e.target.value)}
              placeholder="e.g. Emphasize formulas"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={generating || subjectResources.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium transition-colors"
            >
              {generating && <Loader2 className="w-4 h-4 animate-spin" />}
              {generating ? 'Synthesizing...' : 'Generate'}
            </button>
          </div>
        </div>
      </form>

      {/* Split Notes Browser + Reader/Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 space-y-2 max-h-[600px] overflow-y-auto">
          <h4 className="font-display text-xs font-semibold text-slate-500 dark:text-slate-400 px-2 pb-1">
            Saved Notes ({subjectNotes.length})
          </h4>
          {subjectNotes.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 px-2 py-6 text-center">
              No notes in this workspace yet.
            </p>
          ) : (
            subjectNotes.map((note) => (
              <button
                key={note.id}
                type="button"
                onClick={() => {
                  setActiveNoteId(note.id);
                  setEditing(false);
                }}
                className={`w-full text-left px-3 py-2.5 rounded-xl transition-colors ${
                  activeNote?.id === note.id
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200'
                }`}
              >
                <p className="text-sm font-medium truncate">{note.title}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {STYLE_LABELS[note.style]} {note.isBookmarked ? '· Bookmarked' : ''}
                </p>
              </button>
            ))
          )}
        </div>

        <div className="lg:col-span-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 min-h-[420px]">
          {!activeNote ? (
            <div className="h-full flex items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              Select a note or generate one from your uploaded materials.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {STYLE_LABELS[activeNote.style]} · {subject.name}
                  </p>
                  {editing ? (
                    <input
                      type="text"
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className="mt-1 px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-display text-lg font-semibold text-slate-900 dark:text-white w-full"
                    />
                  ) : (
                    <h3 className="font-display text-xl font-bold text-slate-900 dark:text-white mt-0.5">
                      {activeNote.title}
                    </h3>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleNoteBookmark(activeNote.id, !activeNote.isBookmarked)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                      activeNote.isBookmarked
                        ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Bookmark className={`w-3.5 h-3.5 ${activeNote.isBookmarked ? 'fill-current' : ''}`} />
                    {activeNote.isBookmarked ? 'Saved' : 'Bookmark'}
                  </button>

                  {editing ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditing(false)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveEdit}
                        disabled={savingEdit}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700"
                      >
                        {savingEdit ? 'Saving...' : 'Save Note'}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftTitle(activeNote.title);
                        setDraftContent(activeNote.content);
                        setEditing(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleExportMarkdown(activeNote)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Export
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteNote(activeNote.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                    aria-label="Delete note"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {editing ? (
                <textarea
                  rows={16}
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-xs text-slate-800 dark:text-slate-100 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              ) : (
                <MarkdownView content={activeNote.content} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
