import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { type User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  AcademicMemory,
  ActivityType,
  CardDifficulty,
  CheatSheet,
  CheatSheetSection,
  CitationEntry,
  CitationSourceType,
  ComplexityPreference,
  DailyHabitItem,
  FeynmanScores,
  FeynmanSession,
  Flashcard,
  GradeCategoryItem,
  GradeCourse,
  HomeworkFeedback,
  HomeworkQuestion,
  InteractiveActivityType,
  LessonSession,
  MindMapNode,
  MistakeEntry,
  NoteStyle,
  NotificationPrefs,
  PodcastStyle,
  PodcastTurn,
  PreferredModelMode,
  Quiz,
  QuizDifficulty,
  QuizQuestion,
  QuizQuestionResult,
  SavedExplanationItem,
  StudyNote,
  StudyPlanTask,
  StudyPodcast,
  StudyResource,
  StudyRoom,
  Subject,
  SubjectColor,
  TaskCategory,
  TaskPriority,
  TaskType,
  Textbook,
  TextbookChapter,
  ThemeMode,
  TutorMode,
  UserProfile,
} from '../types';

export const DEFAULT_DASHBOARD_WIDGETS = [
  'metrics',
  'autopilot',
  'quick_tutor',
  'today_plan',
  'subject_progress',
  'recommendations',
  'upcoming_exams',
  'recent_docs',
];

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  examReminders: true,
  flashcardDueAlerts: true,
  unfinishedSessionAlerts: true,
  weeklySummaryAlerts: true,
  dailyDigestTime: '08:30',
};

export function makeId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getYesterdayIsoDate(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }
    const profile: UserProfile = {
      uid: user.uid,
      displayName: (user.displayName || user.email?.split('@')[0] || 'Scholar').slice(0, 120),
      email: (user.email || 'scholar@example.com').slice(0, 254),
      photoURL: (user.photoURL || '').slice(0, 500),
      dailyGoalMinutes: 90,
      streakDays: 0,
      totalStudyMinutes: 0,
      lastStudyDate: '',
      theme: 'light',
      achievements: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, profile);
    return profile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function ensureAcademicMemory(uid: string): Promise<AcademicMemory> {
  const path = `academicMemories/${uid}`;
  const ref = doc(db, 'academicMemories', uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return snap.data() as AcademicMemory;
    }
    const memory: AcademicMemory = {
      uid,
      completedTopics: [],
      strugglingTopics: [],
      preferredComplexity: 'balanced',
      learningNotes: '',
      recurringMistakes: [],
      weeklyReport: '',
      notificationPrefs: DEFAULT_NOTIFICATION_PREFS,
      dashboardWidgets: DEFAULT_DASHBOARD_WIDGETS,
      recentSubjectIds: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, memory);
    return memory;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeUserProfile(
  uid: string,
  onData: (profile: UserProfile | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `users/${uid}`;
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      onData(snap.exists() ? (snap.data() as UserProfile) : null);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export function subscribeAcademicMemory(
  uid: string,
  onData: (memory: AcademicMemory | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const path = `academicMemories/${uid}`;
  return onSnapshot(
    doc(db, 'academicMemories', uid),
    (snap) => {
      onData(snap.exists() ? (snap.data() as AcademicMemory) : null);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export async function updateAcademicMemory(
  uid: string,
  updates: Partial<{
    completedTopics: string[];
    strugglingTopics: string[];
    preferredComplexity: ComplexityPreference;
    learningNotes: string;
    recurringMistakes: string[];
    weeklyReport: string;
    notificationPrefs: NotificationPrefs;
    dashboardWidgets: string[];
    recentSubjectIds: string[];
    aiPrivacyBlockedSubjectIds: string[];
    preferredModelMode: PreferredModelMode;
    xpPoints: number;
    activeBadge: string;
    savedExplanations: SavedExplanationItem[];
    dailyHabits: DailyHabitItem[];
  }>
) {
  const path = `academicMemories/${uid}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.completedTopics !== undefined) {
      payload.completedTopics = updates.completedTopics.slice(0, 100).map((s) => s.slice(0, 160));
    }
    if (updates.strugglingTopics !== undefined) {
      payload.strugglingTopics = updates.strugglingTopics.slice(0, 100).map((s) => s.slice(0, 160));
    }
    if (updates.preferredComplexity !== undefined) {
      payload.preferredComplexity = updates.preferredComplexity;
    }
    if (updates.learningNotes !== undefined) {
      payload.learningNotes = updates.learningNotes.slice(0, 10000);
    }
    if (updates.recurringMistakes !== undefined) {
      payload.recurringMistakes = updates.recurringMistakes.slice(0, 50).map((s) => s.slice(0, 300));
    }
    if (updates.weeklyReport !== undefined) {
      payload.weeklyReport = updates.weeklyReport.slice(0, 30000);
    }
    if (updates.notificationPrefs !== undefined) {
      payload.notificationPrefs = updates.notificationPrefs;
    }
    if (updates.dashboardWidgets !== undefined) {
      payload.dashboardWidgets = updates.dashboardWidgets.slice(0, 20).map((s) => s.slice(0, 64));
    }
    if (updates.recentSubjectIds !== undefined) {
      payload.recentSubjectIds = updates.recentSubjectIds.slice(0, 10).map((s) => s.slice(0, 128));
    }
    if (updates.aiPrivacyBlockedSubjectIds !== undefined) {
      payload.aiPrivacyBlockedSubjectIds = updates.aiPrivacyBlockedSubjectIds.slice(0, 60).map((s) => s.slice(0, 128));
    }
    if (updates.preferredModelMode !== undefined) {
      payload.preferredModelMode = updates.preferredModelMode;
    }
    if (updates.xpPoints !== undefined) {
      payload.xpPoints = Math.min(Math.max(Math.round(updates.xpPoints), 0), 10000000);
    }
    if (updates.activeBadge !== undefined) {
      payload.activeBadge = updates.activeBadge.slice(0, 64);
    }
    if (updates.savedExplanations !== undefined) {
      payload.savedExplanations = updates.savedExplanations.slice(0, 40);
    }
    if (updates.dailyHabits !== undefined) {
      payload.dailyHabits = updates.dailyHabits.slice(0, 20);
    }
    await ensureAcademicMemory(uid);
    await updateDoc(doc(db, 'academicMemories', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function awardLearningXp(
  uid: string,
  currentMemory: AcademicMemory | null,
  deltaXp: number
) {
  const baseXp = currentMemory?.xpPoints ?? 0;
  const nextXp = Math.max(0, baseXp + Math.round(deltaXp));
  await updateAcademicMemory(uid, { xpPoints: nextXp }).catch(() => {});
}

export function buildSubjectAiContext(
  subjectId: string,
  resources: StudyResource[],
  memory: AcademicMemory | null,
  maxChars = 45000
): string {
  const blocked = new Set(memory?.aiPrivacyBlockedSubjectIds || []);
  if (blocked.has(subjectId)) {
    return '[AI Subject Privacy Lock enabled for this subject — uploaded materials were withheld from Gemini context.]';
  }
  const matched = resources.filter((r) => r.subjectId === subjectId && !blocked.has(r.subjectId));
  return matched
    .map((r) => `## ${r.title}\n${r.summary}\n${r.extractedText.slice(0, 10000)}`)
    .join('\n\n')
    .slice(0, maxChars);
}

export async function updateUserSettings(
  uid: string,
  updates: { displayName?: string; dailyGoalMinutes?: number; theme?: ThemeMode }
) {
  const path = `users/${uid}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.displayName !== undefined) {
      payload.displayName = updates.displayName.trim().slice(0, 120) || 'Scholar';
    }
    if (updates.dailyGoalMinutes !== undefined) {
      payload.dailyGoalMinutes = Math.min(Math.max(Math.round(updates.dailyGoalMinutes), 10), 600);
    }
    if (updates.theme !== undefined) {
      payload.theme = updates.theme;
    }
    await updateDoc(doc(db, 'users', uid), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeOwnerCollection<T>(
  collectionName: string,
  uid: string,
  onData: (items: T[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, collectionName), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as T);
      onData(items);
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, collectionName);
    }
  );
}

// --- Subjects ---
export async function createSubject(
  uid: string,
  input: {
    name: string;
    code: string;
    folder: string;
    color: SubjectColor;
    examDate: string;
    confidence: number;
    targetHoursPerWeek: number;
    topics: string[];
  }
): Promise<string> {
  const id = makeId('subj');
  const path = `subjects/${id}`;
  try {
    await setDoc(doc(db, 'subjects', id), {
      ownerId: uid,
      name: input.name.trim().slice(0, 120),
      code: input.code.trim().slice(0, 32),
      folder: input.folder.trim().slice(0, 80),
      color: input.color,
      examDate: input.examDate.slice(0, 20),
      confidence: Math.min(Math.max(Math.round(input.confidence), 1), 5),
      targetHoursPerWeek: Math.min(Math.max(Math.round(input.targetHoursPerWeek), 1), 80),
      topics: input.topics.slice(0, 40).map((t) => t.trim().slice(0, 120)).filter(Boolean),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateSubject(
  subjectId: string,
  updates: Partial<{
    name: string;
    code: string;
    folder: string;
    color: SubjectColor;
    examDate: string;
    confidence: number;
    targetHoursPerWeek: number;
    topics: string[];
  }>
) {
  const path = `subjects/${subjectId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.name !== undefined) payload.name = updates.name.trim().slice(0, 120);
    if (updates.code !== undefined) payload.code = updates.code.trim().slice(0, 32);
    if (updates.folder !== undefined) payload.folder = updates.folder.trim().slice(0, 80);
    if (updates.color !== undefined) payload.color = updates.color;
    if (updates.examDate !== undefined) payload.examDate = updates.examDate.slice(0, 20);
    if (updates.confidence !== undefined)
      payload.confidence = Math.min(Math.max(Math.round(updates.confidence), 1), 5);
    if (updates.targetHoursPerWeek !== undefined)
      payload.targetHoursPerWeek = Math.min(Math.max(Math.round(updates.targetHoursPerWeek), 1), 80);
    if (updates.topics !== undefined)
      payload.topics = updates.topics.slice(0, 40).map((t) => t.trim().slice(0, 120)).filter(Boolean);
    await updateDoc(doc(db, 'subjects', subjectId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteSubject(subjectId: string) {
  const path = `subjects/${subjectId}`;
  try {
    await deleteDoc(doc(db, 'subjects', subjectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Resources ---
export async function createResource(
  uid: string,
  input: Omit<StudyResource, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeId('res');
  const path = `resources/${id}`;
  try {
    await setDoc(doc(db, 'resources', id), {
      ownerId: uid,
      subjectId: input.subjectId,
      title: input.title.trim().slice(0, 200) || 'Untitled Resource',
      fileName: input.fileName.trim().slice(0, 255) || 'study-material.txt',
      fileType: input.fileType,
      fileSize: Math.min(Math.max(Number(input.fileSize) || 0, 0), 52428800),
      isPastPaper: Boolean(input.isPastPaper),
      extractedText: input.extractedText.slice(0, 195000),
      summary: input.summary.slice(0, 19500),
      keyConcepts: input.keyConcepts.slice(0, 40).map((s) => s.slice(0, 200)),
      definitions: input.definitions.slice(0, 50).map((s) => s.slice(0, 400)),
      formulas: input.formulas.slice(0, 40).map((s) => s.slice(0, 300)),
      detectedTopics: (input.detectedTopics || []).slice(0, 20).map((s) => s.slice(0, 120)),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteResource(resourceId: string) {
  const path = `resources/${resourceId}`;
  try {
    await deleteDoc(doc(db, 'resources', resourceId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Notes ---
export async function createNote(
  uid: string,
  input: {
    subjectId: string;
    resourceId: string;
    title: string;
    style: NoteStyle;
    content: string;
    isBookmarked?: boolean;
  }
): Promise<string> {
  const id = makeId('note');
  const path = `notes/${id}`;
  try {
    await setDoc(doc(db, 'notes', id), {
      ownerId: uid,
      subjectId: input.subjectId,
      resourceId: input.resourceId.slice(0, 128),
      title: input.title.trim().slice(0, 200) || 'Untitled Note',
      style: input.style,
      content: input.content.slice(0, 195000),
      isBookmarked: Boolean(input.isBookmarked),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateNoteContent(
  noteId: string,
  updates: { title: string; content: string; style: NoteStyle }
) {
  const path = `notes/${noteId}`;
  try {
    await updateDoc(doc(db, 'notes', noteId), {
      title: updates.title.trim().slice(0, 200) || 'Untitled Note',
      content: updates.content.slice(0, 195000),
      style: updates.style,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function toggleNoteBookmark(noteId: string, isBookmarked: boolean) {
  const path = `notes/${noteId}`;
  try {
    await updateDoc(doc(db, 'notes', noteId), {
      isBookmarked,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteNote(noteId: string) {
  const path = `notes/${noteId}`;
  try {
    await deleteDoc(doc(db, 'notes', noteId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Flashcards & SM-2 Spaced Repetition ---
export async function createFlashcardsBatch(
  uid: string,
  subjectId: string,
  resourceId: string,
  cards: Array<{
    front: string;
    back: string;
    hint: string;
    topic: string;
    difficulty: CardDifficulty;
  }>
) {
  const nowIso = new Date().toISOString();
  await Promise.all(
    cards.map(async (c) => {
      const id = makeId('card');
      const path = `flashcards/${id}`;
      try {
        await setDoc(doc(db, 'flashcards', id), {
          ownerId: uid,
          subjectId,
          resourceId: resourceId.slice(0, 128),
          front: c.front.trim().slice(0, 2000),
          back: c.back.trim().slice(0, 4000),
          hint: c.hint.trim().slice(0, 1000),
          topic: c.topic.trim().slice(0, 120) || 'Core',
          difficulty: c.difficulty,
          repetitions: 0,
          intervalDays: 0,
          easeFactor: 2.5,
          nextReviewAt: nowIso,
          timesReviewed: 0,
          timesCorrect: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    })
  );
}

export function computeSm2Update(
  card: Flashcard,
  rating: 'hard' | 'medium' | 'easy'
): {
  difficulty: CardDifficulty;
  repetitions: number;
  intervalDays: number;
  easeFactor: number;
  nextReviewAt: string;
  timesReviewed: number;
  timesCorrect: number;
} {
  const quality = rating === 'hard' ? 2 : rating === 'medium' ? 4 : 5;
  let repetitions = card.repetitions;
  let intervalDays = card.intervalDays;
  let easeFactor = card.easeFactor;

  if (quality < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    if (repetitions === 0) intervalDays = 1;
    else if (repetitions === 1) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * easeFactor);
    repetitions += 1;
  }

  easeFactor = Math.max(1.3, Math.min(3.5, easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))));
  const nextDate = new Date();
  if (rating === 'hard') {
    nextDate.setHours(nextDate.getHours() + 12);
  } else {
    nextDate.setDate(nextDate.getDate() + intervalDays);
  }

  return {
    difficulty: rating,
    repetitions,
    intervalDays: Math.min(intervalDays, 3650),
    easeFactor: Math.round(easeFactor * 100) / 100,
    nextReviewAt: nextDate.toISOString(),
    timesReviewed: card.timesReviewed + 1,
    timesCorrect: card.timesCorrect + (quality >= 3 ? 1 : 0),
  };
}

export async function reviewFlashcard(card: Flashcard, rating: 'hard' | 'medium' | 'easy') {
  const path = `flashcards/${card.id}`;
  try {
    const next = computeSm2Update(card, rating);
    await updateDoc(doc(db, 'flashcards', card.id), {
      ...next,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteFlashcard(cardId: string) {
  const path = `flashcards/${cardId}`;
  try {
    await deleteDoc(doc(db, 'flashcards', cardId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Quizzes ---
export async function createQuiz(
  uid: string,
  input: {
    subjectId: string;
    title: string;
    difficulty: QuizDifficulty;
    isTimed: boolean;
    durationMinutes: number;
    questions: QuizQuestion[];
  }
): Promise<string> {
  const id = makeId('quiz');
  const path = `quizzes/${id}`;
  const safeQuestions = input.questions.slice(0, 30);
  if (safeQuestions.length === 0) {
    throw new Error('Could not generate any valid quiz questions. Please try again.');
  }
  const maxScore = safeQuestions.reduce((acc, q) => acc + (q.points || 1), 0);
  try {
    await setDoc(doc(db, 'quizzes', id), {
      ownerId: uid,
      subjectId: input.subjectId,
      title: input.title.trim().slice(0, 200) || 'Practice Assessment',
      difficulty: input.difficulty,
      isTimed: input.isTimed,
      durationMinutes: Math.min(Math.max(Math.round(input.durationMinutes), 1), 240),
      status: 'in_progress',
      questions: safeQuestions,
      answers: {},
      results: [],
      score: 0,
      maxScore: Math.max(maxScore, 1),
      weakTopics: [],
      aiSummary: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function completeQuiz(
  quizId: string,
  payload: {
    answers: Record<string, string>;
    results: QuizQuestionResult[];
    score: number;
    weakTopics: string[];
    aiSummary: string;
  }
) {
  const path = `quizzes/${quizId}`;
  try {
    await updateDoc(doc(db, 'quizzes', quizId), {
      answers: payload.answers,
      results: payload.results.slice(0, 30),
      score: Math.max(0, payload.score),
      weakTopics: payload.weakTopics.slice(0, 30),
      aiSummary: payload.aiSummary.slice(0, 10000),
      status: 'completed',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteQuiz(quizId: string) {
  const path = `quizzes/${quizId}`;
  try {
    await deleteDoc(doc(db, 'quizzes', quizId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Tutor Messages ---
export async function createTutorMessage(
  uid: string,
  input: {
    subjectId: string;
    role: 'user' | 'model';
    mode: TutorMode;
    content: string;
  }
): Promise<string> {
  const id = makeId('msg');
  const path = `tutorMessages/${id}`;
  try {
    await setDoc(doc(db, 'tutorMessages', id), {
      ownerId: uid,
      subjectId: input.subjectId,
      role: input.role,
      mode: input.mode,
      content: input.content.slice(0, 59500),
      isBookmarked: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function toggleTutorMessageBookmark(messageId: string, isBookmarked: boolean) {
  const path = `tutorMessages/${messageId}`;
  try {
    await updateDoc(doc(db, 'tutorMessages', messageId), {
      isBookmarked,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTutorMessage(messageId: string) {
  const path = `tutorMessages/${messageId}`;
  try {
    await deleteDoc(doc(db, 'tutorMessages', messageId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Study Plan Tasks ---
export async function createStudyPlanTasksBatch(
  uid: string,
  tasks: Array<{
    subjectId: string;
    title: string;
    topic: string;
    scheduledDate: string;
    startTime: string;
    durationMinutes: number;
    priority: TaskPriority;
    taskType: TaskType;
    category?: TaskCategory;
  }>
) {
  await Promise.all(
    tasks.map(async (t) => {
      const id = makeId('task');
      const path = `studyPlanTasks/${id}`;
      try {
        await setDoc(doc(db, 'studyPlanTasks', id), {
          ownerId: uid,
          subjectId: t.subjectId,
          title: t.title.trim().slice(0, 200),
          topic: t.topic.trim().slice(0, 160),
          scheduledDate: t.scheduledDate.slice(0, 20),
          startTime: t.startTime.slice(0, 20),
          durationMinutes: Math.min(Math.max(Math.round(t.durationMinutes), 5), 480),
          priority: t.priority,
          taskType: t.taskType,
          category: t.category || 'revision',
          completed: false,
          missed: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    })
  );
}

export async function toggleTaskCompleted(taskId: string, completed: boolean) {
  const path = `studyPlanTasks/${taskId}`;
  try {
    await updateDoc(doc(db, 'studyPlanTasks', taskId), {
      completed,
      missed: false,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function markTaskMissed(taskId: string, missed: boolean) {
  const path = `studyPlanTasks/${taskId}`;
  try {
    await updateDoc(doc(db, 'studyPlanTasks', taskId), {
      missed,
      completed: false,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteStudyPlanTask(taskId: string) {
  const path = `studyPlanTasks/${taskId}`;
  try {
    await deleteDoc(doc(db, 'studyPlanTasks', taskId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Mind Maps ---
export async function createMindMap(
  uid: string,
  subjectId: string,
  title: string,
  nodes: MindMapNode[]
): Promise<string> {
  const id = makeId('mmap');
  const path = `mindMaps/${id}`;
  const safeNodes = nodes.slice(0, 80);
  if (safeNodes.length === 0) {
    throw new Error('Mind map generation returned no concepts. Please try again.');
  }
  try {
    await setDoc(doc(db, 'mindMaps', id), {
      ownerId: uid,
      subjectId,
      title: title.trim().slice(0, 200) || 'Knowledge Map',
      nodes: safeNodes,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteMindMap(mapId: string) {
  const path = `mindMaps/${mapId}`;
  try {
    await deleteDoc(doc(db, 'mindMaps', mapId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Homework Assistant ---
export async function createHomeworkItem(
  uid: string,
  subjectId: string,
  title: string,
  questions: HomeworkQuestion[]
): Promise<string> {
  const id = makeId('hw');
  const path = `homeworkItems/${id}`;
  const safeQuestions = questions.slice(0, 25);
  if (safeQuestions.length === 0) {
    throw new Error('No homework questions were recognized from this input.');
  }
  try {
    await setDoc(doc(db, 'homeworkItems', id), {
      ownerId: uid,
      subjectId,
      title: title.trim().slice(0, 200) || 'Homework Worksheet',
      questions: safeQuestions,
      studentAnswers: {},
      aiFeedback: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateHomeworkSubmission(
  hwId: string,
  studentAnswers: Record<string, string>,
  aiFeedback: Record<string, HomeworkFeedback>
) {
  const path = `homeworkItems/${hwId}`;
  try {
    await updateDoc(doc(db, 'homeworkItems', hwId), {
      studentAnswers,
      aiFeedback,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteHomeworkItem(hwId: string) {
  const path = `homeworkItems/${hwId}`;
  try {
    await deleteDoc(doc(db, 'homeworkItems', hwId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Language Lab Vocab ---
export async function createVocabItemsBatch(
  uid: string,
  subjectId: string,
  language: string,
  items: Array<{
    term: string;
    translation: string;
    partOfSpeech: string;
    exampleSentence: string;
  }>
) {
  await Promise.all(
    items.map(async (item) => {
      const id = makeId('vocab');
      const path = `vocabItems/${id}`;
      try {
        await setDoc(doc(db, 'vocabItems', id), {
          ownerId: uid,
          subjectId,
          language: language.trim().slice(0, 60) || 'Language',
          term: item.term.trim().slice(0, 200) || 'Term',
          translation: item.translation.trim().slice(0, 200) || 'Translation',
          partOfSpeech: item.partOfSpeech.slice(0, 60),
          exampleSentence: item.exampleSentence.slice(0, 500),
          mastery: 1,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    })
  );
}

export async function updateVocabMastery(vocabId: string, mastery: number) {
  const path = `vocabItems/${vocabId}`;
  try {
    await updateDoc(doc(db, 'vocabItems', vocabId), {
      mastery: Math.min(Math.max(Math.round(mastery), 0), 5),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteVocabItem(vocabId: string) {
  const path = `vocabItems/${vocabId}`;
  try {
    await deleteDoc(doc(db, 'vocabItems', vocabId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Interactive Learning Modules ---
export async function createInteractiveModule(
  uid: string,
  subjectId: string,
  title: string,
  activityType: InteractiveActivityType,
  payload: Record<string, unknown>
): Promise<string> {
  const id = makeId('imod');
  const path = `interactiveModules/${id}`;
  try {
    await setDoc(doc(db, 'interactiveModules', id), {
      ownerId: uid,
      subjectId,
      title: title.trim().slice(0, 200) || 'Interactive Exercise',
      activityType,
      payload,
      bestScore: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateInteractiveModuleScore(modId: string, bestScore: number) {
  const path = `interactiveModules/${modId}`;
  try {
    await updateDoc(doc(db, 'interactiveModules', modId), {
      bestScore: Math.min(Math.max(Math.round(bestScore), 0), 100),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteInteractiveModule(modId: string) {
  const path = `interactiveModules/${modId}`;
  try {
    await deleteDoc(doc(db, 'interactiveModules', modId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Study Sessions, Streaks & Achievements ---
export async function logStudySession(
  uid: string,
  profile: UserProfile | null,
  subjectId: string,
  activityType: ActivityType,
  durationMinutes: number,
  extraStats?: {
    resourcesCount?: number;
    notesCount?: number;
    flashcardsCount?: number;
    quizzesCompletedCount?: number;
  }
) {
  const id = makeId('sess');
  const today = getTodayIsoDate();
  const safeDuration = Math.min(Math.max(Math.round(durationMinutes), 1), 600);
  const path = `studySessions/${id}`;
  try {
    await setDoc(doc(db, 'studySessions', id), {
      ownerId: uid,
      subjectId,
      activityType,
      durationMinutes: safeDuration,
      date: today,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    if (profile) {
      const yesterday = getYesterdayIsoDate();
      let newStreak = profile.streakDays || 0;
      if (profile.lastStudyDate === today) {
        newStreak = Math.max(newStreak, 1);
      } else if (profile.lastStudyDate === yesterday) {
        newStreak = newStreak + 1;
      } else {
        newStreak = 1;
      }

      const newTotal = (profile.totalStudyMinutes || 0) + safeDuration;
      const unlocked = new Set(profile.achievements || []);
      unlocked.add('first_session');
      if (newStreak >= 3) unlocked.add('streak_3');
      if (newStreak >= 7) unlocked.add('streak_7');
      if (newTotal >= 60) unlocked.add('hour_scholar');
      if (newTotal >= 300) unlocked.add('deep_focus_5h');
      if ((extraStats?.resourcesCount || 0) >= 1) unlocked.add('first_upload');
      if ((extraStats?.notesCount || 0) >= 3) unlocked.add('note_synthesizer');
      if ((extraStats?.flashcardsCount || 0) >= 10) unlocked.add('deck_builder');
      if ((extraStats?.quizzesCompletedCount || 0) >= 1) unlocked.add('exam_ready');

      await updateDoc(doc(db, 'users', uid), {
        streakDays: newStreak,
        totalStudyMinutes: newTotal,
        lastStudyDate: today,
        achievements: Array.from(unlocked).slice(0, 30),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export const ACHIEVEMENT_CATALOG: Record<string, { title: string; description: string }> = {
  first_session: { title: 'First Study Session', description: 'Completed your first logged study session' },
  first_upload: { title: 'Knowledge Base', description: 'Uploaded and analyzed study material with AI' },
  note_synthesizer: { title: 'Note Architect', description: 'Created 3 or more structured study notes' },
  deck_builder: { title: 'Memory Builder', description: 'Generated 10+ spaced-repetition flashcards' },
  exam_ready: { title: 'Assessment Taker', description: 'Completed an AI-graded practice exam' },
  streak_3: { title: '3-Day Consistency', description: 'Maintained a 3-day daily study streak' },
  streak_7: { title: '7-Day Scholar', description: 'Maintained a full 7-day study streak' },
  hour_scholar: { title: 'First Hour', description: 'Accumulated 60 minutes of focused study' },
  deep_focus_5h: { title: 'Deep Work (5h)', description: 'Accumulated 300 minutes of focused study' },
};

// --- Reschedule Study Plan Task ---
export async function rescheduleStudyPlanTask(taskId: string, scheduledDate: string, startTime?: string) {
  const path = `studyPlanTasks/${taskId}`;
  try {
    const payload: Record<string, unknown> = {
      scheduledDate: scheduledDate.slice(0, 20),
      missed: false,
      updatedAt: serverTimestamp(),
    };
    if (startTime !== undefined) payload.startTime = startTime.slice(0, 20);
    await updateDoc(doc(db, 'studyPlanTasks', taskId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// --- Whiteboards (#20.2) ---
export async function createWhiteboardBoard(
  uid: string,
  input: { subjectId: string; title: string; strokesJson: string; snapshotDataUrl?: string; aiNotes: string }
): Promise<string> {
  const id = makeId('wb');
  const path = `whiteboards/${id}`;
  try {
    await setDoc(doc(db, 'whiteboards', id), {
      ownerId: uid,
      subjectId: input.subjectId || 'general',
      title: input.title.trim().slice(0, 200) || 'Untitled Whiteboard',
      strokesJson: input.strokesJson.slice(0, 290000),
      snapshotDataUrl: (input.snapshotDataUrl || '').slice(0, 240000),
      aiNotes: input.aiNotes.slice(0, 49000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateWhiteboardBoard(
  boardId: string,
  updates: Partial<{ title: string; subjectId: string; strokesJson: string; snapshotDataUrl: string; aiNotes: string }>
) {
  const path = `whiteboards/${boardId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.title !== undefined) payload.title = updates.title.trim().slice(0, 200) || 'Untitled Whiteboard';
    if (updates.subjectId !== undefined) payload.subjectId = updates.subjectId || 'general';
    if (updates.strokesJson !== undefined) payload.strokesJson = updates.strokesJson.slice(0, 290000);
    if (updates.snapshotDataUrl !== undefined) payload.snapshotDataUrl = updates.snapshotDataUrl.slice(0, 240000);
    if (updates.aiNotes !== undefined) payload.aiNotes = updates.aiNotes.slice(0, 49000);
    await updateDoc(doc(db, 'whiteboards', boardId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteWhiteboardBoard(boardId: string) {
  const path = `whiteboards/${boardId}`;
  try {
    await deleteDoc(doc(db, 'whiteboards', boardId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Personal Textbook Builder (#20.3) ---
export async function createTextbook(
  uid: string,
  input: {
    subjectId: string;
    title: string;
    topic: string;
    difficulty: QuizDifficulty;
    chapters: TextbookChapter[];
  }
): Promise<string> {
  const id = makeId('tb');
  const path = `textbooks/${id}`;
  try {
    await setDoc(doc(db, 'textbooks', id), {
      ownerId: uid,
      subjectId: input.subjectId || 'general',
      title: input.title.trim().slice(0, 200) || 'Personal Textbook',
      topic: input.topic.trim().slice(0, 200) || 'Core Curriculum',
      difficulty: input.difficulty,
      chapters: input.chapters.slice(0, 20),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateTextbook(
  bookId: string,
  updates: { title?: string; chapters?: TextbookChapter[] }
) {
  const path = `textbooks/${bookId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.title !== undefined) payload.title = updates.title.trim().slice(0, 200) || 'Personal Textbook';
    if (updates.chapters !== undefined) payload.chapters = updates.chapters.slice(0, 20);
    await updateDoc(doc(db, 'textbooks', bookId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteTextbook(bookId: string) {
  const path = `textbooks/${bookId}`;
  try {
    await deleteDoc(doc(db, 'textbooks', bookId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Mistake Database (#20.6) ---
export async function createMistakeEntry(
  uid: string,
  input: Omit<MistakeEntry, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeId('mist');
  const path = `mistakes/${id}`;
  try {
    await setDoc(doc(db, 'mistakes', id), {
      ownerId: uid,
      subjectId: input.subjectId || 'general',
      topic: input.topic.trim().slice(0, 160) || 'General Concept',
      question: input.question.trim().slice(0, 4000) || 'Practice question',
      studentAnswer: input.studentAnswer.slice(0, 4000),
      correctAnswer: input.correctAnswer.slice(0, 4000),
      misconception: input.misconception.slice(0, 2000),
      explanation: input.explanation.slice(0, 10000),
      practiceQuestion: input.practiceQuestion.slice(0, 4000),
      resolved: Boolean(input.resolved),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateMistakeEntry(
  mistakeId: string,
  updates: Partial<{ resolved: boolean; practiceQuestion: string; explanation: string; misconception: string }>
) {
  const path = `mistakes/${mistakeId}`;
  try {
    await updateDoc(doc(db, 'mistakes', mistakeId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteMistakeEntry(mistakeId: string) {
  const path = `mistakes/${mistakeId}`;
  try {
    await deleteDoc(doc(db, 'mistakes', mistakeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Collaborative Study Rooms (#20.9) ---
export function subscribeAccessibleStudyRooms(
  uid: string,
  onData: (rooms: StudyRoom[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  let memberRooms: StudyRoom[] = [];
  let publicRooms: StudyRoom[] = [];

  const emit = () => {
    const merged = new Map<string, StudyRoom>();
    memberRooms.forEach((r) => merged.set(r.id, r));
    publicRooms.forEach((r) => merged.set(r.id, r));
    onData(Array.from(merged.values()));
  };

  const u1 = onSnapshot(
    query(collection(db, 'studyRooms'), where('memberIds', 'array-contains', uid)),
    (snap) => {
      memberRooms = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as StudyRoom);
      emit();
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, 'studyRooms');
    }
  );

  const u2 = onSnapshot(
    query(collection(db, 'studyRooms'), where('isPublic', '==', true)),
    (snap) => {
      publicRooms = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }) as StudyRoom);
      emit();
    },
    (error) => {
      if (onError) onError(error);
      handleFirestoreError(error, OperationType.LIST, 'studyRooms');
    }
  );

  return () => {
    u1();
    u2();
  };
}

export async function createStudyRoom(
  uid: string,
  input: { name: string; subjectName: string; isPublic: boolean; sharedGoal: string }
): Promise<string> {
  const id = makeId('room');
  const path = `studyRooms/${id}`;
  const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  try {
    await setDoc(doc(db, 'studyRooms', id), {
      ownerId: uid,
      name: input.name.trim().slice(0, 160) || 'Study Group Room',
      subjectName: input.subjectName.trim().slice(0, 120) || 'General Study',
      inviteCode,
      isPublic: Boolean(input.isPublic),
      memberIds: [uid],
      sharedNotes: `# ${input.name.trim() || 'Study Group'}\n\nShared group notes — edits sync live for all room members.`,
      sharedGoal: input.sharedGoal.trim().slice(0, 400) || 'Complete one collaborative practice round together.',
      quizSessionJson: '{}',
      mindMapNodes: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function joinStudyRoomById(uid: string, roomId: string): Promise<boolean> {
  const cleanId = roomId.trim();
  const path = `studyRooms/${cleanId}`;
  try {
    const snap = await getDoc(doc(db, 'studyRooms', cleanId));
    if (!snap.exists()) return false;
    await updateDoc(doc(db, 'studyRooms', cleanId), {
      memberIds: arrayUnion(uid),
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateStudyRoom(
  roomId: string,
  updates: Partial<{
    name: string;
    isPublic: boolean;
    sharedNotes: string;
    sharedGoal: string;
    quizSessionJson: string;
    mindMapNodes: Array<{ id: string; text: string; author: string }>;
  }>
) {
  const path = `studyRooms/${roomId}`;
  try {
    await updateDoc(doc(db, 'studyRooms', roomId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteStudyRoom(roomId: string) {
  const path = `studyRooms/${roomId}`;
  try {
    await deleteDoc(doc(db, 'studyRooms', roomId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Lesson Sessions (#20.1 AI Teacher Mode & #20.12 Replay) ---
export async function createLessonSession(
  uid: string,
  input: Omit<LessonSession, 'id' | 'ownerId' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  const id = makeId('lesson');
  const path = `lessonSessions/${id}`;
  try {
    await setDoc(doc(db, 'lessonSessions', id), {
      ownerId: uid,
      subjectId: input.subjectId || 'general',
      topic: input.topic.trim().slice(0, 200) || 'Guided Lesson',
      stage: Math.min(Math.max(Number(input.stage) || 0, 0), 10),
      status: input.status,
      transcript: input.transcript.slice(0, 80),
      notesContent: input.notesContent.slice(0, 99000),
      score: Math.min(Math.max(Number(input.score) || 0, 0), 100),
      durationMinutes: Math.min(Math.max(Number(input.durationMinutes) || 0, 0), 600),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateLessonSession(
  lessonId: string,
  updates: Partial<{
    stage: number;
    status: 'active' | 'paused' | 'completed';
    transcript: Array<{ role: string; text: string }>;
    notesContent: string;
    score: number;
    durationMinutes: number;
  }>
) {
  const path = `lessonSessions/${lessonId}`;
  try {
    await updateDoc(doc(db, 'lessonSessions', lessonId), {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteLessonSession(lessonId: string) {
  const path = `lessonSessions/${lessonId}`;
  try {
    await deleteDoc(doc(db, 'lessonSessions', lessonId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- AI Telemetry Logs (#21 Gemini Control Centre) ---
export async function recordAiTelemetryLog(
  uid: string,
  input: {
    endpoint: string;
    modelUsed: string;
    status: 'success' | 'error';
    promptTokens: number;
    outputTokens: number;
    durationMs: number;
    summary: string;
  }
) {
  const id = makeId('ailog');
  const path = `aiTelemetryLogs/${id}`;
  try {
    await setDoc(doc(db, 'aiTelemetryLogs', id), {
      ownerId: uid,
      endpoint: input.endpoint.slice(0, 120),
      modelUsed: input.modelUsed.slice(0, 80),
      status: input.status,
      promptTokens: Math.max(0, Math.round(input.promptTokens || 0)),
      outputTokens: Math.max(0, Math.round(input.outputTokens || 0)),
      durationMs: Math.max(0, Math.round(input.durationMs || 0)),
      summary: input.summary.slice(0, 400),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

// --- Study Podcasts ---
export async function createStudyPodcast(
  uid: string,
  input: {
    subjectId: string;
    title: string;
    topic: string;
    hostStyle: PodcastStyle;
    turns: PodcastTurn[];
    takeaways: string[];
    estimatedMinutes: number;
  }
): Promise<string> {
  const id = makeId('pod');
  const path = `studyPodcasts/${id}`;
  const safeTurns = input.turns.slice(0, 40);
  if (safeTurns.length === 0) throw new Error('Podcast script returned no dialogue turns.');
  try {
    await setDoc(doc(db, 'studyPodcasts', id), {
      ownerId: uid,
      subjectId: input.subjectId || 'general',
      title: input.title.trim().slice(0, 200) || 'Study Podcast Episode',
      topic: input.topic.trim().slice(0, 200) || 'Revision Deep Dive',
      hostStyle: input.hostStyle,
      turns: safeTurns,
      takeaways: input.takeaways.slice(0, 20).map((t) => t.slice(0, 400)),
      estimatedMinutes: Math.min(Math.max(Math.round(input.estimatedMinutes || 4), 1), 60),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteStudyPodcast(podcastId: string) {
  const path = `studyPodcasts/${podcastId}`;
  try {
    await deleteDoc(doc(db, 'studyPodcasts', podcastId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Feynman Teach-Back Sessions ---
export async function createFeynmanSession(
  uid: string,
  input: {
    subjectId: string;
    topic: string;
    explanationText: string;
    overallScore: number;
    scores: FeynmanScores;
    blindSpots: string[];
    jargonFlags: string[];
    followUpQuestions: string[];
    refinedSummary: string;
  }
): Promise<string> {
  const id = makeId('feyn');
  const path = `feynmanSessions/${id}`;
  try {
    await setDoc(doc(db, 'feynmanSessions', id), {
      ownerId: uid,
      subjectId: input.subjectId || 'general',
      topic: input.topic.trim().slice(0, 200) || 'Concept Teach-Back',
      explanationText: input.explanationText.trim().slice(0, 29500) || 'Explanation',
      overallScore: Math.min(Math.max(Math.round(input.overallScore), 0), 100),
      scores: input.scores,
      blindSpots: input.blindSpots.slice(0, 20).map((s) => s.slice(0, 400)),
      jargonFlags: input.jargonFlags.slice(0, 20).map((s) => s.slice(0, 300)),
      followUpQuestions: input.followUpQuestions.slice(0, 10).map((s) => s.slice(0, 500)),
      refinedSummary: input.refinedSummary.slice(0, 14500),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteFeynmanSession(sessionId: string) {
  const path = `feynmanSessions/${sessionId}`;
  try {
    await deleteDoc(doc(db, 'feynmanSessions', sessionId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Citations & Bibliography ---
export async function createCitationEntry(
  uid: string,
  input: {
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
  }
): Promise<string> {
  const id = makeId('cit');
  const path = `citations/${id}`;
  try {
    await setDoc(doc(db, 'citations', id), {
      ownerId: uid,
      subjectId: input.subjectId || 'general',
      title: input.title.trim().slice(0, 300) || 'Untitled Source',
      authors: input.authors.slice(0, 300),
      year: input.year.slice(0, 20),
      sourceType: input.sourceType,
      url: input.url.slice(0, 600),
      inText: input.inText.slice(0, 200),
      apa: input.apa.slice(0, 1500),
      mla: input.mla.slice(0, 1500),
      chicago: input.chicago.slice(0, 1500),
      harvard: input.harvard.slice(0, 1500),
      ieee: input.ieee.slice(0, 1500),
      bibtex: input.bibtex.slice(0, 2500),
      annotation: input.annotation.slice(0, 4000),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteCitationEntry(citationId: string) {
  const path = `citations/${citationId}`;
  try {
    await deleteDoc(doc(db, 'citations', citationId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Exam Cheat Sheets ---
export async function createCheatSheet(
  uid: string,
  input: {
    subjectId: string;
    title: string;
    layoutColumns: 2 | 3;
    sections: CheatSheetSection[];
  }
): Promise<string> {
  const id = makeId('sheet');
  const path = `cheatSheets/${id}`;
  const safeSections = input.sections.slice(0, 24);
  if (safeSections.length === 0) throw new Error('Cheat sheet returned no sections.');
  try {
    await setDoc(doc(db, 'cheatSheets', id), {
      ownerId: uid,
      subjectId: input.subjectId || 'general',
      title: input.title.trim().slice(0, 200) || 'Exam Cheat Sheet',
      layoutColumns: input.layoutColumns === 3 ? 3 : 2,
      sections: safeSections,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateCheatSheet(
  sheetId: string,
  updates: { title?: string; layoutColumns?: 2 | 3; sections?: CheatSheetSection[] }
) {
  const path = `cheatSheets/${sheetId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.title !== undefined) payload.title = updates.title.trim().slice(0, 200) || 'Exam Cheat Sheet';
    if (updates.layoutColumns !== undefined) payload.layoutColumns = updates.layoutColumns === 3 ? 3 : 2;
    if (updates.sections !== undefined) payload.sections = updates.sections.slice(0, 24);
    await updateDoc(doc(db, 'cheatSheets', sheetId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCheatSheet(sheetId: string) {
  const path = `cheatSheets/${sheetId}`;
  try {
    await deleteDoc(doc(db, 'cheatSheets', sheetId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// --- Grade & GPA Tracker ---
export async function createGradeCourse(
  uid: string,
  input: {
    subjectId: string;
    courseName: string;
    code: string;
    credits: number;
    targetGradePercent: number;
    categories: GradeCategoryItem[];
  }
): Promise<string> {
  const id = makeId('course');
  const path = `gradeCourses/${id}`;
  try {
    await setDoc(doc(db, 'gradeCourses', id), {
      ownerId: uid,
      subjectId: input.subjectId || 'general',
      courseName: input.courseName.trim().slice(0, 160) || 'Untitled Course',
      code: input.code.trim().slice(0, 32),
      credits: Math.min(Math.max(Number(input.credits) || 3, 0.5), 30),
      targetGradePercent: Math.min(Math.max(Number(input.targetGradePercent) || 90, 1), 100),
      categories: input.categories.slice(0, 20),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateGradeCourse(
  courseId: string,
  updates: Partial<{
    courseName: string;
    code: string;
    credits: number;
    targetGradePercent: number;
    categories: GradeCategoryItem[];
  }>
) {
  const path = `gradeCourses/${courseId}`;
  try {
    const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
    if (updates.courseName !== undefined) payload.courseName = updates.courseName.trim().slice(0, 160) || 'Untitled Course';
    if (updates.code !== undefined) payload.code = updates.code.trim().slice(0, 32);
    if (updates.credits !== undefined) payload.credits = Math.min(Math.max(Number(updates.credits) || 3, 0.5), 30);
    if (updates.targetGradePercent !== undefined) {
      payload.targetGradePercent = Math.min(Math.max(Number(updates.targetGradePercent) || 90, 1), 100);
    }
    if (updates.categories !== undefined) payload.categories = updates.categories.slice(0, 20);
    await updateDoc(doc(db, 'gradeCourses', courseId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteGradeCourse(courseId: string) {
  const path = `gradeCourses/${courseId}`;
  try {
    await deleteDoc(doc(db, 'gradeCourses', courseId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}


