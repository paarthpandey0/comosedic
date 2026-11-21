import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  PhoneOff,
  Play,
  Send,
  Square,
  Volume2,
  Waves,
} from 'lucide-react';
import type { StudyResource, Subject } from '../types';
import { speakBrowserText, stopBrowserSpeech } from '../utils/browserSpeech';

interface VoiceTutorViewProps {
  subjects: Subject[];
  resources: StudyResource[];
}

type VoiceMode = 'voice_tutor' | 'oral_exam' | 'pronunciation' | 'vocab_test';

interface TranscriptTurn {
  id: string;
  role: 'user' | 'model';
  text: string;
}

const MODE_LABELS: Record<VoiceMode, { label: string; desc: string }> = {
  voice_tutor: { label: 'Voice Conversation', desc: 'Open spoken tutoring grounded in your uploaded resources' },
  oral_exam: { label: 'Oral Exam Simulator', desc: 'Timed spoken examination with real-time follow-ups' },
  pronunciation: { label: 'Language Pronunciation', desc: 'Practice spoken phrases, accent, and fluency' },
  vocab_test: { label: 'Spoken Vocab Test', desc: 'Rapid spoken vocabulary recall prompts' },
};

const VOICES = ['Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir'];

export function VoiceTutorView({ subjects, resources }: VoiceTutorViewProps) {
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id || '');
  const [mode, setMode] = useState<VoiceMode>('voice_tutor');
  const [language, setLanguage] = useState('French');
  const [voiceName, setVoiceName] = useState('Zephyr');
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [speakingNow, setSpeakingNow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [transcripts, setTranscripts] = useState<TranscriptTurn[]>([]);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const micActiveRef = useRef<boolean>(false);

  const activeSubject = useMemo(
    () => subjects.find((s) => s.id === selectedSubjectId) || subjects[0] || null,
    [subjects, selectedSubjectId]
  );

  const resourcesContext = useMemo(() => {
    if (!activeSubject) return '';
    return resources
      .filter((r) => r.subjectId === activeSubject.id)
      .map((r) => `${r.title}: ${r.summary}`)
      .join('\n');
  }, [activeSubject, resources]);

  const stopOutputAudio = () => {
    activeSourcesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    });
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    }
    setSpeakingNow(false);
  };

  const playPcmChunk = (base64Pcm: string) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;

    const binary = atob(base64Pcm);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackSpeed;
    source.connect(ctx.destination);

    const startTime = Math.max(nextStartTimeRef.current, ctx.currentTime + 0.02);
    source.start(startTime);
    nextStartTimeRef.current = startTime + buffer.duration / playbackSpeed;

    activeSourcesRef.current.add(source);
    setSpeakingNow(true);
    source.onended = () => {
      activeSourcesRef.current.delete(source);
      if (activeSourcesRef.current.size === 0) {
        setSpeakingNow(false);
      }
    };
  };

  const cleanupSession = () => {
    micActiveRef.current = false;
    setMicActive(false);
    setConnected(false);
    setConnecting(false);
    stopOutputAudio();

    try {
      processorRef.current?.disconnect();
    } catch {
      // ignore
    }
    processorRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (inputCtxRef.current) {
      void inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }
    if (outputCtxRef.current) {
      void outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      cleanupSession();
    };
  }, []);

  const appendTranscript = (role: 'user' | 'model', text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTranscripts((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role) {
        return [
          ...prev.slice(0, -1),
          { ...last, text: `${last.text} ${clean}`.trim() },
        ];
      }
      return [...prev, { id: `${Date.now()}_${Math.random()}`, role, text: clean }];
    });
  };

  const handleStartLive = async () => {
    if (connected || connecting) return;
    setError(null);
    setConnecting(true);

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const outCtx = new AudioCtx({ sampleRate: 24000 });
      await outCtx.resume();
      outputCtxRef.current = outCtx;
      nextStartTimeRef.current = outCtx.currentTime;

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = mediaStream;

      const inCtx = new AudioCtx({ sampleRate: 16000 });
      await inCtx.resume();
      inputCtxRef.current = inCtx;

      const sourceNode = inCtx.createMediaStreamSource(mediaStream);
      const processor = inCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live-tutor`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'init',
            subjectName: activeSubject?.name || 'General Study',
            mode,
            language: mode === 'pronunciation' || mode === 'vocab_test' ? language : '',
            resourcesContext,
            voiceName,
          })
        );
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data) as {
          type: string;
          data?: string;
          text?: string;
          message?: string;
        };

        if (msg.type === 'ready') {
          setConnecting(false);
          setConnected(true);
          micActiveRef.current = true;
          setMicActive(true);

          // Kick off opening greeting for oral exams or vocab drills
          if (mode !== 'voice_tutor') {
            ws.send(
              JSON.stringify({
                type: 'text',
                text: `Please begin the ${MODE_LABELS[mode].label} session now with your opening prompt.`,
              })
            );
          }
        } else if (msg.type === 'audio' && msg.data) {
          playPcmChunk(msg.data);
        } else if (msg.type === 'inputTranscript' && msg.text) {
          appendTranscript('user', msg.text);
        } else if (msg.type === 'outputTranscript' && msg.text) {
          appendTranscript('model', msg.text);
        } else if (msg.type === 'interrupted') {
          stopOutputAudio();
        } else if (msg.type === 'error') {
          setError(msg.message || 'Voice session error occurred.');
          cleanupSession();
        } else if (msg.type === 'closed') {
          cleanupSession();
        }
      };

      ws.onerror = () => {
        setError('Unable to establish real-time voice WebSocket connection.');
        cleanupSession();
      };

      processor.onaudioprocess = (e) => {
        if (!micActiveRef.current || ws.readyState !== WebSocket.OPEN) return;
        const floatSamples = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(floatSamples.length);
        for (let i = 0; i < floatSamples.length; i++) {
          const clamped = Math.max(-1, Math.min(1, floatSamples[i]));
          pcm16[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
        }
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        ws.send(JSON.stringify({ audio: btoa(binary) }));
      };

      sourceNode.connect(processor);
      processor.connect(inCtx.destination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Microphone access or Live API connection failed.');
      cleanupSession();
    }
  };

  const handleToggleMic = () => {
    const next = !micActive;
    micActiveRef.current = next;
    setMicActive(next);
  };

  const handleSendTextTurn = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInput.trim() || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    stopOutputAudio();
    const content = textInput.trim();
    setTextInput('');
    appendTranscript('user', content);
    wsRef.current.send(JSON.stringify({ type: 'text', text: content }));
  };

  const handleReplayTurnTts = async (turn: TranscriptTurn) => {
    if (ttsLoadingId === turn.id) {
      stopBrowserSpeech();
      setTtsLoadingId(null);
      return;
    }
    setTtsLoadingId(turn.id);
    try {
      await speakBrowserText({
        text: turn.text,
        lang: mode === 'pronunciation' && language ? language : 'en-US',
        rate: playbackSpeed,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not replay spoken turn.');
    } finally {
      setTtsLoadingId((curr) => (curr === turn.id ? null : curr));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            AI Voice Tutor & Oral Exam Room
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time spoken explanations, oral exam simulations, and language pronunciation with barge-in interruption.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 dark:text-slate-400">Speed</label>
          {[0.8, 1, 1.2, 1.4].map((spd) => (
            <button
              key={spd}
              type="button"
              onClick={() => setPlaybackSpeed(spd)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                playbackSpeed === spd
                  ? 'bg-indigo-600 text-white'
                  : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {spd}x
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Controls & Session Setup */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-5 h-fit">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Subject Context
            </label>
            <select
              value={activeSubject?.id || ''}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              disabled={connected}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm disabled:opacity-60"
            >
              {subjects.length === 0 ? (
                <option value="">General Academic Study</option>
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
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1.5">
              Session Mode
            </label>
            <div className="space-y-1.5">
              {(Object.keys(MODE_LABELS) as VoiceMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={connected}
                  onClick={() => setMode(m)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs transition-colors disabled:opacity-60 ${
                    mode === m
                      ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200'
                      : 'border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <p className="font-semibold">{MODE_LABELS[m].label}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{MODE_LABELS[m].desc}</p>
                </button>
              ))}
            </div>
          </div>

          {(mode === 'pronunciation' || mode === 'vocab_test') && (
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Target Language
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                disabled={connected}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
              >
                {['French', 'Spanish', 'German', 'Italian', 'Japanese', 'Mandarin', 'Portuguese'].map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Tutor Voice
            </label>
            <select
              value={voiceName}
              onChange={(e) => setVoiceName(e.target.value)}
              disabled={connected}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            >
              {VOICES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className="pt-2 space-y-2.5">
            {!connected ? (
              <button
                type="button"
                onClick={handleStartLive}
                disabled={connecting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-60"
              >
                <Mic className="w-4 h-4" />
                {connecting ? 'Connecting Microphone...' : 'Start Live Voice Session'}
              </button>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleToggleMic}
                    className={`inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium border ${
                      micActive
                        ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {micActive ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
                    {micActive ? 'Mic Live' : 'Mic Muted'}
                  </button>
                  <button
                    type="button"
                    onClick={stopOutputAudio}
                    disabled={!speakingNow}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-amber-200 dark:border-amber-900/50 text-amber-700 dark:text-amber-300 text-xs font-medium disabled:opacity-40"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    Interrupt AI
                  </button>
                </div>
                <button
                  type="button"
                  onClick={cleanupSession}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  End Voice Session
                </button>
              </>
            )}
          </div>
        </div>

        {/* Live Transcript & Barge-In Console */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] flex flex-col min-h-[520px]">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Waves className={`w-4 h-4 ${connected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
              <span className="text-sm font-semibold text-slate-900 dark:text-white">
                {connected ? (speakingNow ? 'Gemini is speaking...' : 'Listening to you...') : 'Session Ready'}
              </span>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {MODE_LABELS[mode].label} · {playbackSpeed}x speed
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {transcripts.length === 0 ? (
              <div className="py-16 text-center space-y-2">
                <Volume2 className="w-8 h-8 text-indigo-500 mx-auto opacity-80" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Start a voice conversation or oral exam
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Speak naturally into your microphone. You can interrupt mid-sentence to ask clarifying questions or adjust speaking speed anytime.
                </p>
              </div>
            ) : (
              transcripts.map((t) => (
                <div
                  key={t.id}
                  className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      t.role === 'user'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800/80 text-slate-800 dark:text-slate-100'
                    }`}
                  >
                    <p>{t.text}</p>
                    {t.role === 'model' && (
                      <button
                        type="button"
                        onClick={() => void handleReplayTurnTts(t)}
                        disabled={ttsLoadingId === t.id}
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                      >
                        <Play className="w-3 h-3" />
                        {ttsLoadingId === t.id ? 'Synthesizing...' : `Replay at ${playbackSpeed}x`}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={handleSendTextTurn}
            className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2.5"
          >
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              disabled={!connected}
              placeholder={
                connected
                  ? 'Type an interruption or follow-up question during your voice call...'
                  : 'Start a live session to speak or send live prompts...'
              }
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!connected || !textInput.trim()}
              className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-50"
              aria-label="Send prompt to voice session"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
