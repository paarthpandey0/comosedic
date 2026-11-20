import { useEffect, useRef, useState } from 'react';
import {
  Download,
  Headphones,
  Loader2,
  Pause,
  Play,
  Radio,
  Trash2,
  Volume2,
} from 'lucide-react';
import type {
  AcademicMemory,
  PodcastStyle,
  StudyPodcast,
  StudyResource,
  Subject,
} from '../types';
import {
  awardLearningXp,
  buildSubjectAiContext,
  createStudyPodcast,
  deleteStudyPodcast,
} from '../services/studyDb';
import { generatePodcastScript, synthesizePodcastAudio } from '../services/geminiApi';

interface PodcastStudioViewProps {
  uid: string;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
  resources: StudyResource[];
  podcasts: StudyPodcast[];
}

const STYLES: Array<{ id: PodcastStyle; label: string; desc: string }> = [
  { id: 'conversational', label: 'Conversational', desc: 'Warm, curiosity-driven dialogue' },
  { id: 'exam_cram', label: 'Exam Cram', desc: 'Fast-paced high-yield revision' },
  { id: 'deep_dive', label: 'Deep Dive', desc: 'Rigorous seminar breakdown' },
  { id: 'debate_duo', label: 'Point-Counterpoint', desc: 'Two perspectives compared' },
];

export function PodcastStudioView({
  uid,
  academicMemory,
  subjects,
  resources,
  podcasts,
}: PodcastStudioViewProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || 'general');
  const [topic, setTopic] = useState('');
  const [hostStyle, setHostStyle] = useState<PodcastStyle>('conversational');
  const [selectedId, setSelectedId] = useState<string>(podcasts[0]?.id || '');
  const [generatingScript, setGeneratingScript] = useState(false);
  const [synthesizingAudio, setSynthesizingAudio] = useState(false);
  const [audioUrls, setAudioUrls] = useState<Record<string, { url: string; modelUsed: string }>>({});
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const activePodcast = podcasts.find((p) => p.id === selectedId) || podcasts[0] || null;
  const activeAudio = activePodcast ? audioUrls[activePodcast.id] : undefined;

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, activeAudio?.url]);

  useEffect(() => {
    setIsPlaying(false);
  }, [activePodcast?.id]);

  const handleGenerateEpisode = async () => {
    const subject = subjects.find((s) => s.id === subjectId);
    const context = buildSubjectAiContext(subjectId, resources, academicMemory, 22000);
    if (!topic.trim() && !context.trim()) {
      setError('Enter an episode topic or choose a subject with uploaded study materials.');
      return;
    }

    setGeneratingScript(true);
    setError('');
    setNotice('');
    try {
      const result = await generatePodcastScript({
        subjectName: subject?.name || 'General Study',
        topic: topic.trim() || `${subject?.name || 'Study'} Core Review`,
        hostStyle,
        context,
      });
      const id = await createStudyPodcast(uid, {
        subjectId: subjectId || 'general',
        title: result.title,
        topic: topic.trim() || result.title,
        hostStyle,
        turns: result.turns,
        takeaways: result.takeaways,
        estimatedMinutes: result.estimatedMinutes,
      });
      setSelectedId(id);
      setTopic('');
      void awardLearningXp(uid, academicMemory, 25);
      setNotice('Episode script saved. Click Synthesize Dual-Host Audio to render spoken WAV audio.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate podcast script.');
    } finally {
      setGeneratingScript(false);
    }
  };

  const handleSynthesizeAudio = async () => {
    if (!activePodcast) return;
    setSynthesizingAudio(true);
    setError('');
    setNotice('');
    try {
      const res = await synthesizePodcastAudio({ turns: activePodcast.turns });
      const binary = atob(res.audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: res.mimeType || 'audio/wav' });
      const url = URL.createObjectURL(blob);
      setAudioUrls((prev) => ({
        ...prev,
        [activePodcast.id]: { url, modelUsed: res.modelUsed },
      }));
      setNotice(`Audio ready via ${res.modelUsed}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to synthesize podcast audio.');
    } finally {
      setSynthesizingAudio(false);
    }
  };

  const handleTogglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play();
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
  };

  const handleDownloadTranscript = () => {
    if (!activePodcast) return;
    const md = [
      `# ${activePodcast.title}`,
      `Topic: ${activePodcast.topic} · Style: ${activePodcast.hostStyle}`,
      '',
      '## Key Takeaways',
      ...activePodcast.takeaways.map((t) => `- ${t}`),
      '',
      '## Episode Transcript',
      ...activePodcast.turns.map((t) => `**${t.speaker}:** ${t.line}`),
    ].join('\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activePodcast.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <Headphones className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            AI Study Podcast Studio
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Turn uploaded notes and topics into two-host audio episodes (Alex &amp; Sam) powered by Gemini Dual-Speaker Speech.
          </p>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
          <span>{podcasts.length} saved episodes</span>
          <span aria-hidden="true"> · </span>
          <span>Dual-voice WAV export</span>
        </div>
      </div>

      {/* Generator Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="md:col-span-3 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
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
            placeholder="Episode topic (e.g., Cellular Respiration & ATP Yield, Monetary Policy)"
            className="md:col-span-6 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white"
          />

          <button
            type="button"
            onClick={() => void handleGenerateEpisode()}
            disabled={generatingScript}
            className="md:col-span-3 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap"
          >
            {generatingScript ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radio className="w-4 h-4" />}
            Generate Episode
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-100 dark:bg-slate-900/70 w-fit">
          {STYLES.map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => setHostStyle(st.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                hostStyle === st.id
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
              title={st.desc}
            >
              {st.label}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        {notice && <p className="text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>}
      </div>

      {/* Main Split: Episode List + Audio Player & Transcript */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 space-y-2.5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white px-1">
            Saved Episodes
          </h2>
          {podcasts.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400 px-1 py-6 text-center">
              No podcast episodes yet. Generate your first two-host revision episode above.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-[540px] overflow-y-auto">
              {podcasts.map((pod) => {
                const subj = subjects.find((s) => s.id === pod.subjectId)?.name || 'General';
                const selected = activePodcast?.id === pod.id;
                return (
                  <div
                    key={pod.id}
                    className={`rounded-xl border p-3 transition-colors ${
                      selected
                        ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedId(pod.id)}
                        className="text-left flex-1 min-w-0"
                      >
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {pod.title}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                          {subj} · {pod.turns.length} turns · ~{pod.estimatedMinutes} min
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteStudyPodcast(pod.id)}
                        className="p-1 text-slate-400 hover:text-rose-600"
                        aria-label="Delete podcast"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-8 space-y-5">
          {!activePodcast ? (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-12 text-center space-y-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Select or create an episode to listen and study
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Gemini writes a grounded two-host conversation from your materials, then renders dual-speaker WAV audio on demand.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
                <div className="space-y-1">
                  <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                    {activePodcast.title}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                    {subjects.find((s) => s.id === activePodcast.subjectId)?.name || 'General Study'} ·{' '}
                    {STYLES.find((s) => s.id === activePodcast.hostStyle)?.label || activePodcast.hostStyle} ·{' '}
                    {activePodcast.turns.length} dialogue turns · ~{activePodcast.estimatedMinutes} min
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleSynthesizeAudio()}
                    disabled={synthesizingAudio}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap"
                  >
                    {synthesizingAudio ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                    {activeAudio ? 'Regenerate Audio' : 'Synthesize Dual-Host Audio'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadTranscript}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Script (.md)
                  </button>
                </div>
              </div>

              {/* Audio Player */}
              {activeAudio && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleTogglePlay}
                        className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shrink-0"
                        aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
                      >
                        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
                      </button>
                      <div>
                        <p className="text-xs font-semibold text-slate-900 dark:text-white">
                          Alex (Puck) &amp; Sam (Kore)
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Rendered with {activeAudio.modelUsed}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {[0.85, 1, 1.25, 1.5].map((rate) => (
                        <button
                          key={rate}
                          type="button"
                          onClick={() => setPlaybackRate(rate)}
                          className={`px-2 py-1 rounded-md text-xs font-mono tabular-nums ${
                            playbackRate === rate
                              ? 'bg-indigo-600 text-white'
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          {rate}x
                        </button>
                      ))}
                      <a
                        href={activeAudio.url}
                        download={`${activePodcast.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.wav`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50"
                      >
                        <Download className="w-3 h-3" />
                        WAV
                      </a>
                    </div>
                  </div>
                  <audio
                    ref={audioRef}
                    src={activeAudio.url}
                    controls
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    className="w-full h-9"
                  />
                </div>
              )}

              {/* Key Takeaways */}
              {activePodcast.takeaways.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    Key Takeaways
                  </h3>
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-slate-700 dark:text-slate-200">
                    {activePodcast.takeaways.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400 tabular-nums mt-0.5">
                          0{idx + 1}.
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Transcript */}
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Dialogue Transcript
                </h3>
                <div className="space-y-3">
                  {activePodcast.turns.map((turn, idx) => (
                    <div
                      key={idx}
                      className={`rounded-xl p-3.5 ${
                        turn.speaker === 'Alex'
                          ? 'bg-slate-50 dark:bg-slate-900/60'
                          : 'bg-indigo-50/40 dark:bg-indigo-950/20'
                      }`}
                    >
                      <p className="text-xs font-semibold text-slate-900 dark:text-white mb-1">
                        {turn.speaker}
                      </p>
                      <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                        {turn.line}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
