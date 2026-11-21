import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Film,
  Info,
  Loader2,
  Play,
  Sparkles,
  Square,
  Subtitles,
  Volume2,
} from 'lucide-react';
import type { AcademicMemory, StudyResource, Subject } from '../types';
import { buildSubjectAiContext } from '../services/studyDb';
import { generateVideoStoryboard } from '../services/geminiApi';
import { speakBrowserText, stopBrowserSpeech } from '../utils/browserSpeech';
import { sanitizeSvgMarkup } from '../utils/safeSvg';
import { MarkdownView } from './MarkdownView';

interface VideoLearningViewProps {
  subjects: Subject[];
  resources: StudyResource[];
  academicMemory: AcademicMemory | null;
}

interface StoryboardScene {
  index: number;
  title: string;
  durationSeconds: number;
  narration: string;
  subtitle: string;
  bulletPoints: string[];
  diagramSvg: string;
}

export function VideoLearningView({ subjects, resources, academicMemory }: VideoLearningViewProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || 'general');
  const [topic, setTopic] = useState('');
  const [format, setFormat] = useState<'short_explainer' | 'chapter_summary' | 'lesson_script'>('short_explainer');
  const [loading, setLoading] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState('');

  const [storyboard, setStoryboard] = useState<{
    title: string;
    overviewScript: string;
    scenes: StoryboardScene[];
    videoRenderingSupported: boolean;
    videoStatusNote: string;
  } | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [showSubtitles, setShowSubtitles] = useState(true);

  useEffect(() => {
    stopBrowserSpeech();
    setSpeaking(false);
    return () => stopBrowserSpeech();
  }, [activeSlide, storyboard]);

  const handleGenerate = async () => {
    if (!topic.trim()) {
      setError('Enter a topic or chapter name to build a visual explainer.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const subjectName = subjects.find((s) => s.id === subjectId)?.name || 'General Study';
      const ctx = buildSubjectAiContext(subjectId, resources, academicMemory, 32000);
      const res = await generateVideoStoryboard({
        subjectName,
        topic: topic.trim(),
        content: ctx,
        format,
      });
      setStoryboard(res);
      setActiveSlide(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create storyboard.');
    } finally {
      setLoading(false);
    }
  };

  const currentScene = storyboard?.scenes?.[activeSlide] || null;
  const safeSvg = useMemo(
    () => (currentScene ? sanitizeSvgMarkup(currentScene.diagramSvg) : ''),
    [currentScene]
  );

  const handleNarrateSlide = async () => {
    if (!currentScene) return;
    if (speaking) {
      stopBrowserSpeech();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    setError('');
    try {
      await speakBrowserText({
        text: currentScene.narration,
        rate: 1,
        onEnd: () => setSpeaking(false),
        onError: (msg) => {
          setError(msg);
          setSpeaking(false);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Narration playback failed.');
      setSpeaking(false);
    }
  };

  const handleDownloadSrt = () => {
    if (!storyboard) return;
    let cursorSec = 0;
    const formatTs = (sec: number) => {
      const h = String(Math.floor(sec / 3600)).padStart(2, '0');
      const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');
      return `${h}:${m}:${s},000`;
    };
    const srt = storyboard.scenes
      .map((scene, idx) => {
        const start = formatTs(cursorSec);
        cursorSec += scene.durationSeconds || 15;
        const end = formatTs(cursorSec);
        return `${idx + 1}\n${start} --> ${end}\n${scene.subtitle}\n`;
      })
      .join('\n');

    const blob = new Blob([srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${storyboard.title.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
          <Film className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          AI Video &amp; Visual Storyboard Studio
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Turn study documents into narrated presentation slides, visual diagrams, explainer scripts, and timed SRT subtitles.
        </p>
      </div>

      {/* Honest Model Capability Disclosure */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-4 py-3 flex items-start gap-3">
        <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-600 dark:text-slate-300">
          Direct MP4 video synthesis requires a paid/external video model, which is not enabled on the current free-tier setup. All script generation, SVG diagram storyboards, browser speech narration, and SRT subtitles run live.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 grid grid-cols-1 md:grid-cols-4 gap-3">
        <select
          value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}
          className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
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
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Topic or chapter for visual explainer..."
          className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
        />

        <div className="flex gap-2">
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as 'short_explainer' | 'chapter_summary' | 'lesson_script')}
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            <option value="short_explainer">Short Explainer</option>
            <option value="chapter_summary">Chapter Summary</option>
            <option value="lesson_script">Lesson Script</option>
          </select>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleGenerate()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Create
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      )}

      {storyboard && currentScene && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Interactive Storyboard Slide Player */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {storyboard.title} · Scene {activeSlide + 1} of {storyboard.scenes.length}
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSubtitles((s) => !s)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                    showSubtitles ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  <Subtitles className="w-3.5 h-3.5" />
                  Subtitles
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSrt}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
                >
                  <Download className="w-3.5 h-3.5" />
                  .SRT
                </button>
              </div>
            </div>

            {/* Slide Frame */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-900 text-white p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-300">
                  Slide {currentScene.index}
                </span>
                <span className="text-xs text-slate-400 tabular-nums">{currentScene.durationSeconds}s</span>
              </div>

              <h3 className="text-xl font-bold">{currentScene.title}</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                <ul className="space-y-2 text-sm text-slate-200 list-disc pl-5">
                  {currentScene.bulletPoints.map((bp, i) => (
                    <li key={i}>{bp}</li>
                  ))}
                </ul>
                {safeSvg && (
                  <div className="rounded-xl bg-white p-2" dangerouslySetInnerHTML={{ __html: safeSvg }} />
                )}
              </div>

              {showSubtitles && (
                <div className="rounded-lg bg-black/60 px-4 py-2 text-center text-xs text-slate-100">
                  {currentScene.subtitle}
                </div>
              )}
            </div>

            {/* Playback & Navigation Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={activeSlide === 0}
                  onClick={() => setActiveSlide((s) => Math.max(0, s - 1))}
                  className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                  aria-label="Previous slide"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={activeSlide >= storyboard.scenes.length - 1}
                  onClick={() => setActiveSlide((s) => Math.min(storyboard.scenes.length - 1, s + 1))}
                  className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                  aria-label="Next slide"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => void handleNarrateSlide()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
              >
                {speaking ? <Square className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                {speaking ? 'Stop Narration' : 'Narrate Slide Audio'}
              </button>
            </div>
          </div>

          {/* Full Script */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Play className="w-4 h-4 text-indigo-600" />
              Presenter Narration Script
            </h3>
            <div className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 p-3 rounded-xl">
              <MarkdownView content={currentScene.narration} />
            </div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 pt-2">Overview Script</p>
            <div className="max-h-64 overflow-y-auto text-xs text-slate-600 dark:text-slate-300">
              <MarkdownView content={storyboard.overviewScript} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
