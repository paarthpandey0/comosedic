import { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { ArrowRight, BookOpen, Brain, Calendar, CheckCircle2, Layers } from 'lucide-react';
import { auth, googleProvider } from '../firebase';
import heroStudyDeskImg from '../assets/images/hero_study_desk_1794946788869.jpg';

export function AuthGate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to sign in right now.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#131720] text-[#0F172A] dark:text-[#F1F5F9] flex flex-col">
      <header className="w-full max-w-7xl mx-auto px-6 py-5 flex items-center justify-between gap-8">
        <span className="font-display text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
          Lumina Study
        </span>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
          <a href="#features" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
            Workspaces
          </a>
          <a href="#features" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
            AI Tutor
          </a>
          <a href="#features" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
            Assessments
          </a>
          <a href="#features" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
            Planner
          </a>
        </nav>
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </header>

      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
        <div className="lg:col-span-6 flex flex-col justify-center">
          <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400 tracking-wide mb-3">
            Personal Academic Intelligence
          </p>
          <h1
            className="font-display text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight text-slate-900 dark:text-white leading-[1.15] mb-5"
            style={{ textWrap: 'balance' }}
          >
            Your textbooks, notes, and adaptive tutor in one focused workspace.
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl mb-8">
            Upload PDFs, Word documents, lecture slides, or handwritten note photos. Lumina organizes every subject, synthesizes exam-ready notes, schedules spaced-repetition flashcards, grades practice exams, and adapts to your knowledge gaps.
          </p>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-8">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="inline-flex items-center gap-3 px-6 py-3 rounded-xl bg-slate-900 dark:bg-indigo-600 hover:bg-slate-800 dark:hover:bg-indigo-500 disabled:opacity-60 text-white font-medium text-sm transition-colors shadow-sm"
            >
              <span>{loading ? 'Connecting account...' : 'Continue with Google'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Synced securely across sessions with Cloud Firestore
            </span>
          </div>

          {error && (
            <div className="mb-6 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          )}

          <div id="features" className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-6 border-t border-slate-200 dark:border-slate-800">
            <div className="flex items-start gap-3">
              <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400 mt-1 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Document Synthesis</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Extract definitions, formulas, and quick, detailed, or exam notes.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400 mt-1 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Spaced Flashcards</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  SM-2 scheduling adapts intervals from your recall ratings.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Brain className="w-4 h-4 text-indigo-600 dark:text-indigo-400 mt-1 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Socratic AI Tutor</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Subject-aware memory with 5 active-learning teaching modes.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 text-indigo-600 dark:text-indigo-400 mt-1 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Adaptive Planner</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Prioritizes imminent exams and weak topics automatically.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 flex items-stretch">
          <div className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] overflow-hidden flex flex-col justify-between shadow-sm">
            <div className="relative flex-1 min-h-[280px] bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <img
                src={heroStudyDeskImg}
                alt="Minimalist sunlit architectural study desk with open notebook"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="p-6 border-t border-slate-200 dark:border-slate-800 grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Formats</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">PDF · DOCX · PPTX</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Assessments</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">6 Question Types</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Memory</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  SM-2 Spaced
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
