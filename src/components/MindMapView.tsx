import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  GitBranch,
  Loader2,
  Network,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { MindMap, MindMapNode, StudyNote, StudyResource, Subject, WorkspaceTab } from '../types';
import { generateMindMap, runSubjectLab } from '../services/geminiApi';
import { createMindMap, deleteMindMap } from '../services/studyDb';
import { MarkdownView } from './MarkdownView';

interface MindMapViewProps {
  uid: string;
  subjects: Subject[];
  resources: StudyResource[];
  notes: StudyNote[];
  mindMaps: MindMap[];
  onOpenSubject: (subjectId: string, tab?: WorkspaceTab) => void;
}

const NODE_COLORS: Record<string, string> = {
  indigo: 'bg-indigo-50 border-indigo-200 text-indigo-900 dark:bg-indigo-950/40 dark:border-indigo-800 dark:text-indigo-200',
  blue: 'bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-200',
  emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200',
  amber: 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-200',
  violet: 'bg-violet-50 border-violet-200 text-violet-900 dark:bg-violet-950/40 dark:border-violet-800 dark:text-violet-200',
  rose: 'bg-rose-50 border-rose-200 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200',
};

const SVG_STROKE_COLORS: Record<string, string> = {
  indigo: '#4F46E5',
  blue: '#2563EB',
  emerald: '#059669',
  amber: '#D97706',
  violet: '#7C3AED',
  rose: '#E11D48',
};

export function MindMapView({
  uid,
  subjects,
  resources,
  notes,
  mindMaps,
  onOpenSubject,
}: MindMapViewProps) {
  const [selectedSubjectId, setSelectedSubjectId] = useState(subjects[0]?.id || '');
  const [topicInput, setTopicInput] = useState('');
  const [sourceResourceId, setSourceResourceId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeMapId, setActiveMapId] = useState(mindMaps[0]?.id || '');
  const [viewStyle, setViewStyle] = useState<'graph' | 'tree'>('graph');
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [branchDeepDive, setBranchDeepDive] = useState<string>('');
  const [loadingBranch, setLoadingBranch] = useState(false);

  const activeSubject = useMemo(
    () => subjects.find((s) => s.id === selectedSubjectId) || subjects[0] || null,
    [subjects, selectedSubjectId]
  );

  const subjResources = useMemo(
    () => resources.filter((r) => !activeSubject || r.subjectId === activeSubject.id),
    [resources, activeSubject]
  );

  const activeMap = useMemo(
    () => mindMaps.find((m) => m.id === activeMapId) || mindMaps[0] || null,
    [mindMaps, activeMapId]
  );

  const selectedNode = useMemo(
    () => activeMap?.nodes.find((n) => n.id === selectedNodeId) || activeMap?.nodes[0] || null,
    [activeMap, selectedNodeId]
  );

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = subjResources.find((r) => r.id === sourceResourceId);
    const subjNotesText = notes
      .filter((n) => activeSubject && n.subjectId === activeSubject.id)
      .slice(0, 3)
      .map((n) => `${n.title}: ${n.content.slice(0, 4000)}`)
      .join('\n\n');

    const content = topicInput.trim()
      ? `${topicInput.trim()}\n\n${res ? res.extractedText.slice(0, 25000) : subjNotesText}`
      : res
        ? `${res.title}\n${res.summary}\n${res.extractedText.slice(0, 25000)}`
        : subjNotesText || activeSubject?.topics.join(', ') || activeSubject?.name || 'Core Study Concepts';

    setGenerating(true);
    setError(null);
    try {
      const generated = await generateMindMap({
        subjectName: activeSubject?.name || 'General Study',
        topicOrContent: content,
      });
      const id = await createMindMap(
        uid,
        activeSubject?.id || 'general',
        generated.title,
        generated.nodes
      );
      setActiveMapId(id);
      setSelectedNodeId(generated.nodes[0]?.id || null);
      setBranchDeepDive('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate mind map.');
    } finally {
      setGenerating(false);
    }
  };

  const handleExplainBranch = async (node: MindMapNode) => {
    setLoadingBranch(true);
    setBranchDeepDive('');
    try {
      const res = await runSubjectLab({
        domain: activeSubject?.name || 'Academic Study',
        task: `Explain the concept branch "${node.label}" (${node.category}), its prerequisites (${node.prerequisites.join(', ') || 'none'}), and how it connects to exam questions.`,
        input: node.definition,
      });
      setBranchDeepDive(res.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to expand node explanation.');
    } finally {
      setLoadingBranch(false);
    }
  };

  const handleDownloadSvg = () => {
    const svgEl = document.getElementById('lumina-knowledge-svg');
    if (!svgEl) return;
    const blob = new Blob([svgEl.outerHTML], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(activeMap?.title || 'mindmap').toLowerCase().replace(/\s+/g, '-')}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadJson = () => {
    if (!activeMap) return;
    const blob = new Blob([JSON.stringify(activeMap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeMap.title.toLowerCase().replace(/\s+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Compute radial / layered SVG positions for Knowledge Graph view
  const graphLayout = useMemo(() => {
    if (!activeMap) return [];
    const nodes = activeMap.nodes;
    const level0 = nodes.filter((n) => n.level === 0 || n.parentId === null);
    const level1 = nodes.filter((n) => n.level === 1 && n.parentId !== null);
    const level2 = nodes.filter((n) => n.level >= 2 && n.parentId !== null);

    const coords = new Map<string, { x: number; y: number }>();
    const cx = 460;
    const cy = 260;
    level0.forEach((n, idx) => coords.set(n.id, { x: cx, y: cy + idx * 40 }));

    level1.forEach((n, idx) => {
      const angle = (idx / Math.max(1, level1.length)) * Math.PI * 2 - Math.PI / 2;
      coords.set(n.id, {
        x: Math.round(cx + Math.cos(angle) * 165),
        y: Math.round(cy + Math.sin(angle) * 125),
      });
    });

    level2.forEach((n, idx) => {
      const parentPos = (n.parentId && coords.get(n.parentId)) || { x: cx, y: cy };
      const siblings = level2.filter((s) => s.parentId === n.parentId);
      const sIdx = Math.max(0, siblings.findIndex((s) => s.id === n.id));
      const baseAngle = Math.atan2(parentPos.y - cy, parentPos.x - cx);
      const offset = (sIdx - (siblings.length - 1) / 2) * 0.45;
      const a = baseAngle + offset + (idx === 0 ? 0 : 0.01);
      coords.set(n.id, {
        x: Math.max(85, Math.min(835, Math.round(cx + Math.cos(a) * 320))),
        y: Math.max(45, Math.min(475, Math.round(cy + Math.sin(a) * 215))),
      });
    });

    return nodes.map((n) => ({
      node: n,
      pos: coords.get(n.id) || { x: cx, y: cy },
    }));
  }, [activeMap]);

  const renderTreeBranch = (parentId: string | null, depth: number) => {
    if (!activeMap) return null;
    const children = activeMap.nodes.filter((n) => (depth === 0 ? n.parentId === null : n.parentId === parentId));
    if (children.length === 0) return null;

    return (
      <div className={depth > 0 ? 'ml-5 pl-3 border-l border-slate-200 dark:border-slate-700 space-y-2' : 'space-y-2'}>
        {children.map((node) => {
          const hasKids = activeMap.nodes.some((c) => c.parentId === node.id);
          const collapsed = Boolean(collapsedIds[node.id]);
          const tone = NODE_COLORS[node.color] || NODE_COLORS.indigo;
          const isSelected = selectedNode?.id === node.id;

          return (
            <div key={node.id} className="space-y-1.5">
              <div
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition-colors ${tone} ${
                  isSelected ? 'ring-2 ring-indigo-500' : ''
                }`}
              >
                {hasKids ? (
                  <button
                    type="button"
                    onClick={() => setCollapsedIds((p) => ({ ...p, [node.id]: !p[node.id] }))}
                    className="p-0.5"
                    aria-label="Toggle branch"
                  >
                    {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                ) : (
                  <span className="w-4" />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedNodeId(node.id);
                    setBranchDeepDive('');
                  }}
                  className="flex-1 text-left font-semibold"
                >
                  {node.label}
                </button>
                <span className="text-[11px] opacity-75">{node.category}</span>
              </div>
              {!collapsed && renderTreeBranch(node.id, depth + 1)}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            AI Mind Maps & Knowledge Graph
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Visualize connected concepts, prerequisite chains, definitions, and branch-by-branch AI explanations.
          </p>
        </div>

        {activeMap && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadSvg}
              disabled={viewStyle !== 'graph'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              Export SVG
            </button>
            <button
              type="button"
              onClick={handleDownloadJson}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
            >
              <Download className="w-3.5 h-3.5" />
              Export JSON
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Generator Bar */}
      <form
        onSubmit={handleGenerate}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
      >
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Subject</label>
          <select
            value={activeSubject?.id || ''}
            onChange={(e) => setSelectedSubjectId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          >
            {subjects.length === 0 ? (
              <option value="general">General Study</option>
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
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
            Source Material (Optional)
          </label>
          <select
            value={sourceResourceId}
            onChange={(e) => setSourceResourceId(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          >
            <option value="">All Subject Notes / Syllabus</option>
            {subjResources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
            Focus Topic / Chapter
          </label>
          <input
            type="text"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder="e.g., Mechanics, Cell Respiration..."
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={generating}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-60"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          {generating ? 'Mapping...' : 'Generate Mind Map'}
        </button>
      </form>

      {/* Saved Mind Maps Selector */}
      {mindMaps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {mindMaps.map((m) => (
            <div
              key={m.id}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium ${
                activeMap?.id === m.id
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] text-slate-600 dark:text-slate-300'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveMapId(m.id);
                  setSelectedNodeId(m.nodes[0]?.id || null);
                  setBranchDeepDive('');
                }}
              >
                {m.title}
              </button>
              <button
                type="button"
                onClick={() => void deleteMindMap(m.id)}
                className="text-slate-400 hover:text-rose-600"
                aria-label="Delete mind map"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!activeMap ? (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-12 text-center space-y-2">
          <Network className="w-8 h-8 text-indigo-500 mx-auto" />
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
            Generate your first interactive Mind Map or Knowledge Graph
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Select a subject or document above to visualize prerequisite chains and expandable topic branches.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Canvas: Visual Knowledge Graph or Expandable Tree */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                {activeMap.title}
              </h2>
              <div className="flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewStyle('graph')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${
                    viewStyle === 'graph'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Network className="w-3.5 h-3.5" />
                  Graph
                </button>
                <button
                  type="button"
                  onClick={() => setViewStyle('tree')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${
                    viewStyle === 'tree'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <GitBranch className="w-3.5 h-3.5" />
                  Expandable Tree
                </button>
              </div>
            </div>

            {viewStyle === 'graph' ? (
              <div className="overflow-x-auto rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50">
                <svg
                  id="lumina-knowledge-svg"
                  viewBox="0 0 920 520"
                  className="w-full min-w-[680px] h-[440px]"
                >
                  {/* Edges */}
                  {graphLayout.map(({ node, pos }) => {
                    if (!node.parentId) return null;
                    const parent = graphLayout.find((g) => g.node.id === node.parentId);
                    if (!parent) return null;
                    const stroke = SVG_STROKE_COLORS[node.color] || '#64748B';
                    return (
                      <line
                        key={`edge_${node.id}`}
                        x1={parent.pos.x}
                        y1={parent.pos.y}
                        x2={pos.x}
                        y2={pos.y}
                        stroke={stroke}
                        strokeOpacity={0.4}
                        strokeWidth={2}
                      />
                    );
                  })}

                  {/* Nodes */}
                  {graphLayout.map(({ node, pos }) => {
                    const isSelected = selectedNode?.id === node.id;
                    const fill = SVG_STROKE_COLORS[node.color] || '#4F46E5';
                    const boxW = node.level === 0 ? 156 : 136;
                    const boxH = node.level === 0 ? 44 : 36;
                    return (
                      <g
                        key={node.id}
                        transform={`translate(${pos.x - boxW / 2}, ${pos.y - boxH / 2})`}
                        onClick={() => {
                          setSelectedNodeId(node.id);
                          setBranchDeepDive('');
                        }}
                        className="cursor-pointer"
                      >
                        <rect
                          width={boxW}
                          height={boxH}
                          rx={10}
                          fill={isSelected ? fill : '#FFFFFF'}
                          stroke={fill}
                          strokeWidth={isSelected ? 3 : 1.75}
                        />
                        <text
                          x={boxW / 2}
                          y={boxH / 2 + 4}
                          textAnchor="middle"
                          fontSize={node.level === 0 ? 12 : 11}
                          fontWeight={node.level === 0 ? 700 : 600}
                          fill={isSelected ? '#FFFFFF' : '#0F172A'}
                        >
                          {node.label.length > 20 ? `${node.label.slice(0, 19)}…` : node.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            ) : (
              <div className="max-h-[480px] overflow-y-auto pr-1">{renderTreeBranch(null, 0)}</div>
            )}
          </div>

          {/* Node Inspector & Deep Dive */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4 h-fit">
            {selectedNode ? (
              <>
                <div>
                  <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                    {selectedNode.category} · Level {selectedNode.level}
                  </span>
                  <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                    {selectedNode.label}
                  </h3>
                </div>

                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                  {selectedNode.definition}
                </p>

                {selectedNode.prerequisites.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                      Prerequisite Concepts
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {selectedNode.prerequisites.join(' · ')}
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => void handleExplainBranch(selectedNode)}
                    disabled={loadingBranch}
                    className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-60"
                  >
                    {loadingBranch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {loadingBranch ? 'Explaining Branch...' : 'Ask Gemini to Explain Branch'}
                  </button>

                  {activeMap.subjectId && subjects.some((s) => s.id === activeMap.subjectId) && (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenSubject(activeMap.subjectId, 'notes')}
                        className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Related Notes
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpenSubject(activeMap.subjectId, 'quizzes')}
                        className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                      >
                        Start Quiz
                      </button>
                    </div>
                  )}
                </div>

                {branchDeepDive && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-sm">
                    <MarkdownView content={branchDeepDive} />
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs text-slate-500">Click any node on the map to inspect definitions and prerequisites.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
