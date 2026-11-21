import type {
  AIRecommendation,
  CardDifficulty,
  CheatSheetSection,
  CitationSourceType,
  ComplexityPreference,
  ExplanationStyle,
  FeynmanScores,
  FileResourceType,
  HomeworkFeedback,
  HomeworkQuestion,
  InteractiveActivityType,
  MindMapNode,
  NoteStyle,
  PdfSolvedAnswer,
  PodcastStyle,
  PodcastTurn,
  PreferredModelMode,
  QuizDifficulty,
  QuizQuestion,
  QuizQuestionResult,
  TaskPriority,
  TaskType,
  TextbookChapter,
  TutorMode,
} from '../types';

async function handleJsonResponse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function analyzeStudyMaterial(params: {
  file?: File | null;
  pastedText?: string;
  title?: string;
  subjectName: string;
  isPastPaper: boolean;
}): Promise<{
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
}> {
  const form = new FormData();
  if (params.file) form.append('file', params.file);
  if (params.pastedText) form.append('pastedText', params.pastedText);
  if (params.title) form.append('title', params.title);
  form.append('subjectName', params.subjectName);
  form.append('isPastPaper', String(params.isPastPaper));

  const res = await fetch('/api/resources/analyze', {
    method: 'POST',
    body: form,
  });
  return handleJsonResponse(res);
}

export async function compareResources(params: {
  subjectName: string;
  documents: Array<{ title: string; summary: string; excerpt: string }>;
  question?: string;
}): Promise<{ answer: string }> {
  const res = await fetch('/api/resources/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function generateStudyNotes(params: {
  subjectName: string;
  resourceTitle: string;
  resourceContent: string;
  style: Exclude<NoteStyle, 'personal'>;
  customFocus?: string;
}): Promise<{ title: string; content: string }> {
  const res = await fetch('/api/notes/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function generateFlashcards(params: {
  subjectName: string;
  resourceTitle: string;
  resourceContent: string;
  count: number;
  weakTopics?: string[];
}): Promise<{
  flashcards: Array<{
    front: string;
    back: string;
    hint: string;
    topic: string;
    difficulty: CardDifficulty;
  }>;
}> {
  const res = await fetch('/api/flashcards/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function generateQuiz(params: {
  subjectName: string;
  resourcesText: string;
  count: number;
  difficulty: QuizDifficulty;
  questionTypes: string[];
  pastWeakTopics: string[];
  customTopic?: string;
  isMockExam?: boolean;
}): Promise<{ title: string; questions: QuizQuestion[] }> {
  const res = await fetch('/api/quizzes/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function gradeQuiz(params: {
  subjectName: string;
  questions: QuizQuestion[];
  answers: Record<string, string>;
}): Promise<{
  results: QuizQuestionResult[];
  score: number;
  weakTopics: string[];
  aiSummary: string;
}> {
  const res = await fetch('/api/quizzes/grade', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function streamTutorChat(
  params: {
    subjectName: string;
    mode: TutorMode;
    message: string;
    history: Array<{ role: 'user' | 'model'; content: string }>;
    resourcesContext: string;
    weakTopics: string[];
    confidence: number;
    preferredComplexity?: ComplexityPreference;
  },
  onChunk: (partialFullText: string) => void
): Promise<string> {
  const res = await fetch('/api/tutor/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Tutor request failed (${res.status})`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Streaming response body unavailable.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const jsonStr = trimmed.slice(5).trim();
      if (!jsonStr) continue;
      const evt = JSON.parse(jsonStr) as { text?: string; error?: string; done?: boolean };
      if (evt.error) throw new Error(evt.error);
      if (evt.text) {
        fullText += evt.text;
        onChunk(fullText);
      }
    }
  }

  return fullText;
}

export async function generateStudyPlan(params: {
  subjects: Array<{
    id: string;
    name: string;
    examDate: string;
    confidence: number;
    topics: string[];
  }>;
  availableHoursPerDay: number;
  startDate: string;
  daysCount: number;
  weakTopics: string[];
  missedTasks: Array<{ title: string; subjectId: string; topic: string }>;
}): Promise<{
  rationale: string;
  tasks: Array<{
    subjectId: string;
    title: string;
    topic: string;
    scheduledDate: string;
    startTime: string;
    durationMinutes: number;
    priority: TaskPriority;
    taskType: TaskType;
  }>;
}> {
  const res = await fetch('/api/planner/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function fetchDashboardRecommendations(params: {
  subjects: Array<{ id: string; name: string; examDate: string; confidence: number }>;
  recentQuizzes: Array<{ title: string; score: number; maxScore: number; weakTopics: string[] }>;
  flashcardsDueCount: number;
  resourcesCount: number;
  studyMinutesToday: number;
  dailyGoalMinutes: number;
}): Promise<{ coachMessage: string; recommendations: AIRecommendation[] }> {
  const res = await fetch('/api/recommendations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function runAutopilot(params: {
  subjects: Array<{ id: string; name: string; examDate: string; confidence: number; topics: string[] }>;
  resources: Array<{ subjectId: string; title: string; summary: string }>;
  quizzes: Array<{ subjectId: string; score: number; maxScore: number; weakTopics: string[] }>;
  flashcardsDueCount: number;
  todayDate: string;
  dailyGoalMinutes: number;
}): Promise<{
  focusSubjectId: string;
  briefing: string;
  nextActionLabel: string;
  tasks: Array<{
    subjectId: string;
    title: string;
    topic: string;
    scheduledDate: string;
    startTime: string;
    durationMinutes: number;
    priority: TaskPriority;
    taskType: TaskType;
  }>;
  microNoteTitle: string;
  microNoteContent: string;
  practiceQuestions: QuizQuestion[];
}> {
  const res = await fetch('/api/autopilot/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function analyzeLearningIntelligence(params: {
  subjects: Array<{ id: string; name: string; confidence: number; examDate: string }>;
  quizzes: Array<{ title: string; score: number; maxScore: number; weakTopics: string[]; aiSummary: string }>;
  flashcards: Array<{ topic: string; difficulty: string; timesReviewed: number; timesCorrect: number }>;
  sessions: Array<{ activityType: string; durationMinutes: number; date: string }>;
}): Promise<{
  recurringMistakes: string[];
  strugglingTopics: string[];
  topicEstimates: Array<{
    topic: string;
    masteryScore: number;
    guessingRisk: 'low' | 'medium' | 'high';
    note: string;
  }>;
  recommendedComplexity: ComplexityPreference;
  revisionPath: Array<{ step: number; title: string; action: string }>;
  weeklyReport: string;
}> {
  const res = await fetch('/api/intelligence/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function generateInteractiveModule(params: {
  subjectName: string;
  resourceContent: string;
  activityType: 'auto' | InteractiveActivityType;
  topic?: string;
}): Promise<{
  title: string;
  activityType: InteractiveActivityType;
  payload: {
    instructions: string;
    items: Array<{ id: string; left: string; right: string; hint: string }>;
  };
}> {
  const res = await fetch('/api/interactive/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function analyzeHomeworkWorksheet(params: {
  file?: File | null;
  pastedText?: string;
  title?: string;
  subjectName: string;
}): Promise<{ title: string; questions: HomeworkQuestion[] }> {
  const form = new FormData();
  if (params.file) form.append('file', params.file);
  if (params.pastedText) form.append('pastedText', params.pastedText);
  if (params.title) form.append('title', params.title);
  form.append('subjectName', params.subjectName);

  const res = await fetch('/api/homework/analyze', {
    method: 'POST',
    body: form,
  });
  return handleJsonResponse(res);
}

export async function checkHomeworkAnswer(params: {
  subjectName: string;
  questionPrompt: string;
  studentAnswer: string;
}): Promise<HomeworkFeedback> {
  const res = await fetch('/api/homework/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function generateMindMap(params: {
  subjectName: string;
  topicOrContent: string;
}): Promise<{ title: string; nodes: MindMapNode[] }> {
  const res = await fetch('/api/mindmap/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function generateLanguageLab(params: {
  language: string;
  level: string;
  focusMode: string;
  topic?: string;
}): Promise<{
  vocabulary: Array<{
    term: string;
    translation: string;
    partOfSpeech: string;
    exampleSentence: string;
  }>;
  conjugations: Array<{
    verb: string;
    tense: string;
    forms: Array<{ pronoun: string; form: string }>;
  }>;
  exercises: Array<{
    id: string;
    type: string;
    prompt: string;
    targetAnswer: string;
    hint: string;
  }>;
  readingPassage: {
    passage: string;
    englishSummary: string;
    questions: Array<{ q: string; a: string }>;
  };
}> {
  const res = await fetch('/api/language/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function checkLanguageExercise(params: {
  language: string;
  prompt: string;
  targetAnswer: string;
  studentAnswer: string;
}): Promise<{
  isCorrect: boolean;
  feedback: string;
  correctedSentence: string;
}> {
  const res = await fetch('/api/language/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function semanticSearchLibrary(params: {
  queryText: string;
  indexItems: Array<{ id: string; kind: string; subjectId: string; title: string; snippet: string }>;
}): Promise<{ answer: string; rankedIds: string[] }> {
  const res = await fetch('/api/search/semantic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function runSubjectLab(params: {
  domain: string;
  task: string;
  input: string;
}): Promise<{ result: string }> {
  const res = await fetch('/api/subject-lab/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

// Standard text-to-speech playback uses browser window.speechSynthesis (src/utils/browserSpeech.ts).
// Real-time bidirectional voice tutoring uses the Gemini Live API (/ws/voice-tutor).

// --- Next-Generation #20-#23 API Client Functions ---

export async function startTeacherLesson(params: {
  subjectName: string;
  topic: string;
  difficulty: QuizDifficulty;
  resourcesContext?: string;
}): Promise<{
  introduction: string;
  explanation: string;
  workedExamples: Array<{ title: string; problem: string; solutionMarkdown: string }>;
  whiteboardSvg: string;
  lessonNotes: string;
  knowledgeCheck: Array<{
    id: string;
    prompt: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
  }>;
}> {
  const res = await fetch('/api/teacher/lesson', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, action: 'start' }),
  });
  return handleJsonResponse(res);
}

export async function teacherLessonAction(params: {
  subjectName: string;
  topic: string;
  action: 'example' | 'qa' | 'grade_check';
  question?: string;
  resourcesContext?: string;
  answers?: Record<string, string>;
  knowledgeCheck?: Array<{ id: string; prompt: string; correctAnswer: string }>;
}): Promise<{ markdown?: string; score?: number; feedback?: string }> {
  const res = await fetch('/api/teacher/lesson', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function analyzeWhiteboardImage(params: {
  imageDataUrl: string;
  subjectName: string;
  mode: 'notes' | 'check_work' | 'diagram';
  boardTitle: string;
}): Promise<{ analysis: string }> {
  const res = await fetch('/api/whiteboard/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function generatePersonalTextbook(params: {
  subjectName: string;
  topic: string;
  difficulty: QuizDifficulty;
  chapterCount: number;
  resourcesContext?: string;
}): Promise<{ title: string; chapters: TextbookChapter[] }> {
  const res = await fetch('/api/textbook/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function generateVideoStoryboard(params: {
  subjectName: string;
  topic: string;
  content: string;
  format: 'short_explainer' | 'chapter_summary' | 'lesson_script';
}): Promise<{
  title: string;
  overviewScript: string;
  scenes: Array<{
    index: number;
    title: string;
    durationSeconds: number;
    narration: string;
    subtitle: string;
    bulletPoints: string[];
    diagramSvg: string;
  }>;
  videoRenderingSupported: boolean;
  videoStatusNote: string;
}> {
  const res = await fetch('/api/video-studio/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function analyzePredictiveExamPrep(params: {
  subjectName: string;
  examDate: string;
  topics: string[];
  completedTopics: string[];
  strugglingTopics: string[];
  quizStats: { count: number; avgPercent: number; weakTopics: string[] };
  flashcardAccuracy: number;
  studyMinutes: number;
}): Promise<{
  estimatedReadinessPercent: number;
  evidenceConfidence: string;
  readinessSummary: string;
  topicAssessments: Array<{
    topic: string;
    status: string;
    reason: string;
    recommendedMinutes: number;
  }>;
  prepPlan: string[];
}> {
  const res = await fetch('/api/exam-prep/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function analyzeMistakeEntry(params: {
  subjectName: string;
  topic?: string;
  question: string;
  studentAnswer: string;
  correctAnswer: string;
}): Promise<{
  inferredTopic: string;
  misconception: string;
  explanation: string;
  practiceQuestion: string;
}> {
  const res = await fetch('/api/mistakes/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function explainTopicInStyle(params: {
  subjectName: string;
  topic: string;
  style: ExplanationStyle;
  context?: string;
}): Promise<{
  contentMarkdown: string;
  keyTakeaway: string;
  diagramSvg: string;
}> {
  const res = await fetch('/api/explain/studio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function discoverStudyResources(params: {
  subjectName: string;
  topic: string;
  resourceKind: string;
}): Promise<{
  guideMarkdown: string;
  sources: Array<{ title: string; uri: string }>;
  queriesUsed: string[];
}> {
  const res = await fetch('/api/discovery/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function summarizeStudySession(params: {
  topic: string;
  subjectName: string;
  transcript: Array<{ role: string; text: string }>;
  notesContent: string;
}): Promise<{ summary: string }> {
  const res = await fetch('/api/sessions/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function analyzeWritingDraft(params: {
  essayText: string;
  subjectName: string;
  rubricGoal: string;
  mode: 'full' | 'argument' | 'concise';
}): Promise<{
  overallScore: number;
  rubricBreakdown: Array<{ criterion: string; score: number; feedback: string }>;
  grammarAndVocabulary: Array<{ original: string; improved: string; reason: string }>;
  argumentStrength: string;
  improvedDraft: string;
}> {
  const res = await fetch('/api/writing/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function fetchControlCentreStatus(): Promise<{
  apiKeyConfigured: boolean;
  preferredMode: PreferredModelMode;
  primaryCooldownSeconds: number;
  telemetry: {
    totalRequests: number;
    failedRequests: number;
    totalPromptTokens: number;
    totalOutputTokens: number;
    recentEvents: Array<{
      id: string;
      endpoint: string;
      modelUsed: string;
      status: 'success' | 'error';
      promptTokens: number;
      outputTokens: number;
      durationMs: number;
      summary: string;
      timestamp: string;
    }>;
  };
  models: Array<{
    id: string;
    role: string;
    connected: boolean;
    requiresPaidKey: boolean;
    status: string;
    capabilities: string[];
  }>;
}> {
  const res = await fetch('/api/control-centre/status');
  return handleJsonResponse(res);
}

export async function setControlCentreMode(preferredMode: PreferredModelMode): Promise<{ ok: boolean; preferredMode: PreferredModelMode }> {
  const res = await fetch('/api/control-centre/mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preferredMode }),
  });
  return handleJsonResponse(res);
}

// --- Expansion Pack: Podcasts, Lecture Transcriber, Feynman, STEM, Citations, Cheat Sheets, Debate, Grade Advisor ---

export async function generatePodcastScript(params: {
  subjectName: string;
  topic: string;
  hostStyle: PodcastStyle;
  context?: string;
}): Promise<{
  title: string;
  estimatedMinutes: number;
  turns: PodcastTurn[];
  takeaways: string[];
}> {
  const res = await fetch('/api/podcasts/script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

// Podcast audio narration is played client-side via browser window.speechSynthesis (src/utils/browserSpeech.ts).

export async function transcribeLectureToCornell(params: {
  audioFile?: File | Blob | null;
  fileName?: string;
  pastedTranscript?: string;
  subjectName: string;
  lectureTitle?: string;
}): Promise<{
  title: string;
  transcript: string;
  cues: Array<{ cue: string; detail: string }>;
  detailedNotesMarkdown: string;
  summary: string;
  actionItems: string[];
  flashcardSeeds: Array<{ front: string; back: string; hint: string; topic: string }>;
}> {
  const form = new FormData();
  if (params.audioFile) {
    form.append('audio', params.audioFile, params.fileName || 'lecture-recording.webm');
  }
  if (params.pastedTranscript) form.append('pastedTranscript', params.pastedTranscript);
  if (params.lectureTitle) form.append('lectureTitle', params.lectureTitle);
  form.append('subjectName', params.subjectName);

  const res = await fetch('/api/lectures/transcribe-cornell', {
    method: 'POST',
    body: form,
  });
  return handleJsonResponse(res);
}

export async function evaluateFeynmanExplanation(params: {
  subjectName: string;
  topic: string;
  explanationText: string;
  followUpAnswers?: string;
  context?: string;
}): Promise<{
  overallScore: number;
  scores: FeynmanScores;
  verdict: string;
  blindSpots: string[];
  jargonFlags: string[];
  followUpQuestions: string[];
  refinedSummary: string;
}> {
  const res = await fetch('/api/feynman/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function analyzeMathCurve(params: {
  expression: string;
  xMin: number;
  xMax: number;
  integralA?: number;
  integralB?: number;
  numericIntegral?: number | null;
}): Promise<{ analysisMarkdown: string }> {
  const res = await fetch('/api/stem/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function reviewStemCode(params: {
  code: string;
  task: 'debug' | 'complexity' | 'trace' | 'translate_python';
  consoleOutput?: string;
  question?: string;
}): Promise<{ markdown: string }> {
  const res = await fetch('/api/stem/code-review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function generateAcademicCitation(params: {
  queryInput: string;
  sourceType: CitationSourceType;
  subjectName?: string;
}): Promise<{
  title: string;
  authors: string;
  year: string;
  url: string;
  inText: string;
  apa: string;
  mla: string;
  chicago: string;
  harvard: string;
  ieee: string;
  bibtex: string;
  annotation: string;
  verificationNote: string;
}> {
  const res = await fetch('/api/citations/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function generateExamCheatSheet(params: {
  subjectName: string;
  focusTopics: string;
  layoutColumns: 2 | 3;
  context?: string;
}): Promise<{
  title: string;
  sections: CheatSheetSection[];
}> {
  const res = await fetch('/api/cheatsheets/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function runDebateTurn(params: {
  motion: string;
  studentStance: 'pro' | 'con';
  subjectName: string;
  history: Array<{ role: 'student' | 'opponent'; text: string }>;
  studentArgument: string;
}): Promise<{
  rebuttal: string;
  fallacyCheck: Array<{ name: string; quote: string; fix: string }>;
  counterQuestion: string;
  strengthDelta: number;
}> {
  const res = await fetch('/api/debate/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function judgeDebateSession(params: {
  motion: string;
  studentStance: 'pro' | 'con';
  history: Array<{ role: 'student' | 'opponent'; text: string }>;
}): Promise<{
  winner: 'student' | 'opponent' | 'draw';
  totalScore: number;
  breakdown: {
    evidence: number;
    rebuttal: number;
    logic: number;
    persuasion: number;
  };
  strongestMove: string;
  improvementTip: string;
  judgeVerdict: string;
}> {
  const res = await fetch('/api/debate/judge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function generateGradeStrategy(params: {
  courses: Array<{
    courseName: string;
    credits: number;
    currentPercent: number | null;
    targetGradePercent: number;
    neededOnRemainingPercent: number | null;
    remainingWeightPercent: number;
  }>;
}): Promise<{ strategyMarkdown: string }> {
  const res = await fetch('/api/grades/strategy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return handleJsonResponse(res);
}

export async function solvePdfWorksheet(params: {
  file: File;
  subjectName?: string;
  pageCount?: number;
}): Promise<{
  worksheetTitle: string;
  answers: PdfSolvedAnswer[];
}> {
  const form = new FormData();
  form.append('file', params.file);
  if (params.subjectName) form.append('subjectName', params.subjectName);
  if (params.pageCount) form.append('pageCount', String(params.pageCount));

  const res = await fetch('/api/solve-pdf', {
    method: 'POST',
    body: form,
  });
  return handleJsonResponse(res);
}



