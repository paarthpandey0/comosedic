import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  AlertTriangle,
  Archive,
  Atom,
  Award,
  BarChart3,
  Bell,
  BookMarked,
  BookOpen,
  Brain,
  BrainCircuit,
  Calculator,
  Calendar,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Command,
  Compass,
  Download,
  FileAudio,
  FileCheck2,
  FileEdit,
  FilePlus2,
  FileSpreadsheet,
  Film,
  Folder,
  GraduationCap,
  Headphones,
  History,
  Languages,
  Layers,
  LayoutDashboard,
  Lightbulb,
  Menu,
  MessageSquare,
  Mic,
  Moon,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PenTool,
  Play,
  Plus,
  Quote,
  Scale,
  Search,
  Settings,
  Sliders,
  Sun,
  Timer,
  Trophy,
  Upload,
  Users,
  X,
} from 'lucide-react';
import { auth } from './firebase';
import {
  createSubject,
  DEFAULT_NOTIFICATION_PREFS,
  ensureAcademicMemory,
  ensureUserProfile,
  getTodayIsoDate,
  subscribeAcademicMemory,
  subscribeAccessibleStudyRooms,
  subscribeOwnerCollection,
  subscribeUserProfile,
  updateAcademicMemory,
  updateSubject,
  updateUserSettings,
} from './services/studyDb';
import type {
  AcademicMemory,
  AiTelemetryLog,
  AppSection,
  CheatSheet,
  CitationEntry,
  FeynmanSession,
  Flashcard,
  GradeCourse,
  HomeworkItem,
  InteractiveModule,
  LessonSession,
  MindMap,
  MistakeEntry,
  Quiz,
  StudyNote,
  StudyPlanTask,
  StudyPodcast,
  StudyResource,
  StudyRoom,
  StudySession,
  Subject,
  Textbook,
  ThemeMode,
  TutorMessage,
  UserProfile,
  VocabItem,
  WhiteboardBoard,
  WorkspaceTab,
} from './types';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthGate } from './components/AuthGate';
import { DashboardView } from './components/DashboardView';
import { SubjectWorkspaceView } from './components/SubjectWorkspaceView';
import { GlobalTutorView } from './components/GlobalTutorView';
import { VoiceTutorView } from './components/VoiceTutorView';
import { TeacherModeView } from './components/TeacherModeView';
import { WhiteboardView } from './components/WhiteboardView';
import { TextbookBuilderView } from './components/TextbookBuilderView';
import { VideoLearningView } from './components/VideoLearningView';
import { PodcastStudioView } from './components/PodcastStudioView';
import { LectureStudioView } from './components/LectureStudioView';
import { FeynmanArenaView } from './components/FeynmanArenaView';
import { StemSandboxView } from './components/StemSandboxView';
import { CitationStudioView } from './components/CitationStudioView';
import { CheatSheetBuilderView } from './components/CheatSheetBuilderView';
import { DebateArenaView } from './components/DebateArenaView';
import { GradeTrackerView } from './components/GradeTrackerView';
import { MistakeDatabaseView } from './components/MistakeDatabaseView';
import { ExplanationStudioView } from './components/ExplanationStudioView';
import { StudyRoomsView } from './components/StudyRoomsView';
import { ResourceDiscoveryView } from './components/ResourceDiscoveryView';
import { SessionReplayView } from './components/SessionReplayView';
import { ScienceLabView } from './components/ScienceLabView';
import { WritingLabView } from './components/WritingLabView';
import { KnowledgeVaultView } from './components/KnowledgeVaultView';
import { ControlCentreView } from './components/ControlCentreView';
import { HomeworkView } from './components/HomeworkView';
import { MindMapView } from './components/MindMapView';
import { LanguageLabView } from './components/LanguageLabView';
import { BattleModeView } from './components/BattleModeView';
import { StudyPlannerView } from './components/StudyPlannerView';
import { AnalyticsView } from './components/AnalyticsView';
import { LibrarySearchView } from './components/LibrarySearchView';
import { FocusModeView } from './components/FocusModeView';
import { ExportCentreView } from './components/ExportCentreView';
import { AcademicMemoryView } from './components/AcademicMemoryView';
import { SettingsView } from './components/SettingsView';
import { SubjectModal } from './components/SubjectModal';
import { FlashcardsStudioView } from './components/FlashcardsStudioView';
import { PdfSolverView } from './components/PdfSolverView';

const THEME_STORAGE_KEY = 'lumina-theme';

function getInitialTheme(): ThemeMode {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // Ignore storage access errors in restricted frames
  }
  return 'light';
}

interface SmartNotification {
  id: string;
  title: string;
  detail: string;
  actionLabel: string;
  onAction: () => void;
}

function StudyPlatformShell() {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [academicMemory, setAcademicMemory] = useState<AcademicMemory | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [resources, setResources] = useState<StudyResource[]>([]);
  const [notes, setNotes] = useState<StudyNote[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [tutorMessages, setTutorMessages] = useState<TutorMessage[]>([]);
  const [tasks, setTasks] = useState<StudyPlanTask[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [mindMaps, setMindMaps] = useState<MindMap[]>([]);
  const [homeworkItems, setHomeworkItems] = useState<HomeworkItem[]>([]);
  const [vocabItems, setVocabItems] = useState<VocabItem[]>([]);
  const [interactiveModules, setInteractiveModules] = useState<InteractiveModule[]>([]);
  const [whiteboards, setWhiteboards] = useState<WhiteboardBoard[]>([]);
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  const [mistakes, setMistakes] = useState<MistakeEntry[]>([]);
  const [studyRooms, setStudyRooms] = useState<StudyRoom[]>([]);
  const [lessonSessions, setLessonSessions] = useState<LessonSession[]>([]);
  const [aiTelemetryLogs, setAiTelemetryLogs] = useState<AiTelemetryLog[]>([]);
  const [studyPodcasts, setStudyPodcasts] = useState<StudyPodcast[]>([]);
  const [feynmanSessions, setFeynmanSessions] = useState<FeynmanSession[]>([]);
  const [citations, setCitations] = useState<CitationEntry[]>([]);
  const [cheatSheets, setCheatSheets] = useState<CheatSheet[]>([]);
  const [gradeCourses, setGradeCourses] = useState<GradeCourse[]>([]);

  const [section, setSection] = useState<AppSection>('dashboard');
  const [activeSubjectId, setActiveSubjectId] = useState<string>('');
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('overview');
  const [quickTutorPrompt, setQuickTutorPrompt] = useState<string | undefined>(undefined);
  const [quickTutorSubjectId, setQuickTutorSubjectId] = useState<string | undefined>(undefined);

  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem('lumina-sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  });
  const [moreStudiosOpen, setMoreStudiosOpen] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [distractionFree, setDistractionFree] = useState(false);
  const [subjectModalOpen, setSubjectModalOpen] = useState(false);
  const [editingSubject, setEditingSubject] = useState<Subject | null>(null);

  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');

  const quickCreateRef = useRef<HTMLDivElement | null>(null);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      setAuthReady(true);
      if (user) {
        const [prof] = await Promise.all([
          ensureUserProfile(user),
          ensureAcademicMemory(user.uid),
        ]);
        try {
          const localSaved = window.localStorage.getItem(THEME_STORAGE_KEY);
          if (!localSaved && (prof.theme === 'light' || prof.theme === 'dark')) {
            setTheme(prof.theme);
          }
        } catch {
          // ignore
        }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem('lumina-sidebar-collapsed', String(sidebarCollapsed));
    } catch {
      // ignore storage errors
    }
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!authUser) return;
    const uid = authUser.uid;
    const unsubs = [
      subscribeUserProfile(uid, (prof) => {
        setProfile(prof);
      }),
      subscribeAcademicMemory(uid, (mem) => setAcademicMemory(mem)),
      subscribeOwnerCollection<Subject>('subjects', uid, setSubjects),
      subscribeOwnerCollection<StudyResource>('resources', uid, setResources),
      subscribeOwnerCollection<StudyNote>('notes', uid, setNotes),
      subscribeOwnerCollection<Flashcard>('flashcards', uid, setFlashcards),
      subscribeOwnerCollection<Quiz>('quizzes', uid, setQuizzes),
      subscribeOwnerCollection<TutorMessage>('tutorMessages', uid, setTutorMessages),
      subscribeOwnerCollection<StudyPlanTask>('studyPlanTasks', uid, setTasks),
      subscribeOwnerCollection<StudySession>('studySessions', uid, setSessions),
      subscribeOwnerCollection<MindMap>('mindMaps', uid, setMindMaps),
      subscribeOwnerCollection<HomeworkItem>('homeworkItems', uid, setHomeworkItems),
      subscribeOwnerCollection<VocabItem>('vocabItems', uid, setVocabItems),
      subscribeOwnerCollection<InteractiveModule>('interactiveModules', uid, setInteractiveModules),
      subscribeOwnerCollection<WhiteboardBoard>('whiteboards', uid, setWhiteboards),
      subscribeOwnerCollection<Textbook>('textbooks', uid, setTextbooks),
      subscribeOwnerCollection<MistakeEntry>('mistakes', uid, setMistakes),
      subscribeOwnerCollection<LessonSession>('lessonSessions', uid, setLessonSessions),
      subscribeOwnerCollection<AiTelemetryLog>('aiTelemetryLogs', uid, setAiTelemetryLogs),
      subscribeOwnerCollection<StudyPodcast>('studyPodcasts', uid, setStudyPodcasts),
      subscribeOwnerCollection<FeynmanSession>('feynmanSessions', uid, setFeynmanSessions),
      subscribeOwnerCollection<CitationEntry>('citations', uid, setCitations),
      subscribeOwnerCollection<CheatSheet>('cheatSheets', uid, setCheatSheets),
      subscribeOwnerCollection<GradeCourse>('gradeCourses', uid, setGradeCourses),
      subscribeAccessibleStudyRooms(uid, setStudyRooms),
    ];
    return () => unsubs.forEach((u) => u());
  }, [authUser]);

  // Global Cmd/Ctrl + K command palette + click-outside popovers
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setCommandOpen(false);
        setQuickCreateOpen(false);
        setNotificationsOpen(false);
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (quickCreateRef.current && !quickCreateRef.current.contains(target)) {
        setQuickCreateOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(target)) {
        setNotificationsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onMouseDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onMouseDown);
    };
  }, []);

  useEffect(() => {
    if (commandOpen) {
      setTimeout(() => commandInputRef.current?.focus(), 40);
    } else {
      setCommandQuery('');
    }
  }, [commandOpen]);

  const activeSubject = useMemo(
    () => subjects.find((s) => s.id === activeSubjectId) || subjects[0] || null,
    [subjects, activeSubjectId]
  );

  const folders = useMemo(() => {
    const map = new Map<string, Subject[]>();
    subjects.forEach((s) => {
      const f = s.folder || 'General';
      const arr = map.get(f) || [];
      arr.push(s);
      map.set(f, arr);
    });
    return Array.from(map.entries());
  }, [subjects]);

  const recentSubjects = useMemo(() => {
    const ids = academicMemory?.recentSubjectIds || [];
    return ids
      .map((id) => subjects.find((s) => s.id === id))
      .filter((s): s is Subject => Boolean(s))
      .slice(0, 4);
  }, [academicMemory?.recentSubjectIds, subjects]);

  const handleToggleTheme = async (next: ThemeMode) => {
    setTheme(next);
    if (authUser) {
      await updateUserSettings(authUser.uid, { theme: next }).catch(() => {});
    }
  };

  const handleOpenSubject = (subjectId: string, tab: WorkspaceTab = 'overview') => {
    setActiveSubjectId(subjectId);
    setWorkspaceTab(tab);
    setSection('workspace');
    setMobileMenuOpen(false);

    if (authUser && subjectId) {
      const current = academicMemory?.recentSubjectIds || [];
      const next = [subjectId, ...current.filter((id) => id !== subjectId)].slice(0, 5);
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        void updateAcademicMemory(authUser.uid, { recentSubjectIds: next }).catch(() => {});
      }
    }
  };

  const handleStartStudying = () => {
    const nowIso = new Date().toISOString();
    const dueCard = flashcards.find((c) => c.nextReviewAt <= nowIso);
    if (dueCard) {
      handleOpenSubject(dueCard.subjectId, 'flashcards');
      return;
    }
    setSection('focus');
  };

  const smartNotifications = useMemo<SmartNotification[]>(() => {
    const prefs = academicMemory?.notificationPrefs || DEFAULT_NOTIFICATION_PREFS;
    const alerts: SmartNotification[] = [];
    const now = new Date();
    const todayIso = getTodayIsoDate();

    if (prefs.examReminders) {
      subjects.forEach((s) => {
        if (!s.examDate) return;
        const diffDays = Math.ceil((new Date(s.examDate).getTime() - now.getTime()) / 86400000);
        if (diffDays >= 0 && diffDays <= 14) {
          alerts.push({
            id: `exam_${s.id}_${s.examDate}`,
            title: `${s.name} exam in ${diffDays === 0 ? 'today' : `${diffDays}d`}`,
            detail: `Scheduled for ${s.examDate} · Run an exam-style practice check.`,
            actionLabel: 'Open Quizzes',
            onAction: () => {
              handleOpenSubject(s.id, 'quizzes');
              setNotificationsOpen(false);
            },
          });
        }
      });
    }

    if (prefs.flashcardDueAlerts) {
      const nowIso = now.toISOString();
      const dueCards = flashcards.filter((c) => c.nextReviewAt <= nowIso);
      if (dueCards.length > 0) {
        const firstSubjId = dueCards[0].subjectId;
        alerts.push({
          id: `due_cards_${dueCards.length}`,
          title: `${dueCards.length} spaced-repetition card${dueCards.length === 1 ? '' : 's'} due`,
          detail: 'Review now while recall is near the forgetting threshold.',
          actionLabel: 'Review Deck',
          onAction: () => {
            handleOpenSubject(firstSubjId, 'flashcards');
            setNotificationsOpen(false);
          },
        });
      }
    }

    if (prefs.unfinishedSessionAlerts) {
      const unfinishedToday = tasks.filter((t) => t.scheduledDate === todayIso && !t.completed);
      if (unfinishedToday.length > 0) {
        alerts.push({
          id: `today_tasks_${unfinishedToday.length}`,
          title: `${unfinishedToday.length} task${unfinishedToday.length === 1 ? '' : 's'} remaining today`,
          detail: unfinishedToday[0].title,
          actionLabel: 'View Planner',
          onAction: () => {
            setSection('planner');
            setNotificationsOpen(false);
          },
        });
      }
    }

    if (prefs.weeklySummaryAlerts && !academicMemory?.weeklyReport && (quizzes.length > 0 || sessions.length > 0)) {
      alerts.push({
        id: 'weekly_report_ready',
        title: 'AI Weekly Learning Report ready',
        detail: 'Generate your personalized mistake & mastery analysis.',
        actionLabel: 'Open Analytics',
        onAction: () => {
          setSection('analytics');
          setNotificationsOpen(false);
        },
      });
    }

    return alerts.filter((a) => !dismissedAlerts.includes(a.id));
  }, [academicMemory, subjects, flashcards, tasks, quizzes.length, sessions.length, dismissedAlerts]);

  const moreStudioItems: Array<{ id: AppSection; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'whiteboard', label: 'AI Whiteboard', icon: PenTool },
    { id: 'textbooks', label: 'Textbook Builder', icon: BookMarked },
    { id: 'cheatsheets', label: 'Cheat-Sheet Builder', icon: FileSpreadsheet },
    { id: 'video_studio', label: 'Video Storyboards', icon: Film },
    { id: 'explain_studio', label: 'Explanation Studio', icon: Lightbulb },
  ];

  const isMoreStudioActive = moreStudioItems.some((item) => item.id === section);

  const navGroups: Array<{
    title: string;
    hasMoreStudios?: boolean;
    items: Array<{ id: AppSection; label: string; icon: typeof LayoutDashboard }>;
  }> = [
    {
      title: 'Core',
      items: [
        { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { id: 'flashcards_studio', label: 'Flashcards Studio', icon: Layers },
        { id: 'pdf_solver', label: 'PDF Worksheet Solver', icon: FileCheck2 },
        { id: 'tutor', label: 'AI Tutor', icon: MessageSquare },
        { id: 'focus', label: 'Focus Timer', icon: Timer },
      ],
    },
    {
      title: 'Classroom & Studio',
      hasMoreStudios: true,
      items: [
        { id: 'teacher', label: 'AI Teacher Mode', icon: GraduationCap },
        { id: 'voice_tutor', label: 'Voice Tutor', icon: Mic },
        { id: 'homework', label: 'Homework Help', icon: ClipboardCheck },
        { id: 'podcasts', label: 'AI Study Podcasts', icon: Headphones },
        { id: 'lecture_notes', label: 'Lecture Transcriber', icon: FileAudio },
      ],
    },
    {
      title: 'Practice & Labs',
      items: [
        { id: 'feynman', label: 'Feynman Teach-Back', icon: Brain },
        { id: 'debate', label: 'Socratic Debate Arena', icon: Scale },
        { id: 'stem_sandbox', label: 'STEM Graph & Code Lab', icon: Calculator },
        { id: 'citations', label: 'Citation Studio', icon: Quote },
        { id: 'mistakes', label: 'Mistake Database', icon: AlertTriangle },
        { id: 'study_rooms', label: 'Group Study Rooms', icon: Users },
        { id: 'science_lab', label: 'Science Lab', icon: Atom },
        { id: 'writing_lab', label: 'Writing Lab', icon: FileEdit },
        { id: 'discovery', label: 'Resource Discovery', icon: Compass },
        { id: 'mindmaps', label: 'Mind Maps & Graph', icon: Network },
        { id: 'language_lab', label: 'Language Lab', icon: Languages },
        { id: 'battle', label: 'Battle & Badges', icon: Trophy },
        { id: 'planner', label: 'Smart Calendar', icon: Calendar },
      ],
    },
    {
      title: 'Insights & Vault',
      items: [
        { id: 'grade_tracker', label: 'Grades & Habits', icon: Award },
        { id: 'analytics', label: 'AI Intelligence & Prep', icon: BarChart3 },
        { id: 'vault', label: 'Knowledge Vault', icon: Archive },
        { id: 'session_replay', label: 'Session Replay', icon: History },
        { id: 'library', label: 'Search Everything', icon: Search },
        { id: 'memory', label: 'Academic Memory', icon: BrainCircuit },
        { id: 'export_centre', label: 'Export Centre', icon: Download },
        { id: 'control_centre', label: 'Gemini Control Centre', icon: Sliders },
      ],
    },
  ];

  const allNavItems = useMemo(
    () => [...navGroups.flatMap((g) => g.items), ...moreStudioItems],
    []
  );

  const commandResults = useMemo(() => {
    const q = commandQuery.trim().toLowerCase();
    const matchedNav = allNavItems.filter(
      (n) => !q || n.label.toLowerCase().includes(q)
    );
    const matchedSubjects = subjects.filter(
      (s) => !q || s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q)
    );
    return { matchedNav, matchedSubjects };
  }, [commandQuery, allNavItems, subjects]);

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-[#131720] text-sm text-slate-500">
        Loading workspace...
      </div>
    );
  }

  if (!authUser) {
    return (
      <AuthGate
        theme={theme}
        onToggleTheme={() => void handleToggleTheme(theme === 'light' ? 'dark' : 'light')}
      />
    );
  }

  const sectionLabels: Record<AppSection, string> = {
    dashboard: 'Dashboard',
    workspace: `Workspace / ${activeSubject?.name || 'Subject'}`,
    flashcards_studio: 'Interactive Flashcards Studio',
    pdf_solver: 'In-Place PDF Worksheet Solver',
    tutor: 'Personal AI Tutor',
    voice_tutor: 'Real-Time AI Voice Tutor',
    teacher: 'AI Teacher Mode Classroom',
    whiteboard: 'Interactive AI Whiteboard',
    textbooks: 'Personal Textbook Builder',
    video_studio: 'AI Video Learning & Storyboards',
    podcasts: 'AI Study Podcast Studio',
    lecture_notes: 'Lecture Audio Transcriber & Cornell Notes',
    feynman: 'Feynman Teach-Back Mastery Arena',
    stem_sandbox: 'STEM Graphing, Units & Code Sandbox',
    citations: 'Citation & Bibliography Studio',
    cheatsheets: 'Exam Cheat-Sheet Builder',
    debate: 'Socratic Debate & Fallacy Arena',
    grade_tracker: 'Grade Calculator, Final Exam Solver & Habits',
    homework: 'Smart Homework Assistant',
    mistakes: 'Mistake & Misconception Database',
    explain_studio: 'AI Explanation Studio',
    study_rooms: 'Collaborative Study Rooms',
    discovery: 'AI Study Resource Discovery',
    session_replay: 'Study Session Replay & Recaps',
    science_lab: 'Interactive Science Lab',
    writing_lab: 'AI Essay & Writing Lab',
    vault: 'Personal Knowledge Vault',
    control_centre: 'Gemini Control Centre & Models',
    mindmaps: 'AI Mind Maps & Knowledge Graph',
    language_lab: 'AI Language Learning Lab',
    battle: 'Revision Battle, XP & Mastery Tiers',
    planner: 'Smart Calendar & Study Planner',
    analytics: 'AI Learning Intelligence & Exam Prep',
    library: 'Universal Search & Bookmarks',
    focus: 'AI Study Focus Timer',
    export_centre: 'Export & Print Centre',
    memory: 'Personal Academic Memory',
    settings: 'Profile & Settings',
  };

  return (
    <div className="min-h-screen flex bg-[#F8FAFC] dark:bg-[#131720] text-[#0F172A] dark:text-[#F1F5F9]">
      {/* Sidebar */}
      {!distractionFree && (
        <aside
          className={`fixed inset-y-0 left-0 z-40 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#181D27] flex flex-col transition-all duration-200 lg:static lg:translate-x-0 shrink-0 ${
            sidebarCollapsed ? 'w-64 lg:w-[72px]' : 'w-64'
          } ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div
            className={`py-4 border-b border-slate-200 dark:border-slate-800 flex items-center ${
              sidebarCollapsed ? 'px-4 lg:px-3 justify-between lg:justify-center' : 'px-5 justify-between'
            }`}
          >
            <button
              type="button"
              onClick={() => {
                setSection('dashboard');
                setMobileMenuOpen(false);
              }}
              className={`font-display font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap ${
                sidebarCollapsed ? 'text-lg lg:hidden' : 'text-lg'
              }`}
            >
              Lumina Study
            </button>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSidebarCollapsed((c) => !c)}
                className="hidden lg:inline-flex items-center justify-center p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen className="w-4 h-4" />
                ) : (
                  <PanelLeftClose className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="lg:hidden p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                aria-label="Close navigation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div
            className={`flex-1 overflow-y-auto py-4 space-y-5 ${
              sidebarCollapsed ? 'px-3 lg:px-2' : 'px-3'
            }`}
          >
            {navGroups.map((group) => (
              <div key={group.title} className="space-y-1">
                <p
                  className={`px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 ${
                    sidebarCollapsed ? 'lg:hidden' : ''
                  }`}
                >
                  {group.title}
                </p>
                {sidebarCollapsed && group.title !== 'Core' && (
                  <div className="hidden lg:block mx-2 my-2 border-t border-slate-200/70 dark:border-slate-800" />
                )}
                <nav className="space-y-0.5">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = section === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSection(item.id);
                          setMobileMenuOpen(false);
                        }}
                        title={sidebarCollapsed ? item.label : undefined}
                        className={`w-full flex items-center rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                          sidebarCollapsed
                            ? 'gap-3 px-3 py-2 lg:justify-center lg:px-0 lg:py-2.5'
                            : 'gap-3 px-3 py-2'
                        } ${
                          active
                            ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className={sidebarCollapsed ? 'lg:hidden' : ''}>{item.label}</span>
                      </button>
                    );
                  })}

                  {/* Collapsible 'More Studios' Accordion */}
                  {group.hasMoreStudios && (
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (sidebarCollapsed) {
                            setSidebarCollapsed(false);
                            setMoreStudiosOpen(true);
                          } else {
                            setMoreStudiosOpen((o) => !o);
                          }
                        }}
                        title={sidebarCollapsed ? 'More Studios' : undefined}
                        aria-expanded={moreStudiosOpen || isMoreStudioActive}
                        className={`w-full flex items-center rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                          sidebarCollapsed
                            ? 'justify-between px-3 py-2 lg:justify-center lg:px-0 lg:py-2.5'
                            : 'justify-between px-3 py-2'
                        } ${
                          isMoreStudioActive
                            ? 'text-indigo-700 dark:text-indigo-300 bg-indigo-50/60 dark:bg-indigo-950/30'
                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100/80 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <span className="flex items-center gap-2.5">
                          <ChevronRight
                            className={`w-3.5 h-3.5 shrink-0 transition-transform duration-200 ${
                              moreStudiosOpen || isMoreStudioActive ? 'rotate-90' : ''
                            }`}
                          />
                          <span className={sidebarCollapsed ? 'lg:hidden' : ''}>More Studios</span>
                        </span>
                        <span
                          className={`text-[10px] font-mono tabular-nums text-slate-400 dark:text-slate-500 ${
                            sidebarCollapsed ? 'lg:hidden' : ''
                          }`}
                        >
                          {moreStudioItems.length}
                        </span>
                      </button>

                      {(moreStudiosOpen || isMoreStudioActive) && (
                        <div
                          className={`mt-0.5 space-y-0.5 pl-3 border-l border-slate-200/80 dark:border-slate-800 ml-3.5 ${
                            sidebarCollapsed ? 'lg:hidden' : ''
                          }`}
                        >
                          {moreStudioItems.map((item) => {
                            const Icon = item.icon;
                            const active = section === item.id;
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                  setSection(item.id);
                                  setMobileMenuOpen(false);
                                }}
                                className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-[13px] font-medium transition-colors whitespace-nowrap ${
                                  active
                                    ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
                                }`}
                              >
                                <Icon className="w-3.5 h-3.5 shrink-0" />
                                <span>{item.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </nav>
              </div>
            ))}

            {/* Recently Opened Workspaces */}
            {recentSubjects.length > 0 && (
              <div className={`space-y-1 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                <p className="px-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  <Clock className="w-3 h-3" />
                  <span>Recent Workspaces</span>
                </p>
                <div className="space-y-0.5">
                  {recentSubjects.map((s) => {
                    const isSelected = section === 'workspace' && activeSubject?.id === s.id;
                    return (
                      <button
                        key={`recent_${s.id}`}
                        type="button"
                        onClick={() => handleOpenSubject(s.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs transition-colors text-left ${
                          isSelected
                            ? 'bg-slate-100 dark:bg-slate-800 font-semibold text-slate-900 dark:text-white'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <BookOpen className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                        <span className="truncate">{s.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Subject Workspaces by Folder */}
            <div className={`space-y-2.5 ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
              <div className="px-3 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Subjects
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setEditingSubject(null);
                    setSubjectModalOpen(true);
                  }}
                  className="p-1 rounded-md text-slate-500 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Create new subject"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {subjects.length === 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingSubject(null);
                    setSubjectModalOpen(true);
                  }}
                  className="w-full px-3 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500 hover:border-indigo-500 text-left"
                >
                  + Add your first subject
                </button>
              ) : (
                <div className="space-y-3">
                  {folders.map(([folderName, list]) => (
                    <div key={folderName} className="space-y-1">
                      <div className="px-3 flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                        <Folder className="w-3 h-3" />
                        <span className="truncate">{folderName}</span>
                      </div>
                      {list.map((s) => {
                        const isSelected = section === 'workspace' && activeSubject?.id === s.id;
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => handleOpenSubject(s.id)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors text-left ${
                              isSelected
                                ? 'bg-slate-100 dark:bg-slate-800 font-semibold text-slate-900 dark:text-white'
                                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                            }`}
                          >
                            <BookOpen className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                            <span className="truncate">{s.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar Footer */}
          <div className={`p-3 border-t border-slate-200 dark:border-slate-800 space-y-1 ${sidebarCollapsed ? 'lg:px-2' : ''}`}>
            <button
              type="button"
              onClick={() => {
                setSection('settings');
                setMobileMenuOpen(false);
              }}
              title={sidebarCollapsed ? profile?.displayName || 'Profile & Settings' : undefined}
              className={`w-full flex items-center rounded-xl text-sm font-medium transition-colors ${
                sidebarCollapsed
                  ? 'gap-3 px-3 py-2 lg:justify-center lg:px-0 lg:py-2.5'
                  : 'gap-3 px-3 py-2'
              } ${
                section === 'settings'
                  ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60'
              }`}
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span className={`truncate ${sidebarCollapsed ? 'lg:hidden' : ''}`}>
                {profile?.displayName || 'Profile & Settings'}
              </span>
            </button>
          </div>
        </aside>
      )}

      {/* Main Content Shell */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="sticky top-0 z-30 bg-white/90 dark:bg-[#181D27]/90 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 px-4 sm:px-8 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {!distractionFree && (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Open menu"
              >
                <Menu className="w-4 h-4" />
              </button>
            )}
            <span className="text-sm font-medium text-slate-600 dark:text-slate-300 truncate">
              {sectionLabels[section]}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Global Command / Search */}
            <button
              type="button"
              onClick={() => setCommandOpen(true)}
              className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
              aria-label="Open quick search"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Quick jump</span>
              <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 font-mono">
                <Command className="w-2.5 h-2.5" />K
              </span>
            </button>

            {/* Quick-Create Menu */}
            <div ref={quickCreateRef} className="relative">
              <button
                type="button"
                onClick={() => setQuickCreateOpen((v) => !v)}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                aria-label="Quick create"
              >
                <Plus className="w-3.5 h-3.5" />
                <span className="hidden md:inline">New</span>
                <ChevronDown className="w-3 h-3 text-slate-400" />
              </button>

              {quickCreateOpen && (
                <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] shadow-lg py-1.5 z-50">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCreateOpen(false);
                      setEditingSubject(null);
                      setSubjectModalOpen(true);
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5"
                  >
                    <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                    New Subject Workspace
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCreateOpen(false);
                      if (activeSubject) {
                        handleOpenSubject(activeSubject.id, 'resources');
                      } else {
                        setEditingSubject(null);
                        setSubjectModalOpen(true);
                      }
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5"
                  >
                    <Upload className="w-3.5 h-3.5 text-indigo-600" />
                    Upload Study Files
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCreateOpen(false);
                      if (activeSubject) {
                        handleOpenSubject(activeSubject.id, 'notes');
                      } else {
                        setSection('tutor');
                      }
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5"
                  >
                    <FilePlus2 className="w-3.5 h-3.5 text-indigo-600" />
                    Generate AI Notes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCreateOpen(false);
                      setSection('mindmaps');
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5"
                  >
                    <Network className="w-3.5 h-3.5 text-indigo-600" />
                    Create AI Mind Map
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCreateOpen(false);
                      setSection('flashcards_studio');
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5"
                  >
                    <Layers className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    Flashcards Studio
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCreateOpen(false);
                      setSection('pdf_solver');
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5"
                  >
                    <FileCheck2 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    Solve PDF Worksheet
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCreateOpen(false);
                      setSection('homework');
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5"
                  >
                    <ClipboardCheck className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    Scan Homework Worksheet
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCreateOpen(false);
                      setSection('teacher');
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5"
                  >
                    <GraduationCap className="w-3.5 h-3.5 text-indigo-600" />
                    Start AI Teacher Lesson
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCreateOpen(false);
                      setSection('whiteboard');
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5"
                  >
                    <PenTool className="w-3.5 h-3.5 text-indigo-600" />
                    Open AI Whiteboard
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCreateOpen(false);
                      setSection('podcasts');
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5"
                  >
                    <Headphones className="w-3.5 h-3.5 text-indigo-600" />
                    Generate Study Podcast
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCreateOpen(false);
                      setSection('lecture_notes');
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5"
                  >
                    <FileAudio className="w-3.5 h-3.5 text-indigo-600" />
                    Record Lecture → Cornell Notes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setQuickCreateOpen(false);
                      setSection('cheatsheets');
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 flex items-center gap-2.5"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600" />
                    Build Exam Cheat Sheet
                  </button>
                </div>
              )}
            </div>

            {/* Smart Revision Notifications */}
            <div ref={notificationsRef} className="relative">
              <button
                type="button"
                onClick={() => setNotificationsOpen((v) => !v)}
                className="relative p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                aria-label="Revision notifications"
              >
                <Bell className="w-4 h-4" />
                {smartNotifications.length > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-indigo-600" />
                )}
              </button>

              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] shadow-xl p-3 space-y-2.5 z-50">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white">
                      Smart Revision Alerts
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSection('memory');
                        setNotificationsOpen(false);
                      }}
                      className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      Preferences
                    </button>
                  </div>

                  {smartNotifications.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400 px-1 py-4 text-center">
                      All caught up. No urgent revision alerts right now.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto">
                      {smartNotifications.map((alert) => (
                        <div
                          key={alert.id}
                          className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-2.5 space-y-1.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-semibold text-slate-900 dark:text-white">
                              {alert.title}
                            </p>
                            <button
                              type="button"
                              onClick={() => setDismissedAlerts((prev) => [...prev, alert.id])}
                              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                              aria-label="Dismiss alert"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {alert.detail}
                          </p>
                          <button
                            type="button"
                            onClick={alert.onAction}
                            className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                          >
                            {alert.actionLabel}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleToggleTheme(theme === 'light' ? 'dark' : 'light')}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/70 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium transition-colors whitespace-nowrap"
              aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
            >
              {theme === 'light' ? (
                <>
                  <Moon className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="hidden md:inline">Dark</span>
                </>
              ) : (
                <>
                  <Sun className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden md:inline">Light</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleStartStudying}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium transition-colors whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              Start Studying
            </button>
          </div>
        </header>

        {/* Main Viewport */}
        <main className="flex-1 w-full max-w-[1280px] mx-auto px-4 sm:px-8 py-7">
          {section === 'dashboard' && (
            <DashboardView
              uid={authUser.uid}
              profile={profile}
              academicMemory={academicMemory}
              subjects={subjects}
              resources={resources}
              flashcards={flashcards}
              quizzes={quizzes}
              tasks={tasks}
              sessions={sessions}
              onStartStudying={handleStartStudying}
              onCreateSubject={() => {
                setEditingSubject(null);
                setSubjectModalOpen(true);
              }}
              onOpenSubject={handleOpenSubject}
              onNavigate={setSection}
              onOpenQuickTutor={(subjId, prompt) => {
                setQuickTutorSubjectId(subjId);
                setQuickTutorPrompt(prompt);
                setSection('tutor');
              }}
            />
          )}

          {section === 'workspace' && activeSubject && (
            <SubjectWorkspaceView
              uid={authUser.uid}
              profile={profile}
              subject={activeSubject}
              activeTab={workspaceTab}
              onChangeTab={setWorkspaceTab}
              resources={resources}
              notes={notes}
              flashcards={flashcards}
              quizzes={quizzes}
              tutorMessages={tutorMessages}
              interactiveModules={interactiveModules}
              academicMemory={academicMemory}
              onEditSubject={(subj) => {
                setEditingSubject(subj);
                setSubjectModalOpen(true);
              }}
              onSubjectDeleted={() => {
                setActiveSubjectId('');
                setSection('dashboard');
              }}
            />
          )}

          {section === 'workspace' && !activeSubject && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-12 text-center space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">No subjects created yet.</p>
              <button
                type="button"
                onClick={() => {
                  setEditingSubject(null);
                  setSubjectModalOpen(true);
                }}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium"
              >
                Create First Subject
              </button>
            </div>
          )}

          {section === 'flashcards_studio' && (
            <FlashcardsStudioView
              uid={authUser.uid}
              academicMemory={academicMemory}
              subjects={subjects}
              resources={resources}
              notes={notes}
              flashcards={flashcards}
            />
          )}

          {section === 'pdf_solver' && <PdfSolverView subjects={subjects} />}

          {section === 'tutor' && (
            <GlobalTutorView
              uid={authUser.uid}
              subjects={subjects}
              resources={resources}
              quizzes={quizzes}
              messages={tutorMessages}
              academicMemory={academicMemory}
              preferredComplexity={academicMemory?.preferredComplexity}
              initialSubjectId={quickTutorSubjectId}
              initialPrompt={quickTutorPrompt}
              onInitialPromptConsumed={() => setQuickTutorPrompt(undefined)}
              onCreateSubject={() => {
                setEditingSubject(null);
                setSubjectModalOpen(true);
              }}
            />
          )}

          {section === 'voice_tutor' && (
            <VoiceTutorView subjects={subjects} resources={resources} />
          )}

          {section === 'teacher' && (
            <TeacherModeView
              uid={authUser.uid}
              profile={profile}
              academicMemory={academicMemory}
              subjects={subjects}
              resources={resources}
              lessonSessions={lessonSessions}
            />
          )}

          {section === 'whiteboard' && (
            <WhiteboardView
              uid={authUser.uid}
              subjects={subjects}
              whiteboards={whiteboards}
            />
          )}

          {section === 'textbooks' && (
            <TextbookBuilderView
              uid={authUser.uid}
              subjects={subjects}
              resources={resources}
              academicMemory={academicMemory}
              textbooks={textbooks}
            />
          )}

          {section === 'video_studio' && (
            <VideoLearningView
              subjects={subjects}
              resources={resources}
              academicMemory={academicMemory}
            />
          )}

          {section === 'podcasts' && (
            <PodcastStudioView
              uid={authUser.uid}
              academicMemory={academicMemory}
              subjects={subjects}
              resources={resources}
              podcasts={studyPodcasts}
            />
          )}

          {section === 'lecture_notes' && (
            <LectureStudioView
              uid={authUser.uid}
              academicMemory={academicMemory}
              subjects={subjects}
            />
          )}

          {section === 'feynman' && (
            <FeynmanArenaView
              uid={authUser.uid}
              academicMemory={academicMemory}
              subjects={subjects}
              resources={resources}
              feynmanSessions={feynmanSessions}
            />
          )}

          {section === 'stem_sandbox' && <StemSandboxView />}

          {section === 'citations' && (
            <CitationStudioView
              uid={authUser.uid}
              academicMemory={academicMemory}
              subjects={subjects}
              citations={citations}
            />
          )}

          {section === 'cheatsheets' && (
            <CheatSheetBuilderView
              uid={authUser.uid}
              academicMemory={academicMemory}
              subjects={subjects}
              resources={resources}
              cheatSheets={cheatSheets}
            />
          )}

          {section === 'debate' && (
            <DebateArenaView
              uid={authUser.uid}
              academicMemory={academicMemory}
              subjects={subjects}
            />
          )}

          {section === 'grade_tracker' && (
            <GradeTrackerView
              uid={authUser.uid}
              academicMemory={academicMemory}
              subjects={subjects}
              gradeCourses={gradeCourses}
            />
          )}

          {section === 'explain_studio' && (
            <ExplanationStudioView
              uid={authUser.uid}
              subjects={subjects}
              resources={resources}
              academicMemory={academicMemory}
            />
          )}

          {section === 'homework' && (
            <HomeworkView
              uid={authUser.uid}
              academicMemory={academicMemory}
              subjects={subjects}
              homeworkItems={homeworkItems}
            />
          )}

          {section === 'mistakes' && (
            <MistakeDatabaseView
              uid={authUser.uid}
              subjects={subjects}
              mistakes={mistakes}
            />
          )}

          {section === 'study_rooms' && (
            <StudyRoomsView
              uid={authUser.uid}
              profile={profile}
              rooms={studyRooms}
            />
          )}

          {section === 'discovery' && (
            <ResourceDiscoveryView subjects={subjects} />
          )}

          {section === 'session_replay' && (
            <SessionReplayView
              subjects={subjects}
              lessonSessions={lessonSessions}
              tutorMessages={tutorMessages}
              notes={notes}
            />
          )}

          {section === 'science_lab' && (
            <ScienceLabView
              uid={authUser.uid}
              academicMemory={academicMemory}
              subjects={subjects}
              resources={resources}
            />
          )}

          {section === 'writing_lab' && (
            <WritingLabView
              uid={authUser.uid}
              academicMemory={academicMemory}
              subjects={subjects}
            />
          )}

          {section === 'vault' && (
            <KnowledgeVaultView
              academicMemory={academicMemory}
              subjects={subjects}
              resources={resources}
              notes={notes}
              flashcards={flashcards}
              mistakes={mistakes}
              whiteboards={whiteboards}
              onOpenSubject={handleOpenSubject}
            />
          )}

          {section === 'control_centre' && (
            <ControlCentreView
              uid={authUser.uid}
              academicMemory={academicMemory}
              subjects={subjects}
              telemetryLogs={aiTelemetryLogs}
            />
          )}

          {section === 'mindmaps' && (
            <MindMapView
              uid={authUser.uid}
              subjects={subjects}
              resources={resources}
              notes={notes}
              mindMaps={mindMaps}
              onOpenSubject={handleOpenSubject}
            />
          )}

          {section === 'language_lab' && (
            <LanguageLabView
              uid={authUser.uid}
              subjects={subjects}
              vocabItems={vocabItems}
            />
          )}

          {section === 'battle' && (
            <BattleModeView
              uid={authUser.uid}
              profile={profile}
              academicMemory={academicMemory}
              subjects={subjects}
              flashcards={flashcards}
              quizzes={quizzes}
              sessions={sessions}
            />
          )}

          {section === 'planner' && (
            <StudyPlannerView
              uid={authUser.uid}
              profile={profile}
              subjects={subjects}
              quizzes={quizzes}
              flashcards={flashcards}
              tasks={tasks}
              onCreateSubject={() => {
                setEditingSubject(null);
                setSubjectModalOpen(true);
              }}
            />
          )}

          {section === 'analytics' && (
            <AnalyticsView
              uid={authUser.uid}
              profile={profile}
              academicMemory={academicMemory}
              subjects={subjects}
              flashcards={flashcards}
              quizzes={quizzes}
              sessions={sessions}
            />
          )}

          {section === 'library' && (
            <LibrarySearchView
              subjects={subjects}
              resources={resources}
              notes={notes}
              flashcards={flashcards}
              quizzes={quizzes}
              tutorMessages={tutorMessages}
              onOpenSubject={handleOpenSubject}
            />
          )}

          {section === 'focus' && (
            <FocusModeView
              uid={authUser.uid}
              profile={profile}
              subjects={subjects}
              resources={resources}
              notes={notes}
              flashcards={flashcards}
              quizzes={quizzes}
              distractionFree={distractionFree}
              onToggleDistractionFree={() => setDistractionFree((d) => !d)}
            />
          )}

          {section === 'export_centre' && (
            <ExportCentreView
              subjects={subjects}
              notes={notes}
              flashcards={flashcards}
              quizzes={quizzes}
              mindMaps={mindMaps}
              tasks={tasks}
              academicMemory={academicMemory}
            />
          )}

          {section === 'memory' && (
            <AcademicMemoryView uid={authUser.uid} memory={academicMemory} />
          )}

          {section === 'settings' && (
            <SettingsView
              uid={authUser.uid}
              profile={profile}
              theme={theme}
              onChangeTheme={handleToggleTheme}
            />
          )}
        </main>
      </div>

      {/* Command Bar Modal (Cmd/Ctrl + K) */}
      {commandOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-start justify-center pt-24 px-4"
          onClick={() => setCommandOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200 dark:border-slate-800">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                ref={commandInputRef}
                type="text"
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
                placeholder="Jump to a tool, subject workspace, or search library..."
                className="flex-1 bg-transparent text-sm text-slate-900 dark:text-white focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setCommandOpen(false)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Esc
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto p-2 space-y-3">
              {commandResults.matchedSubjects.length > 0 && (
                <div className="space-y-1">
                  <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Subject Workspaces
                  </p>
                  {commandResults.matchedSubjects.map((s) => (
                    <button
                      key={`cmd_subj_${s.id}`}
                      type="button"
                      onClick={() => {
                        handleOpenSubject(s.id);
                        setCommandOpen(false);
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-left"
                    >
                      <span className="flex items-center gap-2.5">
                        <BookOpen className="w-4 h-4 text-indigo-600" />
                        <span>{s.name}</span>
                      </span>
                      <span className="text-xs text-slate-400">{s.code || s.folder}</span>
                    </button>
                  ))}
                </div>
              )}

              {commandResults.matchedNav.length > 0 && (
                <div className="space-y-1">
                  <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Tools & Sections
                  </p>
                  {commandResults.matchedNav.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={`cmd_nav_${item.id}`}
                        type="button"
                        onClick={() => {
                          setSection(item.id);
                          setCommandOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm text-slate-700 dark:text-slate-200 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-left"
                      >
                        <Icon className="w-4 h-4 text-slate-500" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setSection('library');
                  setCommandOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 text-left"
              >
                <Search className="w-3.5 h-3.5" />
                <span>Search all notes, documents, flashcards & past mistakes</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Subject Create / Edit Modal */}
      {subjectModalOpen && (
        <SubjectModal
          initialSubject={editingSubject}
          onClose={() => {
            setSubjectModalOpen(false);
            setEditingSubject(null);
          }}
          onSave={async (data) => {
            if (editingSubject) {
              await updateSubject(editingSubject.id, data);
            } else {
              const newId = await createSubject(authUser.uid, data);
              handleOpenSubject(newId);
            }
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <StudyPlatformShell />
    </ErrorBoundary>
  );
}
