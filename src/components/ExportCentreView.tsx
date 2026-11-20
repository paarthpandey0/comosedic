import { Download, FileText, Layers, Network, Calendar, BarChart3, Printer } from 'lucide-react';
import type {
  AcademicMemory,
  Flashcard,
  MindMap,
  Quiz,
  StudyNote,
  StudyPlanTask,
  Subject,
} from '../types';

interface ExportCentreViewProps {
  subjects: Subject[];
  notes: StudyNote[];
  flashcards: Flashcard[];
  quizzes: Quiz[];
  mindMaps: MindMap[];
  tasks: StudyPlanTask[];
  academicMemory: AcademicMemory | null;
}

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportCentreView({
  subjects,
  notes,
  flashcards,
  quizzes,
  mindMaps,
  tasks,
  academicMemory,
}: ExportCentreViewProps) {
  const subjectName = (id: string) => subjects.find((s) => s.id === id)?.name || 'General';

  const exportNotesMarkdown = () => {
    const md = notes
      .map((n) => `# ${n.title}\nSubject: ${subjectName(n.subjectId)} · Style: ${n.style}\n\n${n.content}\n`)
      .join('\n---\n\n');
    downloadBlob('lumina-revision-notes.md', md || '# No study notes available', 'text/markdown');
  };

  const exportFlashcardsCsv = () => {
    const rows = ['Subject,Topic,Front,Back,Hint'];
    flashcards.forEach((c) => {
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      rows.push([esc(subjectName(c.subjectId)), esc(c.topic), esc(c.front), esc(c.back), esc(c.hint)].join(','));
    });
    downloadBlob('lumina-flashcards.csv', rows.join('\n'), 'text/csv');
  };

  const exportFlashcardsAnki = () => {
    const lines = flashcards.map(
      (c) => `${c.front.replace(/\t|\n/g, ' ')}\t${c.back.replace(/\t|\n/g, ' ')}\t${c.topic.replace(/\s+/g, '_')}`
    );
    downloadBlob('lumina-anki-deck.tsv', lines.join('\n'), 'text/tab-separated-values');
  };

  const exportMockExamsMarkdown = () => {
    const md = quizzes
      .map((q) => {
        const qs = q.questions
          .map(
            (item, idx) =>
              `### Q${idx + 1} (${item.points} pts · ${item.topic})\n${item.prompt}\n${
                item.options.length ? item.options.map((o) => `- ${o}`).join('\n') + '\n' : ''
              }\n**Answer Key:** ${item.correctAnswer}\n*Explanation:* ${item.explanation}`
          )
          .join('\n\n');
        return `# ${q.title}\nSubject: ${subjectName(q.subjectId)} · Score: ${q.score}/${q.maxScore}\n\n${qs}`;
      })
      .join('\n\n===\n\n');
    downloadBlob('lumina-mock-exams-answer-keys.md', md || '# No exams available', 'text/markdown');
  };

  const exportTimetableIcs = () => {
    const events = tasks.map((t) => {
      const dateCompact = t.scheduledDate.replace(/-/g, '');
      const [hh, mm] = (t.startTime || '09:00').split(':');
      const start = `${dateCompact}T${(hh || '09').padStart(2, '0')}${(mm || '00').padStart(2, '0')}00`;
      return [
        'BEGIN:VEVENT',
        `UID:${t.id}@luminastudy.app`,
        `DTSTART:${start}`,
        `SUMMARY:${t.title} (${subjectName(t.subjectId)})`,
        `DESCRIPTION:Topic: ${t.topic} · Duration: ${t.durationMinutes} min`,
        'END:VEVENT',
      ].join('\r\n');
    });
    const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lumina Study//EN', ...events, 'END:VCALENDAR'].join('\r\n');
    downloadBlob('lumina-study-timetable.ics', ics, 'text/calendar');
  };

  const exportMindMapsMd = () => {
    const md = mindMaps
      .map(
        (m) =>
          `# ${m.title}\n\n` +
          m.nodes.map((n) => `${'  '.repeat(n.level)}- **${n.label}** (${n.category}): ${n.definition}`).join('\n')
      )
      .join('\n\n---\n\n');
    downloadBlob('lumina-mindmaps.md', md || '# No mind maps available', 'text/markdown');
  };

  const exportProgressReport = () => {
    const report =
      academicMemory?.weeklyReport ||
      `# Lumina Progress Summary\n\n- Subjects: ${subjects.length}\n- Notes: ${notes.length}\n- Flashcards: ${flashcards.length}\n- Completed Assessments: ${quizzes.filter((q) => q.status === 'completed').length}\n- Struggling Topics: ${(academicMemory?.strugglingTopics || []).join(', ') || 'None recorded'}`;
    downloadBlob('lumina-progress-report.md', report, 'text/markdown');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Study Material Export Centre
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Download formatted revision packs, Anki/CSV flashcard decks, mock exams with answer sheets, mind maps, and calendar timetables.
          </p>
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
        >
          <Printer className="w-3.5 h-3.5" />
          Print / Save PDF
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Revision Notes Bundle
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {notes.length} AI and personal notes formatted in clean Markdown.
            </p>
          </div>
          <button
            type="button"
            onClick={exportNotesMarkdown}
            disabled={notes.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Export Markdown (.md)
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <Layers className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Flashcards (CSV & Anki)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {flashcards.length} spaced-repetition cards ready for spreadsheet or Anki import.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={exportFlashcardsCsv}
              disabled={flashcards.length === 0}
              className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-50"
            >
              CSV
            </button>
            <button
              type="button"
              onClick={exportFlashcardsAnki}
              disabled={flashcards.length === 0}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 disabled:opacity-50"
            >
              Anki TSV
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <FileText className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Mock Exams + Answer Keys
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {quizzes.length} generated quizzes & exams with full marking keys.
            </p>
          </div>
          <button
            type="button"
            onClick={exportMockExamsMarkdown}
            disabled={quizzes.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Export Exam Pack (.md)
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <Calendar className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Study Timetable (.ics)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {tasks.length} scheduled study tasks exportable to Google/Apple Calendar.
            </p>
          </div>
          <button
            type="button"
            onClick={exportTimetableIcs}
            disabled={tasks.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Export Calendar (.ics)
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <Network className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Mind Maps Outline
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {mindMaps.length} hierarchical mind maps with definitions.
            </p>
          </div>
          <button
            type="button"
            onClick={exportMindMapsMd}
            disabled={mindMaps.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" />
            Export Outlines (.md)
          </button>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <BarChart3 className="w-5 h-5 text-rose-600 dark:text-rose-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Academic Progress Report
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Weekly AI Learning Report, knowledge gaps, and study metrics.
            </p>
          </div>
          <button
            type="button"
            onClick={exportProgressReport}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
          >
            <Download className="w-3.5 h-3.5" />
            Export Report (.md)
          </button>
        </div>
      </div>
    </div>
  );
}
