import { useMemo, useState } from 'react';
import { Clock, FileText, History, Loader2, Sparkles } from 'lucide-react';
import type { LessonSession, StudyNote, Subject, TutorMessage } from '../types';
import { summarizeStudySession } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';

interface SessionReplayViewProps {
  subjects: Subject[];
  lessonSessions: LessonSession[];
  tutorMessages: TutorMessage[];
  notes: StudyNote[];
}

export function SessionReplayView({
  subjects,
  lessonSessions,
  tutorMessages,
  notes,
}: SessionReplayViewProps) {
  const [selectedId, setSelectedId] = useState<string>(lessonSessions[0]?.id || '');
  const [summaryCache, setSummaryCache] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const selectedLesson = useMemo(
    () => lessonSessions.find((l) => l.id === selectedId) || lessonSessions[0] || null,
    [lessonSessions, selectedId]
  );

  // Also group tutor Q&A history per subject for replay
  const subjectTutorThreads = useMemo(() => {
    return subjects.map((s) => ({
      subject: s,
      messages: tutorMessages.filter((m) => m.subjectId === s.id),
      notes: notes.filter((n) => n.subjectId === s.id),
    })).filter((g) => g.messages.length > 0 || g.notes.length > 0);
  }, [subjects, tutorMessages, notes]);

  const handleSummarizeLesson = async (lesson: LessonSession) => {
    setLoading(true);
    try {
      const subjectName = subjects.find((s) => s.id === lesson.subjectId)?.name || 'General Study';
      const res = await summarizeStudySession({
        topic: lesson.topic,
        subjectName,
        transcript: lesson.transcript || [],
        notesContent: lesson.notesContent || '',
      });
      setSummaryCache((prev) => ({ ...prev, [lesson.id]: res.summary }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
          <History className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          Study Session Replay
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Revisit completed AI Teacher lessons, questions asked during sessions, created notes, and Gemini recaps.
        </p>
      </div>

      {lessonSessions.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-8 text-center text-sm text-slate-500">
          Complete or pause an AI Teacher lesson to inspect full classroom session replays here.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Lesson Recordings</p>
            {lessonSessions.map((l) => {
              const subj = subjects.find((s) => s.id === l.subjectId)?.name || 'General Study';
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setSelectedId(l.id)}
                  className={`w-full text-left rounded-xl border p-3.5 transition-colors ${
                    selectedLesson?.id === l.id
                      ? 'border-indigo-600 bg-indigo-50/70 dark:bg-indigo-950/30'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C]'
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{l.topic}</p>
                  <p className="text-xs text-slate-500 mt-1 flex items-center gap-2 tabular-nums">
                    <span>{subj}</span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {l.durationMinutes}m
                    </span>
                    <span>·</span>
                    <span>Score: {l.score}%</span>
                  </p>
                </button>
              );
            })}
          </div>

          {selectedLesson && (
            <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">{selectedLesson.topic}</h2>
                  <p className="text-xs text-slate-500">
                    Status: {selectedLesson.status} · Score: {selectedLesson.score}% · Duration: {selectedLesson.durationMinutes} min
                  </p>
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void handleSummarizeLesson(selectedLesson)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-medium"
                >
                  {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Gemini Concise Recap
                </button>
              </div>

              {summaryCache[selectedLesson.id] && (
                <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-950/20 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-2">AI Replay Summary</p>
                  <MarkdownView content={summaryCache[selectedLesson.id]} />
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Questions &amp; Classroom Transcript</p>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {(selectedLesson.transcript || []).map((entry, idx) => (
                    <div key={idx} className="rounded-xl bg-slate-50 dark:bg-slate-900/60 p-3 text-xs">
                      <span className="font-semibold uppercase text-[10px] text-indigo-600 block mb-1">
                        {entry.role}
                      </span>
                      <MarkdownView content={entry.text} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5" />
                  Saved Lesson Notes
                </p>
                <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 max-h-64 overflow-y-auto">
                  <MarkdownView content={selectedLesson.notesContent} />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {subjectTutorThreads.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Subject Tutor Archives</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {subjectTutorThreads.map((g) => (
              <div key={g.subject.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{g.subject.name}</p>
                <p className="text-xs text-slate-500 mt-1 tabular-nums">
                  {g.messages.length} tutor messages · {g.notes.length} notes saved
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
