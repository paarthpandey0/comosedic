import { useEffect, useState } from 'react';
import { Bell, BrainCircuit, Plus, Redo2, Save, Trash2, Undo2 } from 'lucide-react';
import type { AcademicMemory, ComplexityPreference, NotificationPrefs } from '../types';
import { DEFAULT_NOTIFICATION_PREFS, updateAcademicMemory } from '../services/studyDb';

interface AcademicMemoryViewProps {
  uid: string;
  memory: AcademicMemory | null;
}

interface MemoryDraft {
  completedTopics: string[];
  strugglingTopics: string[];
  recurringMistakes: string[];
  preferredComplexity: ComplexityPreference;
  learningNotes: string;
  notificationPrefs: NotificationPrefs;
}

export function AcademicMemoryView({ uid, memory }: AcademicMemoryViewProps) {
  const buildDraft = (m: AcademicMemory | null): MemoryDraft => ({
    completedTopics: m?.completedTopics || [],
    strugglingTopics: m?.strugglingTopics || [],
    recurringMistakes: m?.recurringMistakes || [],
    preferredComplexity: m?.preferredComplexity || 'balanced',
    learningNotes: m?.learningNotes || '',
    notificationPrefs: m?.notificationPrefs || DEFAULT_NOTIFICATION_PREFS,
  });

  const [draft, setDraft] = useState<MemoryDraft>(() => buildDraft(memory));
  const [undoStack, setUndoStack] = useState<MemoryDraft[]>([]);
  const [redoStack, setRedoStack] = useState<MemoryDraft[]>([]);
  const [newCompleted, setNewCompleted] = useState('');
  const [newStruggling, setNewStruggling] = useState('');
  const [newMistake, setNewMistake] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (memory && undoStack.length === 0) {
      setDraft(buildDraft(memory));
    }
  }, [memory]);

  const commitChange = (updater: (prev: MemoryDraft) => MemoryDraft) => {
    setUndoStack((u) => [...u.slice(-14), draft]);
    setRedoStack([]);
    setDraft(updater);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, draft]);
    setUndoStack((u) => u.slice(0, -1));
    setDraft(prev);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, draft]);
    setRedoStack((r) => r.slice(0, -1));
    setDraft(next);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateAcademicMemory(uid, draft);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Personal Academic Memory & Notifications
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Inspect and edit the structured learning profile Gemini uses across tutoring, quizzes, and revision paths.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium disabled:opacity-40"
          >
            <Undo2 className="w-3.5 h-3.5" />
            Undo
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium disabled:opacity-40"
          >
            <Redo2 className="w-3.5 h-3.5" />
            Redo
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </div>

      {savedNotice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          Academic Memory and notification preferences saved.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Completed Topics */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-emerald-600" />
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Mastered / Completed Topics ({draft.completedTopics.length})
            </h2>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newCompleted}
              onChange={(e) => setNewCompleted(e.target.value)}
              placeholder="Add mastered topic..."
              className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                if (!newCompleted.trim()) return;
                commitChange((p) => ({
                  ...p,
                  completedTopics: Array.from(new Set([...p.completedTopics, newCompleted.trim()])),
                }));
                setNewCompleted('');
              }}
              className="p-2 rounded-xl bg-indigo-600 text-white"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {draft.completedTopics.map((t, idx) => (
              <div key={idx} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 text-xs">
                <span>{t}</span>
                <button
                  type="button"
                  onClick={() =>
                    commitChange((p) => ({
                      ...p,
                      completedTopics: p.completedTopics.filter((_, i) => i !== idx),
                    }))
                  }
                  className="text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Struggling Topics */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-amber-600" />
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Struggling Topics & Knowledge Gaps ({draft.strugglingTopics.length})
            </h2>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={newStruggling}
              onChange={(e) => setNewStruggling(e.target.value)}
              placeholder="Add topic needing extra focus..."
              className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                if (!newStruggling.trim()) return;
                commitChange((p) => ({
                  ...p,
                  strugglingTopics: Array.from(new Set([...p.strugglingTopics, newStruggling.trim()])),
                }));
                setNewStruggling('');
              }}
              className="p-2 rounded-xl bg-indigo-600 text-white"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {draft.strugglingTopics.map((t, idx) => (
              <div key={idx} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 text-xs">
                <span>{t}</span>
                <button
                  type="button"
                  onClick={() =>
                    commitChange((p) => ({
                      ...p,
                      strugglingTopics: p.strugglingTopics.filter((_, i) => i !== idx),
                    }))
                  }
                  className="text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Complexity, Recurring Mistakes & Personal Learning Notes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
            Explanation Complexity & Recurring Mistakes
          </h2>
          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Preferred AI Explanation Level</label>
            <div className="grid grid-cols-3 gap-2">
              {(['foundation', 'balanced', 'rigorous'] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => commitChange((p) => ({ ...p, preferredComplexity: level }))}
                  className={`px-3 py-2 rounded-xl border text-xs font-medium capitalize ${
                    draft.preferredComplexity === level
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-xs text-slate-500">Recurring Mistakes Pattern Log</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newMistake}
                onChange={(e) => setNewMistake(e.target.value)}
                placeholder="e.g., Sign error during integration by parts..."
                className="flex-1 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newMistake.trim()) return;
                  commitChange((p) => ({
                    ...p,
                    recurringMistakes: [...p.recurringMistakes, newMistake.trim()],
                  }));
                  setNewMistake('');
                }}
                className="p-2 rounded-xl bg-indigo-600 text-white"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {draft.recurringMistakes.map((m, idx) => (
                <div key={idx} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 text-xs">
                  <span>{m}</span>
                  <button
                    type="button"
                    onClick={() =>
                      commitChange((p) => ({
                        ...p,
                        recurringMistakes: p.recurringMistakes.filter((_, i) => i !== idx),
                      }))
                    }
                    className="text-slate-400 hover:text-rose-600"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Smart Revision Notification Preferences */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Smart Revision Notifications
            </h2>
          </div>

          <div className="space-y-2.5 text-xs">
            {[
              { key: 'examReminders' as const, label: 'Upcoming Exam Countdown Alerts (<= 14 days)' },
              { key: 'flashcardDueAlerts' as const, label: 'Spaced Repetition Flashcards Due Reminders' },
              { key: 'unfinishedSessionAlerts' as const, label: 'Unfinished Today Study Task Alerts' },
              { key: 'weeklySummaryAlerts' as const, label: 'Weekly AI Learning Report Reminders' },
            ].map((item) => (
              <label key={item.key} className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-slate-100 dark:border-slate-800 cursor-pointer">
                <span className="text-slate-700 dark:text-slate-200 font-medium">{item.label}</span>
                <input
                  type="checkbox"
                  checked={draft.notificationPrefs[item.key]}
                  onChange={(e) =>
                    commitChange((p) => ({
                      ...p,
                      notificationPrefs: { ...p.notificationPrefs, [item.key]: e.target.checked },
                    }))
                  }
                  className="rounded border-slate-300 text-indigo-600"
                />
              </label>
            ))}

            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-500">Preferred Daily Study Digest Time</span>
              <input
                type="time"
                value={draft.notificationPrefs.dailyDigestTime}
                onChange={(e) =>
                  commitChange((p) => ({
                    ...p,
                    notificationPrefs: { ...p.notificationPrefs, dailyDigestTime: e.target.value },
                  }))
                }
                className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-500 mb-1">Personal Learning Style Notes for Gemini</label>
            <textarea
              rows={3}
              value={draft.learningNotes}
              onChange={(e) => commitChange((p) => ({ ...p, learningNotes: e.target.value }))}
              placeholder="e.g., I learn best with visual analogies first, then worked quantitative examples..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
