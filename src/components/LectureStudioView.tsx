import { useEffect, useRef, useState } from 'react';
import {
  BookPlus,
  FileAudio,
  Layers,
  Loader2,
  Mic,
  Square,
  Upload,
} from 'lucide-react';
import type { AcademicMemory, Subject } from '../types';
import {
  awardLearningXp,
  createFlashcardsBatch,
  createNote,
} from '../services/studyDb';
import { transcribeLectureToCornell } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';

interface LectureStudioViewProps {
  uid: string;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
}

interface CornellResult {
  title: string;
  transcript: string;
  cues: Array<{ cue: string; detail: string }>;
  detailedNotesMarkdown: string;
  summary: string;
  actionItems: string[];
  flashcardSeeds: Array<{ front: string; back: string; hint: string; topic: string }>;
}

export function LectureStudioView({
  uid,
  academicMemory,
  subjects,
}: LectureStudioViewProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || 'general');
  const [lectureTitle, setLectureTitle] = useState('');
  const [pastedTranscript, setPastedTranscript] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);

  const [processing, setProcessing] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);
  const [savingCards, setSavingCards] = useState(false);
  const [result, setResult] = useState<CornellResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close();
    };
  }, []);

  const startRecording = async () => {
    setError('');
    setNotice('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      setRecordedBlob(null);
      setRecordedUrl('');
      setUploadedFile(null);

      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tickMeter = () => {
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((sum, v) => sum + v, 0) / data.length;
        setAudioLevel(Math.min(100, Math.round((avg / 140) * 100)));
        rafRef.current = requestAnimationFrame(tickMeter);
      };
      tickMeter();

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (evt) => {
        if (evt.data.size > 0) chunksRef.current.push(evt.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setRecordedBlob(blob);
        setRecordedUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((t) => t.stop());
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        void audioCtx.close();
        setAudioLevel(0);
      };

      recorder.start(500);
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setError('Microphone permission is required to record lectures, or upload an audio file below.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setIsRecording(false);
  };

  const handleProcessLecture = async () => {
    const audioSource = uploadedFile || recordedBlob;
    if (!audioSource && !pastedTranscript.trim()) {
      setError('Record a lecture, upload an audio file, or paste a transcript first.');
      return;
    }

    setProcessing(true);
    setError('');
    setNotice('');
    try {
      const subjectName = subjects.find((s) => s.id === subjectId)?.name || 'General Study';
      const res = await transcribeLectureToCornell({
        audioFile: audioSource,
        fileName: uploadedFile?.name || 'live-lecture.webm',
        pastedTranscript: pastedTranscript.trim() || undefined,
        subjectName,
        lectureTitle: lectureTitle.trim() || undefined,
      });
      setResult(res);
      void awardLearningXp(uid, academicMemory, 30);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transcribe and structure lecture.');
    } finally {
      setProcessing(false);
    }
  };

  const handleSaveCornellNote = async () => {
    if (!result) return;
    setSavingNotes(true);
    setError('');
    try {
      const fullMarkdown = [
        `# ${result.title}`,
        '',
        '## Cornell Cue Questions & Terms',
        ...result.cues.map((c) => `- **${c.cue}**: ${c.detail}`),
        '',
        '## Detailed Lecture Notes',
        result.detailedNotesMarkdown,
        '',
        '## Synthesis Summary',
        result.summary,
        '',
        '## Revision Action Items',
        ...result.actionItems.map((a) => `- [ ] ${a}`),
      ].join('\n');

      await createNote(uid, {
        subjectId: subjectId || 'general',
        resourceId: '',
        title: `Cornell Notes: ${result.title}`,
        style: 'detailed',
        content: fullMarkdown,
        isBookmarked: true,
      });
      setNotice('Saved Cornell Notes directly to your Subject Notes.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save Cornell notes.');
    } finally {
      setSavingNotes(false);
    }
  };

  const handleSaveFlashcards = async () => {
    if (!result || result.flashcardSeeds.length === 0) return;
    if (subjectId === 'general') {
      setError('Select a specific subject workspace above to save flashcards to that deck.');
      return;
    }
    setSavingCards(true);
    setError('');
    try {
      await createFlashcardsBatch(
        uid,
        subjectId,
        '',
        result.flashcardSeeds.map((c) => ({
          front: c.front,
          back: c.back,
          hint: c.hint,
          topic: c.topic || result.title,
          difficulty: 'medium',
        }))
      );
      setNotice(`Added ${result.flashcardSeeds.length} spaced-repetition flashcards to your subject deck.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save lecture flashcards.');
    } finally {
      setSavingCards(false);
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <FileAudio className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            Lecture Recorder &amp; Cornell Notes Studio
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Record live classes or upload audio clips for Gemini transcription into structured Cornell Cues, Notes, Summaries, and Flashcards.
          </p>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Powered by Gemini Speech-to-Text · Cornell Format
        </div>
      </div>

      {/* Capture Panel */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="md:col-span-4 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
          >
            <option value="general">General Study</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={lectureTitle}
            onChange={(e) => setLectureTitle(e.target.value)}
            placeholder="Lecture title (optional, e.g., Week 4: Thermodynamics Laws)"
            className="md:col-span-8 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Live Mic Recorder */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Live Microphone Capture
              </span>
              <span className="font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                {formatTimer(recordingSeconds)}
              </span>
            </div>

            <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-indigo-600 transition-all duration-100"
                style={{ width: `${isRecording ? Math.max(8, audioLevel) : 0}%` }}
              />
            </div>

            <div className="flex items-center gap-2">
              {!isRecording ? (
                <button
                  type="button"
                  onClick={() => void startRecording()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium whitespace-nowrap"
                >
                  <Mic className="w-3.5 h-3.5" />
                  Start Recording
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium whitespace-nowrap"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  Stop Recording
                </button>
              )}
              {recordedBlob && !isRecording && (
                <span className="text-xs text-emerald-700 dark:text-emerald-400 tabular-nums">
                  Captured {(recordedBlob.size / 1024).toFixed(0)} KB
                </span>
              )}
            </div>

            {recordedUrl && (
              <audio src={recordedUrl} controls className="w-full h-8" />
            )}
          </div>

          {/* Audio Upload */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3 flex flex-col justify-between">
            <div>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Upload Pre-Recorded Lecture Audio
              </span>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Supports MP3, WAV, M4A, OGG, or WebM files up to 25 MB.
              </p>
            </div>

            <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 cursor-pointer w-fit">
              <Upload className="w-3.5 h-3.5" />
              <span>{uploadedFile ? uploadedFile.name : 'Choose Audio File'}</span>
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  setUploadedFile(file);
                  if (file) {
                    setRecordedBlob(null);
                    setRecordedUrl('');
                  }
                }}
              />
            </label>
          </div>
        </div>

        {/* Optional Transcript Paste */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Or paste an existing lecture transcript / video captions
          </label>
          <textarea
            value={pastedTranscript}
            onChange={(e) => setPastedTranscript(e.target.value)}
            rows={3}
            placeholder="Paste lecture transcript here if you don't have an audio recording..."
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void handleProcessLecture()}
            disabled={processing || isRecording}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium whitespace-nowrap"
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileAudio className="w-4 h-4" />}
            Transcribe &amp; Build Cornell Notes
          </button>

          {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          {notice && <p className="text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>}
        </div>
      </div>

      {/* Cornell Notes Layout */}
      {result && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                {result.title}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {result.cues.length} cue questions · {result.flashcardSeeds.length} flashcard seeds ready
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleSaveCornellNote()}
                disabled={savingNotes}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap"
              >
                {savingNotes ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookPlus className="w-3.5 h-3.5" />}
                Save to Subject Notes
              </button>
              <button
                type="button"
                onClick={() => void handleSaveFlashcards()}
                disabled={savingCards}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
              >
                {savingCards ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
                Add {result.flashcardSeeds.length} Flashcards
              </button>
            </div>
          </div>

          {/* Classic 2-Column Cornell Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
            {/* Cue Column */}
            <div className="lg:col-span-4 p-5 bg-slate-50/50 dark:bg-slate-900/30 space-y-4">
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Cue Column (Recall Prompts)
              </h3>
              <div className="space-y-3">
                {result.cues.map((c, idx) => (
                  <div key={idx} className="space-y-1 pb-3 border-b border-slate-200/70 dark:border-slate-800 last:border-b-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {c.cue}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {c.detail}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Detailed Notes Column */}
            <div className="lg:col-span-8 p-6 space-y-4">
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Structured Lecture Notes
              </h3>
              <MarkdownView content={result.detailedNotesMarkdown} />
            </div>
          </div>

          {/* Cornell Bottom Summary */}
          <div className="p-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Synthesis Summary
              </h3>
              <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                {result.summary}
              </p>
            </div>
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Next Revision Steps
              </h3>
              <ul className="space-y-1 text-sm text-slate-700 dark:text-slate-200">
                {result.actionItems.map((item, idx) => (
                  <li key={idx}>• {item}</li>
                ))}
              </ul>
            </div>
          </div>

          {/* Verbatim Transcript Disclosure */}
          <details className="border-t border-slate-200 dark:border-slate-800 px-6 py-4">
            <summary className="text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer">
              View Verbatim Transcript ({result.transcript.split(/\s+/).length} words)
            </summary>
            <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
              {result.transcript}
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
