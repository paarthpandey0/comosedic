import { useEffect, useState } from 'react';
import {
  BookmarkPlus,
  CheckCircle2,
  Languages,
  Loader2,
  Sparkles,
  Trash2,
  Volume2,
  XCircle,
} from 'lucide-react';
import type { Subject, VocabItem } from '../types';
import {
  checkLanguageExercise,
  generateLanguageLab,
} from '../services/geminiApi';
import { speakBrowserText, stopBrowserSpeech } from '../utils/browserSpeech';
import {
  createVocabItemsBatch,
  deleteVocabItem,
  updateVocabMastery,
} from '../services/studyDb';

interface LanguageLabViewProps {
  uid: string;
  subjects: Subject[];
  vocabItems: VocabItem[];
}

interface LabSessionData {
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
}

export function LanguageLabView({ uid, subjects, vocabItems }: LanguageLabViewProps) {
  const [language, setLanguage] = useState('French');
  const [level, setLevel] = useState('intermediate');
  const [focusMode, setFocusMode] = useState('mixed');
  const [topic, setTopic] = useState('Everyday & Academic');
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id || 'general');
  const [speed, setSpeed] = useState<number>(1);

  const [generating, setGenerating] = useState(false);
  const [labData, setLabData] = useState<LabSessionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [speakingText, setSpeakingText] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState<string | null>(null);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedbacks, setFeedbacks] = useState<
    Record<string, { isCorrect: boolean; feedback: string; correctedSentence: string }>
  >({});
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setError(null);
    setAnswers({});
    setFeedbacks({});
    setShowSummary(false);
    try {
      const data = await generateLanguageLab({ language, level, focusMode, topic });
      setLabData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build language lab session.');
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    return () => stopBrowserSpeech();
  }, []);

  const handleSpeak = async (text: string) => {
    if (speakingText === text) {
      stopBrowserSpeech();
      setSpeakingText(null);
      return;
    }
    setSpeakingText(text);
    setError(null);
    try {
      await speakBrowserText({
        text,
        lang: language,
        rate: speed,
        onEnd: () => setSpeakingText((curr) => (curr === text ? null : curr)),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audio playback failed.');
    } finally {
      setSpeakingText((curr) => (curr === text ? null : curr));
    }
  };

  const handleSaveAllVocab = async () => {
    if (!labData?.vocabulary.length) return;
    const validSubjectId = subjects.some((s) => s.id === selectedSubjectId)
      ? selectedSubjectId
      : subjects[0]?.id || 'general';
    await createVocabItemsBatch(uid, validSubjectId, language, labData.vocabulary);
    setSavedToast(`Saved ${labData.vocabulary.length} ${language} entries to your Personal Dictionary.`);
    setTimeout(() => setSavedToast(null), 3500);
  };

  const handleCheckExercise = async (ex: LabSessionData['exercises'][number]) => {
    const ans = (answers[ex.id] || '').trim();
    if (!ans) return;
    setCheckingId(ex.id);
    try {
      const res = await checkLanguageExercise({
        language,
        prompt: ex.prompt,
        targetAnswer: ex.targetAnswer,
        studentAnswer: ans,
      });
      setFeedbacks((p) => ({ ...p, [ex.id]: res }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not verify answer.');
    } finally {
      setCheckingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            AI Language Learning Lab
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Vocabulary trainer, verb conjugations, grammar & translation drills, listening comprehension with Gemini audio, and your saved dictionary.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400">Audio Speed</span>
          {[0.75, 1, 1.25].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                speed === s
                  ? 'bg-indigo-600 text-white'
                  : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {savedToast && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {savedToast}
        </div>
      )}

      {/* Session Builder */}
      <form
        onSubmit={handleGenerate}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end"
      >
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Language</label>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          >
            {['French', 'Spanish', 'German', 'Italian', 'Portuguese', 'Japanese', 'Mandarin'].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Proficiency</label>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          >
            <option value="beginner">Beginner (A1–A2)</option>
            <option value="intermediate">Intermediate (B1–B2)</option>
            <option value="advanced">Advanced (C1–C2)</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Focus</label>
          <select
            value={focusMode}
            onChange={(e) => setFocusMode(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          >
            <option value="mixed">Full Balanced Practice</option>
            <option value="conjugation">Verb Conjugations</option>
            <option value="grammar">Grammar & Syntax</option>
            <option value="translation">Translation & Reading</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Topic</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Travel, Literature, Debate..."
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={generating}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-60"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {generating ? 'Building...' : 'Generate Lab'}
        </button>
      </form>

      {labData && (
        <div className="space-y-6">
          {/* Vocabulary & Conjugations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Vocabulary Builder ({language})
                </h2>
                <button
                  type="button"
                  onClick={() => void handleSaveAllVocab()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 dark:border-indigo-800 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  Save All to Dictionary
                </button>
              </div>
              <div className="space-y-2.5">
                {labData.vocabulary.map((v, i) => (
                  <div
                    key={i}
                    className="rounded-xl border border-slate-100 dark:border-slate-800 p-3 flex items-start justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {v.term}{' '}
                        <span className="font-normal text-xs text-slate-400">· {v.partOfSpeech}</span>
                      </p>
                      <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">{v.translation}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">{v.exampleSentence}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleSpeak(`${v.term}. ${v.exampleSentence}`)}
                      disabled={speakingText !== null}
                      className="p-2 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
                      aria-label={`Pronounce ${v.term}`}
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Verb Conjugation Studio
              </h2>
              <div className="space-y-4">
                {labData.conjugations.map((c, idx) => (
                  <div key={idx} className="rounded-xl border border-slate-100 dark:border-slate-800 p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">{c.verb}</p>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{c.tense}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {c.forms.map((f, fi) => (
                        <div
                          key={fi}
                          className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900/60"
                        >
                          <span className="text-slate-500 dark:text-slate-400">{f.pronoun}</span>
                          <span className="font-medium text-slate-900 dark:text-white">{f.form}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Reading & Listening Comprehension */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Listening & Reading Comprehension
              </h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSpeak(labData.readingPassage.passage)}
                  disabled={speakingText !== null}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-60"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  {speakingText === labData.readingPassage.passage ? 'Speaking...' : `Listen (${speed}x)`}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSummary((s) => !s)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  {showSummary ? 'Hide Translation' : 'Show English Summary'}
                </button>
              </div>
            </div>

            <p className="text-sm text-slate-800 dark:text-slate-100 leading-relaxed bg-slate-50 dark:bg-slate-900/60 rounded-xl p-4">
              {labData.readingPassage.passage}
            </p>

            {showSummary && (
              <p className="text-xs text-slate-600 dark:text-slate-300 bg-indigo-50/50 dark:bg-indigo-950/30 rounded-xl p-3">
                {labData.readingPassage.englishSummary}
              </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {labData.readingPassage.questions.map((q, idx) => (
                <div key={idx} className="rounded-xl border border-slate-100 dark:border-slate-800 p-3 text-xs space-y-1">
                  <p className="font-semibold text-slate-900 dark:text-white">{q.q}</p>
                  {showSummary && <p className="text-emerald-700 dark:text-emerald-300">Answer: {q.a}</p>}
                </div>
              ))}
            </div>
          </div>

          {/* Interactive Grammar, Sentence & Translation Drills */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Grammar, Sentence Construction & Translation Practice
            </h2>
            <div className="space-y-4">
              {labData.exercises.map((ex) => {
                const fb = feedbacks[ex.id];
                return (
                  <div key={ex.id} className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 space-y-2.5">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-medium text-indigo-600 dark:text-indigo-400 uppercase">{ex.type}</span>
                      <span>Hint: {ex.hint}</span>
                    </div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">{ex.prompt}</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={answers[ex.id] || ''}
                        onChange={(e) => setAnswers((p) => ({ ...p, [ex.id]: e.target.value }))}
                        placeholder={`Type your ${language} response...`}
                        className="flex-1 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCheckExercise(ex)}
                        disabled={checkingId === ex.id || !(answers[ex.id] || '').trim()}
                        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-60"
                      >
                        {checkingId === ex.id ? 'Checking...' : 'Check'}
                      </button>
                    </div>
                    {fb && (
                      <div
                        className={`rounded-xl p-3 text-xs space-y-1 ${
                          fb.isCorrect
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
                            : 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200'
                        }`}
                      >
                        <p className="font-semibold flex items-center gap-1">
                          {fb.isCorrect ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                          {fb.correctedSentence}
                        </p>
                        <p>{fb.feedback}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Personal Vocabulary Dictionary */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Languages className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              Personal Vocabulary Dictionary ({vocabItems.length})
            </h2>
          </div>
          {subjects.length > 0 && (
            <select
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
            >
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  Link saves to: {s.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {vocabItems.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Generate a Language Lab above and save new vocabulary terms to build your personal dictionary.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {vocabItems.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-slate-100 dark:border-slate-800 p-3.5 flex flex-col justify-between gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{item.term}</p>
                    <p className="text-xs text-indigo-600 dark:text-indigo-400">
                      {item.translation} · {item.language}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void handleSpeak(item.term)}
                      className="p-1 text-slate-400 hover:text-indigo-600"
                      aria-label="Speak term"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteVocabItem(item.id)}
                      className="p-1 text-slate-400 hover:text-rose-600"
                      aria-label="Delete term"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500">
                  <span>Mastery: {item.mastery}/5</span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => void updateVocabMastery(item.id, m)}
                        className={`w-4 h-4 rounded text-[10px] font-medium ${
                          item.mastery >= m
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
