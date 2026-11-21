import { useState } from 'react';
import { Compass, ExternalLink, Loader2, Search } from 'lucide-react';
import type { Subject } from '../types';
import { discoverStudyResources } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';

interface ResourceDiscoveryViewProps {
  subjects: Subject[];
}

export function ResourceDiscoveryView({ subjects }: ResourceDiscoveryViewProps) {
  const [subjectId, setSubjectId] = useState(subjects[0]?.id || 'general');
  const [topic, setTopic] = useState('');
  const [resourceKind, setResourceKind] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    guideMarkdown: string;
    sources: Array<{ title: string; uri: string }>;
    queriesUsed: string[];
  } | null>(null);

  const handleDiscover = async () => {
    if (!topic.trim()) {
      setError('Enter a topic to discover verified learning resources.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const subjectName = subjects.find((s) => s.id === subjectId)?.name || 'General Study';
      const res = await discoverStudyResources({
        subjectName,
        topic: topic.trim(),
        resourceKind,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Discovery search failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
          <Compass className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
          AI Resource Discovery
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Powered by Google Search grounding — discover verified articles, lecture notes, videos, and practice problems with direct source links.
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
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleDiscover();
          }}
          placeholder="Topic (e.g., Fourier Transforms, Krebs Cycle, French Subjunctive)"
          className="md:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
        />

        <div className="flex gap-2">
          <select
            value={resourceKind}
            onChange={(e) => setResourceKind(e.target.value)}
            className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            <option value="all">All Types</option>
            <option value="articles and lecture notes">Articles &amp; Notes</option>
            <option value="educational videos">Videos</option>
            <option value="practice problems">Practice Problems</option>
            <option value="open textbooks">Open Textbooks</option>
          </select>
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleDiscover()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            Find
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300">{error}</div>}

      {result && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6">
            <MarkdownView content={result.guideMarkdown} />
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-3 h-fit">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Verified Source Links ({result.sources.length})
            </h2>
            {result.sources.length === 0 ? (
              <p className="text-xs text-slate-500">No direct grounding URLs returned for this query.</p>
            ) : (
              <div className="space-y-2">
                {result.sources.map((src) => (
                  <a
                    key={src.uri}
                    href={src.uri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-xl border border-slate-200 dark:border-slate-800 p-3 hover:border-indigo-500 transition-colors"
                  >
                    <span className="flex items-start justify-between gap-2 text-xs font-semibold text-indigo-700 dark:text-indigo-400">
                      <span className="line-clamp-2">{src.title}</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    </span>
                    <span className="block text-[11px] text-slate-400 truncate mt-1">{src.uri}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
