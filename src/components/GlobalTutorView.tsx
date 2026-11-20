import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { AcademicMemory, ComplexityPreference, Quiz, StudyResource, Subject, TutorMessage } from '../types';
import { TutorPanel } from './workspace/TutorPanel';

interface GlobalTutorViewProps {
  uid: string;
  subjects: Subject[];
  resources: StudyResource[];
  quizzes: Quiz[];
  messages: TutorMessage[];
  academicMemory?: AcademicMemory | null;
  preferredComplexity?: ComplexityPreference;
  initialSubjectId?: string;
  initialPrompt?: string;
  onInitialPromptConsumed?: () => void;
  onCreateSubject: () => void;
}

export function GlobalTutorView({
  uid,
  subjects,
  resources,
  quizzes,
  messages,
  academicMemory,
  preferredComplexity,
  initialSubjectId,
  initialPrompt,
  onInitialPromptConsumed,
  onCreateSubject,
}: GlobalTutorViewProps) {
  const [selectedSubjectId, setSelectedSubjectId] = useState(initialSubjectId || subjects[0]?.id || '');
  const activeSubject = subjects.find((s) => s.id === selectedSubjectId) || subjects[0] || null;

  if (!activeSubject) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-12 text-center space-y-4">
        <h2 className="font-display text-xl font-semibold text-slate-900 dark:text-white">
          Create a subject to start tutoring
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          Your Personal AI Tutor keeps dedicated conversational memory and references uploaded documents inside each subject.
        </p>
        <button
          type="button"
          onClick={onCreateSubject}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
        >
          <Plus className="w-4 h-4" />
          New Subject
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Personal AI Tutor
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Switch between subject threads — Gemini remembers your history and cites uploaded notes
          </p>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {subjects.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedSubjectId(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeSubject.id === s.id
                  ? 'bg-slate-900 dark:bg-indigo-600 text-white'
                  : 'bg-white dark:bg-[#1A202C] border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      <TutorPanel
        uid={uid}
        subject={activeSubject}
        resources={resources}
        quizzes={quizzes}
        messages={messages}
        academicMemory={academicMemory}
        preferredComplexity={preferredComplexity}
        initialPrompt={initialPrompt}
        onInitialPromptConsumed={onInitialPromptConsumed}
      />
    </div>
  );
}
