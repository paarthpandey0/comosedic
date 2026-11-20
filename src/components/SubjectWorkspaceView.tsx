import { useState } from 'react';
import {
  BookOpen,
  Calendar,
  Edit2,
  FileText,
  Folder,
  HelpCircle,
  Layers,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import type {
  AcademicMemory,
  Flashcard,
  InteractiveModule,
  Quiz,
  StudyNote,
  StudyResource,
  Subject,
  TutorMessage,
  UserProfile,
  WorkspaceTab,
} from '../types';
import { deleteSubject } from '../services/studyDb';
import { ResourcesPanel } from './workspace/ResourcesPanel';
import { NotesPanel } from './workspace/NotesPanel';
import { FlashcardsPanel } from './workspace/FlashcardsPanel';
import { QuizPanel } from './workspace/QuizPanel';
import { TutorPanel } from './workspace/TutorPanel';
import { InteractiveLearningPanel } from './workspace/InteractiveLearningPanel';
import { SubjectLabPanel } from './workspace/SubjectLabPanel';

interface SubjectWorkspaceViewProps {
  uid: string;
  profile: UserProfile | null;
  subject: Subject;
  activeTab: WorkspaceTab;
  onChangeTab: (tab: WorkspaceTab) => void;
  resources: StudyResource[];
  notes: StudyNote[];
  flashcards: Flashcard[];
  quizzes: Quiz[];
  tutorMessages: TutorMessage[];
  interactiveModules: InteractiveModule[];
  academicMemory: AcademicMemory | null;
  onEditSubject: (subject: Subject) => void;
  onSubjectDeleted: () => void;
}

const TABS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'resources', label: 'Resources' },
  { id: 'notes', label: 'AI Notes' },
  { id: 'flashcards', label: 'Flashcards' },
  { id: 'quizzes', label: 'Quizzes & Exams' },
  { id: 'interactive', label: 'Interactive Mode' },
  { id: 'subject_lab', label: 'Subject Lab' },
  { id: 'past_papers', label: 'Past Papers' },
  { id: 'tutor', label: 'AI Tutor' },
];

export function SubjectWorkspaceView({
  uid,
  profile,
  subject,
  activeTab,
  onChangeTab,
  resources,
  notes,
  flashcards,
  quizzes,
  tutorMessages,
  interactiveModules,
  academicMemory,
  onEditSubject,
  onSubjectDeleted,
}: SubjectWorkspaceViewProps) {
  const [preselectedResourceId, setPreselectedResourceId] = useState<string | undefined>(undefined);
  const [tutorPendingPrompt, setTutorPendingPrompt] = useState<string | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const subjResources = resources.filter((r) => r.subjectId === subject.id);
  const subjNotes = notes.filter((n) => n.subjectId === subject.id);
  const subjCards = flashcards.filter((c) => c.subjectId === subject.id);
  const subjQuizzes = quizzes.filter((q) => q.subjectId === subject.id);

  const completedQuizzes = subjQuizzes.filter((q) => q.status === 'completed');
  const avgQuizScore = completedQuizzes.length
    ? Math.round(
        completedQuizzes.reduce((acc, q) => acc + (q.score / Math.max(1, q.maxScore)) * 100, 0) /
          completedQuizzes.length
      )
    : null;

  const allWeakTopics = Array.from(
    new Set(completedQuizzes.flatMap((q) => q.weakTopics))
  );

  const handleDelete = async () => {
    await deleteSubject(subject.id);
    onSubjectDeleted();
  };

  return (
    <div className="space-y-6">
      {/* Subject Header */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
              <span className="inline-flex items-center gap-1">
                <Folder className="w-3.5 h-3.5" />
                {subject.folder || 'General'}
              </span>
              {subject.code && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{subject.code}</span>
                </>
              )}
              {subject.examDate && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    Exam {subject.examDate}
                  </span>
                </>
              )}
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {subject.name}
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onEditSubject(subject)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Edit Subject
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-medium hover:bg-rose-700"
                >
                  Confirm Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="p-2 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400"
                aria-label="Delete subject"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Workspace Navigation Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-slate-100 dark:border-slate-800">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChangeTab(t.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === t.id
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <button
              type="button"
              onClick={() => onChangeTab('resources')}
              className="text-left rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
            >
              <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400 mb-2" />
              <p className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                {subjResources.length}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Uploaded Resources</p>
            </button>

            <button
              type="button"
              onClick={() => onChangeTab('notes')}
              className="text-left rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
            >
              <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400 mb-2" />
              <p className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                {subjNotes.length}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Study Notes</p>
            </button>

            <button
              type="button"
              onClick={() => onChangeTab('flashcards')}
              className="text-left rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
            >
              <Layers className="w-4 h-4 text-violet-600 dark:text-violet-400 mb-2" />
              <p className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                {subjCards.length}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Smart Flashcards</p>
            </button>

            <button
              type="button"
              onClick={() => onChangeTab('quizzes')}
              className="text-left rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
            >
              <HelpCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mb-2" />
              <p className="font-display text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
                {avgQuizScore !== null ? `${avgQuizScore}%` : '—'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Quiz Accuracy ({completedQuizzes.length} taken)
              </p>
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-3">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Syllabus & Knowledge Gaps
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Confidence: {subject.confidence}/5 · Target: {subject.targetHoursPerWeek}h/week
              </p>
              {subject.topics.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Syllabus Topics</p>
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {subject.topics.join(' · ')}
                  </p>
                </div>
              )}
              {allWeakTopics.length > 0 && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1">
                    Identified Knowledge Gaps
                  </p>
                  <p className="text-sm text-slate-700 dark:text-slate-300">{allWeakTopics.join(' · ')}</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-3">
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Quick Actions
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => onChangeTab('resources')}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-left text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Upload PDF / Slides / Notes
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTab('notes')}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-left text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Synthesize AI Study Notes
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTab('quizzes')}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-left text-sm font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Take Adaptive Practice Exam
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTab('tutor')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium"
                >
                  <MessageSquare className="w-4 h-4" />
                  Open Subject AI Tutor
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'resources' && (
        <ResourcesPanel
          uid={uid}
          subject={subject}
          resources={resources}
          academicMemory={academicMemory}
          onGenerateNotesFromResource={(res) => {
            setPreselectedResourceId(res.id);
            onChangeTab('notes');
          }}
          onGenerateFlashcardsFromResource={(res) => {
            setPreselectedResourceId(res.id);
            onChangeTab('flashcards');
          }}
        />
      )}

      {activeTab === 'past_papers' && (
        <ResourcesPanel
          uid={uid}
          subject={subject}
          resources={resources}
          academicMemory={academicMemory}
          pastPapersOnly
          onGenerateNotesFromResource={(res) => {
            setPreselectedResourceId(res.id);
            onChangeTab('notes');
          }}
          onGenerateFlashcardsFromResource={(res) => {
            setPreselectedResourceId(res.id);
            onChangeTab('flashcards');
          }}
        />
      )}

      {activeTab === 'notes' && (
        <NotesPanel
          uid={uid}
          subject={subject}
          resources={resources}
          notes={notes}
          preselectedResourceId={preselectedResourceId}
        />
      )}

      {activeTab === 'flashcards' && (
        <FlashcardsPanel
          uid={uid}
          profile={profile}
          subject={subject}
          resources={resources}
          flashcards={flashcards}
          quizzes={quizzes}
          preselectedResourceId={preselectedResourceId}
        />
      )}

      {activeTab === 'quizzes' && (
        <QuizPanel
          uid={uid}
          profile={profile}
          academicMemory={academicMemory}
          subject={subject}
          resources={resources}
          quizzes={quizzes}
          onAskTutorAboutMistake={(prompt) => {
            setTutorPendingPrompt(prompt);
            onChangeTab('tutor');
          }}
        />
      )}

      {activeTab === 'interactive' && (
        <InteractiveLearningPanel
          uid={uid}
          subject={subject}
          resources={resources}
          modules={interactiveModules}
        />
      )}

      {activeTab === 'subject_lab' && <SubjectLabPanel subject={subject} />}

      {activeTab === 'tutor' && (
        <TutorPanel
          uid={uid}
          subject={subject}
          resources={resources}
          quizzes={quizzes}
          messages={tutorMessages}
          academicMemory={academicMemory}
          preferredComplexity={academicMemory?.preferredComplexity}
          initialPrompt={tutorPendingPrompt}
          onInitialPromptConsumed={() => setTutorPendingPrompt(undefined)}
        />
      )}
    </div>
  );
}
