import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Send, Trash2 } from 'lucide-react';
import type { AcademicMemory, ComplexityPreference, Quiz, StudyResource, Subject, TutorMessage, TutorMode } from '../../types';
import {
  buildSubjectAiContext,
  createTutorMessage,
  deleteTutorMessage,
  toggleTutorMessageBookmark,
} from '../../services/studyDb';
import { streamTutorChat } from '../../services/geminiApi';
import { MarkdownView } from '../MarkdownView';

interface TutorPanelProps {
  uid: string;
  subject: Subject;
  resources: StudyResource[];
  quizzes: Quiz[];
  messages: TutorMessage[];
  academicMemory?: AcademicMemory | null;
  preferredComplexity?: ComplexityPreference;
  initialPrompt?: string;
  onInitialPromptConsumed?: () => void;
}

const MODES: Array<{ id: TutorMode; label: string; hint: string }> = [
  { id: 'general', label: 'Adaptive Tutor', hint: 'Balanced active learning & document citations' },
  { id: 'simple', label: 'Explain Simply', hint: 'Clear everyday intuition without heavy jargon' },
  { id: 'step_by_step', label: 'Step by Step', hint: 'Break down concepts or problems one step at a time' },
  { id: 'example', label: 'Give Example', hint: 'Worked examples grounded in your materials' },
  { id: 'test_me', label: 'Test My Knowledge', hint: 'Socratic questions & hints to check recall' },
  { id: 'explain_mistake', label: 'Explain My Mistake', hint: 'Diagnose where your reasoning went off track' },
];

export function TutorPanel({
  uid,
  subject,
  resources,
  quizzes,
  messages,
  academicMemory,
  preferredComplexity,
  initialPrompt,
  onInitialPromptConsumed,
}: TutorPanelProps) {
  const [mode, setMode] = useState<TutorMode>('general');
  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const subjectMessages = useMemo(
    () =>
      messages
        .filter((m) => m.subjectId === subject.id)
        .sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number } | undefined)?.seconds || 0;
          const tb = (b.createdAt as { seconds?: number } | undefined)?.seconds || 0;
          return ta - tb;
        }),
    [messages, subject.id]
  );

  const weakTopics = useMemo(() => {
    const set = new Set<string>();
    quizzes
      .filter((q) => q.subjectId === subject.id && q.status === 'completed')
      .forEach((q) => q.weakTopics.forEach((t) => set.add(t)));
    return Array.from(set);
  }, [quizzes, subject.id]);

  const resourcesContext = useMemo(
    () => buildSubjectAiContext(subject.id, resources, academicMemory || null, 45000),
    [resources, subject.id, academicMemory]
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [subjectMessages.length, streamingText]);

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);
    setStreamingText('');
    setInput('');

    try {
      await createTutorMessage(uid, {
        subjectId: subject.id,
        role: 'user',
        mode,
        content: trimmed,
      });

      const historyPayload = subjectMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const reply = await streamTutorChat(
        {
          subjectName: subject.name,
          mode,
          message: trimmed,
          history: historyPayload,
          resourcesContext,
          weakTopics,
          confidence: subject.confidence,
          preferredComplexity,
        },
        (partial) => {
          setStreamingText(partial);
        }
      );

      if (reply.trim()) {
        await createTutorMessage(uid, {
          subjectId: subject.id,
          role: 'model',
          mode,
          content: reply,
        });
      }
      setStreamingText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach Gemini AI Tutor.');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (initialPrompt && initialPrompt.trim() && !sending) {
      const promptCopy = initialPrompt;
      onInitialPromptConsumed?.();
      void sendMessage(promptCopy);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  const activeModeObj = MODES.find((m) => m.id === mode) || MODES[0];

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] flex flex-col h-[640px] overflow-hidden">
      {/* Teaching Mode Selector */}
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Personal AI Tutor · {subject.name}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {activeModeObj.hint} · Referencing {resources.filter((r) => r.subjectId === subject.id).length} uploaded resources
            </p>
          </div>
          {weakTopics.length > 0 && (
            <span className="text-xs text-amber-700 dark:text-amber-300">
              Focus gaps: {weakTopics.slice(0, 3).join(', ')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                mode === m.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Thread */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {subjectMessages.length === 0 && !streamingText && (
          <div className="max-w-lg mx-auto text-center py-10 space-y-4">
            <h4 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Start an active study dialogue
            </h4>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              Ask about any topic in {subject.name}, paste a homework attempt for mistake analysis, or switch to <strong>Test My Knowledge</strong> for Socratic practice.
            </p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              {[
                `Summarize the key concepts from my ${subject.name} resources`,
                `Quiz me on the hardest topic in ${subject.name}`,
                `Explain the core formulas step by step`,
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void sendMessage(suggestion)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors text-left"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {subjectMessages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-slate-900 dark:bg-indigo-600 text-white'
                  : 'bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100'
              }`}
            >
              {msg.role === 'user' ? (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <div>
                  <MarkdownView content={msg.content} className="text-sm" />
                  <div className="flex items-center justify-between gap-4 mt-3 pt-2 border-t border-slate-200/70 dark:border-slate-800 text-[11px] text-slate-400">
                    <span>{MODES.find((m) => m.id === msg.mode)?.label || 'Tutor'}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleTutorMessageBookmark(msg.id, !msg.isBookmarked)}
                        className={`inline-flex items-center gap-1 hover:text-indigo-600 dark:hover:text-indigo-400 ${
                          msg.isBookmarked ? 'text-indigo-600 dark:text-indigo-400 font-medium' : ''
                        }`}
                      >
                        <Bookmark className={`w-3.5 h-3.5 ${msg.isBookmarked ? 'fill-current' : ''}`} />
                        {msg.isBookmarked ? 'Saved' : 'Bookmark'}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteTutorMessage(msg.id)}
                        className="hover:text-rose-600 dark:hover:text-rose-400"
                        aria-label="Delete message"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {streamingText && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800">
              <MarkdownView content={streamingText} className="text-sm" />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* Input Bar */}
      <form
        onSubmit={handleSubmit}
        className="p-4 border-t border-slate-200 dark:border-slate-800 flex items-center gap-3 bg-white dark:bg-[#1A202C]"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
          placeholder={`Ask your ${subject.name} tutor (${activeModeObj.label})...`}
          className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap"
        >
          <Send className="w-4 h-4" />
          {sending ? 'Thinking...' : 'Send'}
        </button>
      </form>
    </div>
  );
}
