export type ThemeMode = 'light' | 'dark';

export type SubjectColor = 'indigo' | 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'slate';

export type FileResourceType = 'pdf' | 'docx' | 'pptx' | 'image' | 'text' | 'csv';

export type NoteStyle = 'quick' | 'detailed' | 'exam' | 'personal';

export type CardDifficulty = 'easy' | 'medium' | 'hard';

export type QuizDifficulty = 'foundation' | 'standard' | 'advanced';

export type QuestionType = 'mcq' | 'tf' | 'short' | 'extended' | 'calculation' | 'application';

export type TutorMode = 'simple' | 'step_by_step' | 'example' | 'test_me' | 'explain_mistake' | 'general';

export type TaskPriority = 'high' | 'medium' | 'low';

export type TaskType = 'revision' | 'flashcards' | 'quiz' | 'reading';

export type TaskCategory = 'revision' | 'exam' | 'assignment' | 'homework';

export type ActivityType = 'focus' | 'flashcards' | 'quiz' | 'notes' | 'tutor' | 'lesson';

export type ComplexityPreference = 'foundation' | 'balanced' | 'rigorous';

export type PreferredModelMode = 'auto' | 'primary' | 'fast';

export type InteractiveActivityType = 'match' | 'fill_gaps' | 'equation_steps' | 'timeline' | 'diagram_label';

export type ExplanationStyle =
  | 'eli10'
  | 'school_level'
  | 'academic'
  | 'real_world'
  | 'visual'
  | 'analogy'
  | 'step_by_step'
  | 'exam_answer';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL: string;
  dailyGoalMinutes: number;
  streakDays: number;
  totalStudyMinutes: number;
  lastStudyDate: string;
  theme: ThemeMode;
  achievements: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Subject {
  id: string;
  ownerId: string;
  name: string;
  code: string;
  folder: string;
  color: SubjectColor;
  examDate: string;
  confidence: number;
  targetHoursPerWeek: number;
  topics: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudyResource {
  id: string;
  ownerId: string;
  subjectId: string;
  title: string;
  fileName: string;
  fileType: FileResourceType;
  fileSize: number;
  isPastPaper: boolean;
  extractedText: string;
  summary: string;
  keyConcepts: string[];
  definitions: string[];
  formulas: string[];
  detectedTopics?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudyNote {
  id: string;
  ownerId: string;
  subjectId: string;
  resourceId: string;
  title: string;
  style: NoteStyle;
  content: string;
  isBookmarked: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Flashcard {
  id: string;
  ownerId: string;
  subjectId: string;
  resourceId: string;
  front: string;
  back: string;
  hint: string;
  topic: string;
  difficulty: CardDifficulty;
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  nextReviewAt: string;
  timesReviewed: number;
  timesCorrect: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  topic: string;
  points: number;
}

export interface QuizQuestionResult {
  questionId: string;
  isCorrect: boolean;
  earnedPoints: number;
  maxPoints: number;
  feedback: string;
}

export interface Quiz {
  id: string;
  ownerId: string;
  subjectId: string;
  title: string;
  difficulty: QuizDifficulty;
  isTimed: boolean;
  durationMinutes: number;
  status: 'in_progress' | 'completed';
  questions: QuizQuestion[];
  answers: Record<string, string>;
  results: QuizQuestionResult[];
  score: number;
  maxScore: number;
  weakTopics: string[];
  aiSummary: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TutorMessage {
  id: string;
  ownerId: string;
  subjectId: string;
  role: 'user' | 'model';
  mode: TutorMode;
  content: string;
  isBookmarked: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudyPlanTask {
  id: string;
  ownerId: string;
  subjectId: string;
  title: string;
  topic: string;
  scheduledDate: string;
  startTime: string;
  durationMinutes: number;
  priority: TaskPriority;
  taskType: TaskType;
  category?: TaskCategory;
  completed: boolean;
  missed: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudySession {
  id: string;
  ownerId: string;
  subjectId: string;
  activityType: ActivityType;
  durationMinutes: number;
  date: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface NotificationPrefs {
  examReminders: boolean;
  flashcardDueAlerts: boolean;
  unfinishedSessionAlerts: boolean;
  weeklySummaryAlerts: boolean;
  dailyDigestTime: string;
}

export interface SavedExplanationItem {
  id: string;
  subjectId: string;
  topic: string;
  style: ExplanationStyle;
  contentMarkdown: string;
  keyTakeaway: string;
  createdAt: string;
}

export interface DailyHabitItem {
  id: string;
  label: string;
  targetPerWeek: number;
  completedDates: string[];
}

export interface AcademicMemory {
  uid: string;
  completedTopics: string[];
  strugglingTopics: string[];
  preferredComplexity: ComplexityPreference;
  learningNotes: string;
  recurringMistakes: string[];
  weeklyReport: string;
  notificationPrefs: NotificationPrefs;
  dashboardWidgets: string[];
  recentSubjectIds: string[];
  aiPrivacyBlockedSubjectIds?: string[];
  preferredModelMode?: PreferredModelMode;
  xpPoints?: number;
  activeBadge?: string;
  savedExplanations?: SavedExplanationItem[];
  dailyHabits?: DailyHabitItem[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MindMapNode {
  id: string;
  parentId: string | null;
  label: string;
  category: string;
  color: string;
  definition: string;
  prerequisites: string[];
  level: number;
}

export interface MindMap {
  id: string;
  ownerId: string;
  subjectId: string;
  title: string;
  nodes: MindMapNode[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface HomeworkQuestion {
  id: string;
  prompt: string;
  whatItAsks: string;
  hint: string;
  steps: string[];
  topic: string;
}

export interface HomeworkFeedback {
  isCorrect: boolean;
  explanation: string;
  similarQuestion: string;
}

export interface HomeworkItem {
  id: string;
  ownerId: string;
  subjectId: string;
  title: string;
  questions: HomeworkQuestion[];
  studentAnswers: Record<string, string>;
  aiFeedback: Record<string, HomeworkFeedback>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface VocabItem {
  id: string;
  ownerId: string;
  subjectId: string;
  language: string;
  term: string;
  translation: string;
  partOfSpeech: string;
  exampleSentence: string;
  mastery: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface InteractiveModule {
  id: string;
  ownerId: string;
  subjectId: string;
  title: string;
  activityType: InteractiveActivityType;
  payload: Record<string, unknown>;
  bestScore: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WhiteboardBoard {
  id: string;
  ownerId: string;
  subjectId: string;
  title: string;
  strokesJson: string;
  snapshotDataUrl?: string;
  aiNotes: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface TextbookChapter {
  id: string;
  title: string;
  objectives: string[];
  explanationMarkdown: string;
  illustrationSvg: string;
  workedExamples: Array<{ problem: string; solution: string }>;
  terminology: Array<{ term: string; definition: string }>;
  summary: string;
  exercises: Array<{ prompt: string; hint: string; answer: string }>;
  chapterTest: Array<{
    prompt: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
  }>;
}

export interface Textbook {
  id: string;
  ownerId: string;
  subjectId: string;
  title: string;
  topic: string;
  difficulty: QuizDifficulty;
  chapters: TextbookChapter[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface MistakeEntry {
  id: string;
  ownerId: string;
  subjectId: string;
  topic: string;
  question: string;
  studentAnswer: string;
  correctAnswer: string;
  misconception: string;
  explanation: string;
  practiceQuestion: string;
  resolved: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudyRoom {
  id: string;
  ownerId: string;
  name: string;
  subjectName: string;
  inviteCode: string;
  isPublic: boolean;
  memberIds: string[];
  sharedNotes: string;
  sharedGoal: string;
  quizSessionJson: string;
  mindMapNodes: Array<{ id: string; text: string; author: string }>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface LessonSession {
  id: string;
  ownerId: string;
  subjectId: string;
  topic: string;
  stage: number;
  status: 'active' | 'paused' | 'completed';
  transcript: Array<{ role: string; text: string }>;
  notesContent: string;
  score: number;
  durationMinutes: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AiTelemetryLog {
  id: string;
  ownerId: string;
  endpoint: string;
  modelUsed: string;
  status: 'success' | 'error';
  promptTokens: number;
  outputTokens: number;
  durationMs: number;
  summary: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AIRecommendation {
  title: string;
  reason: string;
  actionType: string;
  subjectId: string;
  estimatedMinutes: number;
}

export type PodcastStyle = 'conversational' | 'exam_cram' | 'deep_dive' | 'debate_duo';

export interface PodcastTurn {
  speaker: 'Alex' | 'Sam';
  line: string;
}

export interface StudyPodcast {
  id: string;
  ownerId: string;
  subjectId: string;
  title: string;
  topic: string;
  hostStyle: PodcastStyle;
  turns: PodcastTurn[];
  takeaways: string[];
  estimatedMinutes: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FeynmanScores {
  clarity: number;
  accuracy: number;
  completeness: number;
  simplicity: number;
}

export interface FeynmanSession {
  id: string;
  ownerId: string;
  subjectId: string;
  topic: string;
  explanationText: string;
  overallScore: number;
  scores: FeynmanScores;
  blindSpots: string[];
  jargonFlags: string[];
  followUpQuestions: string[];
  refinedSummary: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type CitationSourceType = 'article' | 'book' | 'website' | 'paper' | 'video';

export interface CitationEntry {
  id: string;
  ownerId: string;
  subjectId: string;
  title: string;
  authors: string;
  year: string;
  sourceType: CitationSourceType;
  url: string;
  inText: string;
  apa: string;
  mla: string;
  chicago: string;
  harvard: string;
  ieee: string;
  bibtex: string;
  annotation: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CheatSheetSection {
  id: string;
  heading: string;
  keyPoints: string[];
  formulas: string[];
  mnemonics: string[];
  pitfalls: string[];
}

export interface CheatSheet {
  id: string;
  ownerId: string;
  subjectId: string;
  title: string;
  layoutColumns: 2 | 3;
  sections: CheatSheetSection[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface GradeCategoryItem {
  id: string;
  name: string;
  weightPercent: number;
  scorePercent: number | null;
  isFinalExam?: boolean;
}

export interface GradeCourse {
  id: string;
  ownerId: string;
  subjectId: string;
  courseName: string;
  code: string;
  credits: number;
  targetGradePercent: number;
  categories: GradeCategoryItem[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PdfSolvedAnswer {
  id: string;
  pageNumber: number;
  questionLabel: string;
  shortAnswer: string;
  detailedExplanation: string;
  answerBox: [number, number, number, number]; // [ymin, xmin, ymax, xmax] normalized 0-1000
  hidden?: boolean;
}

export type AppSection =
  | 'dashboard'
  | 'workspace'
  | 'flashcards_studio'
  | 'pdf_solver'
  | 'tutor'
  | 'voice_tutor'
  | 'teacher'
  | 'whiteboard'
  | 'textbooks'
  | 'video_studio'
  | 'podcasts'
  | 'lecture_notes'
  | 'feynman'
  | 'stem_sandbox'
  | 'citations'
  | 'cheatsheets'
  | 'debate'
  | 'grade_tracker'
  | 'homework'
  | 'mistakes'
  | 'explain_studio'
  | 'study_rooms'
  | 'discovery'
  | 'session_replay'
  | 'science_lab'
  | 'writing_lab'
  | 'vault'
  | 'control_centre'
  | 'mindmaps'
  | 'language_lab'
  | 'battle'
  | 'planner'
  | 'analytics'
  | 'library'
  | 'focus'
  | 'export_centre'
  | 'memory'
  | 'settings';

export type WorkspaceTab =
  | 'overview'
  | 'resources'
  | 'notes'
  | 'flashcards'
  | 'quizzes'
  | 'past_papers'
  | 'interactive'
  | 'subject_lab'
  | 'tutor';
