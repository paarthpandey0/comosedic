import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Flashcard, Quiz, StudyNote, StudyResource, Subject, UserProfile } from '../types';
import { createNote, logStudySession } from '../services/studyDb';
import { runSubjectLab } from '../services/geminiApi';

interface FocusModeViewProps {
  uid: string;
  profile: UserProfile | null;
  subjects: Subject[];
  resources: StudyResource[];
  notes: StudyNote[];
  flashcards: Flashcard[];
  quizzes: Quiz[];
  distractionFree: boolean;
  onToggleDistractionFree: () => void;
}

const PRESETS = [
  { id: 'pomodoro', label: '25m Focus', minutes: 25 },
  { id: 'deep', label: '50m Deep Work', minutes: 50 },
  { id: 'sprint', label: '15m Sprint', minutes: 15 },
  { id: 'break', label: '5m Break', minutes: 5 },
];

type AmbientSound = 'off' | 'rain' | 'brown' | 'binaural';

export function FocusModeView({
  uid,
  profile,
  subjects,
  resources,
  notes,
  flashcards,
  quizzes,
  distractionFree,
  onToggleDistractionFree,
}: FocusModeViewProps) {
  const [selectedPreset, setSelectedPreset] = useState('pomodoro');
  const [totalSeconds, setTotalSeconds] = useState(25 * 60);
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || '');
  const [sessionGoal, setSessionGoal] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [loggedBanner, setLoggedBanner] = useState<string | null>(null);

  const [ambient, setAmbient] = useState<AmbientSound>('off');
  const [ambientVol, setAmbientVol] = useState(0.25);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);

  const [summarizing, setSummarizing] = useState(false);
  const [sessionSummary, setSessionSummary] = useState('');
  const [breakReminder, setBreakReminder] = useState(false);

  const activeSubjectId = subjectId || subjects[0]?.id || '';
  const activeSubjectName = subjects.find((s) => s.id === activeSubjectId)?.name || 'General Study';

  const stopAmbientAudio = () => {
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
      gainNodeRef.current = null;
    }
  };

  useEffect(() => {
    stopAmbientAudio();
    if (ambient === 'off') return;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;

    const gain = ctx.createGain();
    gain.gain.value = ambientVol * 0.4;
    gain.connect(ctx.destination);
    gainNodeRef.current = gain;

    if (ambient === 'binaural') {
      const oscL = ctx.createOscillator();
      const oscR = ctx.createOscillator();
      const panL = ctx.createStereoPanner();
      const panR = ctx.createStereoPanner();
      oscL.frequency.value = 200;
      oscR.frequency.value = 240; // 40Hz Gamma Focus beat
      panL.pan.value = -1;
      panR.pan.value = 1;
      oscL.connect(panL).connect(gain);
      oscR.connect(panR).connect(gain);
      oscL.start();
      oscR.start();
    } else {
      // Synthesize Rain (pink-filtered noise) or Brown Focus Noise via Web Audio buffer
      const bufferSize = ctx.sampleRate * 3;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      let lastOut = 0.0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        lastOut = (lastOut + 0.02 * white) / 1.02;
        output[i] = ambient === 'brown' ? lastOut * 3.2 : white * 0.35;
      }
      const whiteNoise = ctx.createBufferSource();
      whiteNoise.buffer = noiseBuffer;
      whiteNoise.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = ambient === 'rain' ? 1200 : 380;

      whiteNoise.connect(filter).connect(gain);
      whiteNoise.start();
    }

    return () => {
      stopAmbientAudio();
    };
  }, [ambient]);

  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = ambientVol * 0.4;
    }
  }, [ambientVol]);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          setRunning(false);
          setBreakReminder(selectedPreset !== 'break');
          void handleCompleteSession(Math.max(1, Math.round(totalSeconds / 60)));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, totalSeconds, activeSubjectId]);

  const handleSelectPreset = (id: string, minutes: number) => {
    setRunning(false);
    setSelectedPreset(id);
    setTotalSeconds(minutes * 60);
    setSecondsLeft(minutes * 60);
    setLoggedBanner(null);
    setBreakReminder(false);
  };

  const handleCompleteSession = async (mins: number) => {
    if (!activeSubjectId || selectedPreset === 'break') {
      setLoggedBanner('Break finished. Ready for your next focus block.');
      return;
    }
    await logStudySession(uid, profile, activeSubjectId, 'focus', mins, {
      resourcesCount: resources.length,
      notesCount: notes.length,
      flashcardsCount: flashcards.length,
      quizzesCompletedCount: quizzes.filter((q) => q.status === 'completed').length,
    });
    setLoggedBanner(`Logged ${mins} focus minutes to your streak and analytics.`);
  };

  const handleLogElapsedNow = async () => {
    const elapsedMins = Math.max(1, Math.round((totalSeconds - secondsLeft) / 60));
    setRunning(false);
    await handleCompleteSession(elapsedMins);
    setSecondsLeft(totalSeconds);
  };

  const handleGenerateSummaryAndSave = async () => {
    if (!sessionNotes.trim() && !sessionGoal.trim()) return;
    setSummarizing(true);
    try {
      const res = await runSubjectLab({
        domain: activeSubjectName,
        task: 'Create a structured post-study session recap with key takeaways, unresolved questions, and next revision step.',
        input: `Goal: ${sessionGoal}\nSession Notes:\n${sessionNotes}`,
      });
      setSessionSummary(res.result);
      if (activeSubjectId) {
        await createNote(uid, {
          subjectId: activeSubjectId,
          resourceId: '',
          title: `Study Room Recap: ${sessionGoal || activeSubjectName}`,
          style: 'quick',
          content: res.result,
        });
      }
    } finally {
      setSummarizing(false);
    }
  };

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const pct = Math.round(((totalSeconds - secondsLeft) / Math.max(1, totalSeconds)) * 100);

  return (
    <div className="max-w-4xl mx-auto py-4 space-y-6">
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 sm:p-8 text-center space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-left">
            <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              AI Study Room · Deep Focus & Ambient Sound
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Pomodoro timer, synthesized focus audio, live scratchpad, and automatic AI session recaps
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleDistractionFree}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {distractionFree ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            {distractionFree ? 'Show Sidebar' : 'Distraction-Free'}
          </button>
        </div>

        {/* Presets & Ambient Audio Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-y border-slate-100 dark:border-slate-800 py-4">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPreset(p.id, p.minutes)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  selectedPreset === p.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {ambient === 'off' ? (
              <VolumeX className="w-4 h-4 text-slate-400" />
            ) : (
              <Volume2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            )}
            {(['off', 'rain', 'brown', 'binaural'] as AmbientSound[]).map((snd) => (
              <button
                key={snd}
                type="button"
                onClick={() => setAmbient(snd)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium capitalize ${
                  ambient === snd
                    ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
              >
                {snd === 'binaural' ? '40Hz Focus' : snd === 'brown' ? 'Brown Noise' : snd}
              </button>
            ))}
            {ambient !== 'off' && (
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={ambientVol}
                onChange={(e) => setAmbientVol(Number(e.target.value))}
                className="w-20 accent-indigo-600"
                aria-label="Ambient volume"
              />
            )}
          </div>
        </div>

        {/* Clock */}
        <div className="py-3">
          <div className="font-mono text-6xl sm:text-7xl font-semibold tracking-tight text-slate-900 dark:text-white tabular-nums">
            {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
          </div>
          <div className="w-full max-w-sm mx-auto h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 mt-5 overflow-hidden">
            <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {breakReminder && (
          <div className="rounded-xl border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-4 py-3 text-xs text-indigo-800 dark:text-indigo-200 flex items-center justify-between gap-3">
            <span>Focus block complete! Take a 5-minute break to consolidate memory.</span>
            <button
              type="button"
              onClick={() => handleSelectPreset('break', 5)}
              className="px-3 py-1 rounded-lg bg-indigo-600 text-white font-medium"
            >
              Start 5m Break
            </button>
          </div>
        )}

        {/* Subject & Goal */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Subject
            </label>
            <select
              value={activeSubjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              disabled={subjects.length === 0}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
            >
              {subjects.length === 0 ? (
                <option value="">Create a subject first</option>
              ) : (
                subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Session Goal
            </label>
            <input
              type="text"
              value={sessionGoal}
              onChange={(e) => setSessionGoal(e.target.value)}
              placeholder="e.g. Finish Chapter 6 summary"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
            />
          </div>
        </div>

        {/* Session Scratchpad & Auto AI Summary */}
        <div className="text-left space-y-2.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Live Study Room Scratchpad
            </label>
            <button
              type="button"
              onClick={() => void handleGenerateSummaryAndSave()}
              disabled={summarizing || (!sessionNotes.trim() && !sessionGoal.trim())}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
            >
              {summarizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {summarizing ? 'Summarizing...' : 'Generate AI Recap & Save Note'}
            </button>
          </div>
          <textarea
            rows={4}
            value={sessionNotes}
            onChange={(e) => setSessionNotes(e.target.value)}
            placeholder="Jot down formulas, realizations, or questions during your focus session..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm"
          />
          {sessionSummary && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/50 dark:bg-emerald-950/20 p-3.5 text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
              {sessionSummary}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => setRunning((r) => !r)}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium transition-colors"
          >
            {running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
            {running ? 'Pause' : 'Start Timer'}
          </button>

          <button
            type="button"
            onClick={() => {
              setRunning(false);
              setSecondsLeft(totalSeconds);
            }}
            className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </button>

          {secondsLeft < totalSeconds && activeSubjectId && selectedPreset !== 'break' && (
            <button
              type="button"
              onClick={() => void handleLogElapsedNow()}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-sm font-medium"
            >
              <CheckCircle2 className="w-4 h-4" />
              Finish & Log Time
            </button>
          )}
        </div>

        {loggedBanner && (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
            {loggedBanner}
          </div>
        )}
      </div>
    </div>
  );
}
