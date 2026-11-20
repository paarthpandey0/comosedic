import { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cpu,
  Lock,
  LockOpen,
  RefreshCw,
  Shield,
  Sliders,
  Trash2,
} from 'lucide-react';
import type { AcademicMemory, AiTelemetryLog, PreferredModelMode, Subject } from '../types';
import { fetchControlCentreStatus, setControlCentreMode } from '../services/geminiApi';
import { updateAcademicMemory } from '../services/studyDb';

interface ControlCentreViewProps {
  uid: string;
  academicMemory: AcademicMemory | null;
  subjects: Subject[];
  telemetryLogs: AiTelemetryLog[];
}

export function ControlCentreView({
  uid,
  academicMemory,
  subjects,
  telemetryLogs,
}: ControlCentreViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingMode, setUpdatingMode] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  const [statusData, setStatusData] = useState<Awaited<
    ReturnType<typeof fetchControlCentreStatus>
  > | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchControlCentreStatus();
      setStatusData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach Gemini Control Centre.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  const currentMode: PreferredModelMode =
    academicMemory?.preferredModelMode || statusData?.preferredMode || 'auto';

  const handleSelectMode = async (mode: PreferredModelMode) => {
    setUpdatingMode(true);
    try {
      await Promise.all([
        setControlCentreMode(mode),
        updateAcademicMemory(uid, { preferredModelMode: mode }),
      ]);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to switch routing mode.');
    } finally {
      setUpdatingMode(false);
    }
  };

  const blockedIds = academicMemory?.aiPrivacyBlockedSubjectIds || [];

  const handleToggleSubjectPrivacy = async (subjectId: string) => {
    const next = blockedIds.includes(subjectId)
      ? blockedIds.filter((id) => id !== subjectId)
      : [...blockedIds, subjectId];
    await updateAcademicMemory(uid, { aiPrivacyBlockedSubjectIds: next });
  };

  const handleClearAiMemory = async () => {
    await updateAcademicMemory(uid, {
      learningNotes: '',
      recurringMistakes: [],
      weeklyReport: '',
    });
    setResetMsg('Cleared AI weekly reports, recurring mistake notes, and diagnostic summaries.');
  };

  const promptTokens = statusData?.telemetry.totalPromptTokens || 0;
  const outputTokens = statusData?.telemetry.totalOutputTokens || 0;
  // Standard reference estimate if on pay-as-you-go; clearly marked $0.00 on Free Tier
  const referenceEquivalentUsd = ((promptTokens * 0.075 + outputTokens * 0.3) / 1_000_000).toFixed(4);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Gemini Control Centre & Multi-Model Architecture
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Inspect active Gemini API status, routing preferences, live token usage, capability matrix, and per-subject AI privacy controls.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadStatus()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#1A202C] text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 self-start"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Status
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Top KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>API Connection</span>
            <Activity className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="font-display text-xl font-bold text-slate-900 dark:text-white mt-2">
            {statusData?.apiKeyConfigured ? 'Connected (Free Tier)' : 'Not Configured'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            {statusData?.primaryCooldownSeconds
              ? `Primary failover active (${statusData.primaryCooldownSeconds}s)`
              : 'Primary + automatic resilience'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Session AI Requests</span>
            <Cpu className="w-4 h-4 text-indigo-600" />
          </div>
          <p className="font-display text-xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
            {statusData?.telemetry.totalRequests ?? 0}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            {statusData?.telemetry.failedRequests ?? 0} failed requests
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Token Telemetry</span>
            <Sliders className="w-4 h-4 text-blue-600" />
          </div>
          <p className="font-display text-xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
            {(promptTokens + outputTokens).toLocaleString()}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            {promptTokens.toLocaleString()} in · {outputTokens.toLocaleString()} out
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
            <span>Estimated Cost</span>
            <Shield className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="font-display text-xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">
            $0.00 (Free Tier)
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            Ref. pay-as-you-go equiv: ~${referenceEquivalentUsd}
          </p>
        </div>
      </div>

      {/* Model Routing & Multi-Model Capability Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Model Routing Strategy
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Control which free-tier Gemini engine handles study tasks on the backend.
          </p>

          <div className="space-y-2">
            {[
              {
                id: 'auto' as const,
                title: 'Auto Resilient (Recommended)',
                desc: 'Uses Gemini 4 Hydrogen and automatically switches to Gemini 3.1 Flash Lite during high demand or latency spikes.',
              },
              {
                id: 'primary' as const,
                title: 'Primary Reasoning',
                desc: 'Targets Gemini 4 Hydrogen first for maximum reasoning depth across textbooks and exams.',
              },
              {
                id: 'fast' as const,
                title: 'Fast Low-Latency',
                desc: 'Routes directly to Gemini 3.1 Flash Lite for rapid flashcards, grading, and quick Q&A.',
              },
            ].map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={updatingMode}
                onClick={() => void handleSelectMode(opt.id)}
                className={`w-full text-left rounded-xl border p-3.5 transition-colors ${
                  currentMode === opt.id
                    ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/30'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-900 dark:text-white">{opt.title}</span>
                  {currentMode === opt.id && <CheckCircle2 className="w-4 h-4 text-indigo-600" />}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{opt.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            Multi-Model AI Capability Matrix
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Transparent real-time view of connected free-tier Gemini models versus specialized modules requiring a paid API key.
          </p>

          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {(statusData?.models || []).map((m) => (
              <div key={m.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-white font-mono">{m.id}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {m.role} · {m.capabilities.join(', ')}
                  </p>
                </div>
                <span
                  className={`text-xs font-medium shrink-0 ${
                    m.connected
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {m.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Subject Privacy Locks & AI Memory Management */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            AI Subject Privacy Controls
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Locking a subject prevents its uploaded PDFs, notes, and summaries from being sent to Gemini prompts in tutors, lessons, and synthesis tools.
          </p>

          {subjects.length === 0 ? (
            <p className="text-xs text-slate-500">Create a subject workspace to manage per-subject AI privacy locks.</p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {subjects.map((subj) => {
                const blocked = blockedIds.includes(subj.id);
                return (
                  <div key={subj.id} className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{subj.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {blocked ? 'Private · Withheld from Gemini context' : 'Shared with Gemini Tutor & generators'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleToggleSubjectPrivacy(subj.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
                        blocked
                          ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      {blocked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                      {blocked ? 'AI Locked' : 'AI Allowed'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4">
          <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
            AI Diagnostics & Memory Controls
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Clear stored AI weekly diagnostic summaries and recurring mistake insights without deleting your uploaded files or flashcards.
          </p>
          <button
            type="button"
            onClick={() => void handleClearAiMemory()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 text-xs font-medium text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Reset Stored AI Diagnostic Memory
          </button>
          {resetMsg && <p className="text-xs text-emerald-600 dark:text-emerald-400">{resetMsg}</p>}
        </div>
      </div>

      {/* Live AI Task History & Failed Request Table */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 overflow-x-auto space-y-3">
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
          Recent Gemini Task Telemetry
        </h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <th className="text-left py-2 font-medium">Endpoint</th>
              <th className="text-left py-2 font-medium">Model</th>
              <th className="text-left py-2 font-medium">Status</th>
              <th className="text-right py-2 font-medium">Tokens</th>
              <th className="text-right py-2 font-medium">Latency</th>
              <th className="text-left py-2 pl-4 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {(statusData?.telemetry.recentEvents || telemetryLogs).length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-slate-500">
                  No Gemini API calls recorded in this server session yet.
                </td>
              </tr>
            ) : (
              (statusData?.telemetry.recentEvents || []).slice(0, 20).map((ev) => (
                <tr key={ev.id} className="h-10">
                  <td className="py-2 font-mono text-slate-800 dark:text-slate-200">{ev.endpoint}</td>
                  <td className="py-2 font-mono text-slate-600 dark:text-slate-300">{ev.modelUsed}</td>
                  <td className="py-2">
                    <span
                      className={`font-medium ${
                        ev.status === 'success' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
                      }`}
                    >
                      {ev.status}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                    {ev.promptTokens + ev.outputTokens}
                  </td>
                  <td className="py-2 text-right tabular-nums text-slate-600 dark:text-slate-300">
                    {ev.durationMs}ms
                  </td>
                  <td className="py-2 pl-4 text-slate-500 dark:text-slate-400 truncate max-w-xs">{ev.summary}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
