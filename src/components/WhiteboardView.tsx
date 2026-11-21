import { useEffect, useRef, useState } from 'react';
import {
  CheckSquare,
  Circle,
  Eraser,
  FileText,
  Grid,
  ImagePlus,
  Loader2,
  Minus,
  PenTool,
  RotateCcw,
  Save,
  Sparkles,
  Square,
  Trash2,
  Type as TypeIcon,
} from 'lucide-react';
import type { Subject, WhiteboardBoard } from '../types';
import {
  createNote,
  createWhiteboardBoard,
  deleteWhiteboardBoard,
  updateWhiteboardBoard,
} from '../services/studyDb';
import { analyzeWhiteboardImage } from '../services/geminiApi';
import { MarkdownView } from './MarkdownView';

interface WhiteboardViewProps {
  uid: string;
  subjects: Subject[];
  whiteboards: WhiteboardBoard[];
}

type DrawTool = 'pen' | 'eraser' | 'line' | 'rect' | 'circle' | 'text';

interface StrokeElement {
  id: string;
  tool: DrawTool;
  color: string;
  width: number;
  points?: Array<{ x: number; y: number }>;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  text?: string;
}

const COLORS = ['#0f172a', '#4f46e5', '#0284c7', '#059669', '#d97706', '#dc2626'];
const MATH_SYMBOLS = ['∑', '∫', '∂', '√', 'π', 'θ', 'Δ', 'λ', '→', '≈', '≤', '≥', '±', '∞'];

export function WhiteboardView({ uid, subjects, whiteboards }: WhiteboardViewProps) {
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [subjectId, setSubjectId] = useState<string>(subjects[0]?.id || 'general');
  const [title, setTitle] = useState<string>('Untitled Study Board');
  const [tool, setTool] = useState<DrawTool>('pen');
  const [color, setColor] = useState<string>('#0f172a');
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [textDraft, setTextDraft] = useState<string>('');
  const [strokes, setStrokes] = useState<StrokeElement[]>([]);
  const [aiNotes, setAiNotes] = useState<string>('');
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const drawingRef = useRef<{
    active: boolean;
    start: { x: number; y: number };
    current: StrokeElement | null;
  }>({ active: false, start: { x: 0, y: 0 }, current: null });

  const redrawCanvas = (elements: StrokeElement[], preview?: StrokeElement | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (showGrid) {
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      for (let x = 0; x <= canvas.width; x += 28) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y <= canvas.height; y += 28) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
      // Subtle axes
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, 0);
      ctx.lineTo(canvas.width / 2, canvas.height);
      ctx.moveTo(0, canvas.height / 2);
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    }

    if (bgImageRef.current) {
      const img = bgImageRef.current;
      const scale = Math.min((canvas.width - 40) / img.width, (canvas.height - 40) / img.height, 1);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    }

    const drawOne = (el: StrokeElement) => {
      ctx.strokeStyle = el.tool === 'eraser' ? '#ffffff' : el.color;
      ctx.fillStyle = el.color;
      ctx.lineWidth = el.tool === 'eraser' ? el.width * 4 : el.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if ((el.tool === 'pen' || el.tool === 'eraser') && el.points && el.points.length > 0) {
        ctx.beginPath();
        ctx.moveTo(el.points[0].x, el.points[0].y);
        for (let i = 1; i < el.points.length; i++) {
          ctx.lineTo(el.points[i].x, el.points[i].y);
        }
        ctx.stroke();
      } else if (el.tool === 'line' && el.start && el.end) {
        ctx.beginPath();
        ctx.moveTo(el.start.x, el.start.y);
        ctx.lineTo(el.end.x, el.end.y);
        ctx.stroke();
      } else if (el.tool === 'rect' && el.start && el.end) {
        ctx.strokeRect(el.start.x, el.start.y, el.end.x - el.start.x, el.end.y - el.start.y);
      } else if (el.tool === 'circle' && el.start && el.end) {
        const rx = Math.hypot(el.end.x - el.start.x, el.end.y - el.start.y);
        ctx.beginPath();
        ctx.arc(el.start.x, el.start.y, rx, 0, Math.PI * 2);
        ctx.stroke();
      } else if (el.tool === 'text' && el.start && el.text) {
        ctx.font = '600 18px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(el.text, el.start.x, el.start.y);
      }
    };

    elements.forEach(drawOne);
    if (preview) drawOne(preview);
  };

  useEffect(() => {
    redrawCanvas(strokes);
  }, [strokes, showGrid]);

  const getPointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const pos = getPointerPos(e);

    if (tool === 'text') {
      const content = textDraft.trim();
      if (!content) {
        setError('Enter text or tap a math symbol first, then click the board to place it.');
        return;
      }
      setError('');
      const el: StrokeElement = {
        id: `st_${Date.now()}`,
        tool: 'text',
        color,
        width: strokeWidth,
        start: pos,
        text: content,
      };
      setStrokes((prev) => [...prev, el]);
      return;
    }

    const base: StrokeElement = {
      id: `st_${Date.now()}`,
      tool,
      color,
      width: strokeWidth,
      points: tool === 'pen' || tool === 'eraser' ? [pos] : undefined,
      start: pos,
      end: pos,
    };
    drawingRef.current = { active: true, start: pos, current: base };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current.active || !drawingRef.current.current) return;
    const pos = getPointerPos(e);
    const cur = drawingRef.current.current;
    if (cur.tool === 'pen' || cur.tool === 'eraser') {
      cur.points = [...(cur.points || []), pos];
    } else {
      cur.end = pos;
    }
    redrawCanvas(strokes, cur);
  };

  const handlePointerUp = () => {
    if (!drawingRef.current.active || !drawingRef.current.current) return;
    const finished = drawingRef.current.current;
    drawingRef.current = { active: false, start: { x: 0, y: 0 }, current: null };
    setStrokes((prev) => [...prev, finished]);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        bgImageRef.current = img;
        redrawCanvas(strokes);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleAnalyzeBoard = async (mode: 'notes' | 'check_work' | 'diagram') => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setAnalyzing(true);
    setError('');
    setNotice('');
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const subjectName = subjects.find((s) => s.id === subjectId)?.name || 'General';
      const res = await analyzeWhiteboardImage({
        imageDataUrl: dataUrl,
        subjectName,
        mode,
        boardTitle: title,
      });
      setAiNotes(res.analysis);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Whiteboard analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSaveBoard = async () => {
    const canvas = canvasRef.current;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const snapshot = canvas ? canvas.toDataURL('image/jpeg', 0.6) : '';
      const strokesJson = JSON.stringify(strokes);
      if (selectedBoardId) {
        await updateWhiteboardBoard(selectedBoardId, {
          title,
          subjectId,
          strokesJson,
          snapshotDataUrl: snapshot,
          aiNotes,
        });
        setNotice('Whiteboard updated.');
      } else {
        const newId = await createWhiteboardBoard(uid, {
          subjectId,
          title,
          strokesJson,
          snapshotDataUrl: snapshot,
          aiNotes,
        });
        setSelectedBoardId(newId);
        setNotice('Whiteboard saved to subject.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save whiteboard.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAiAsNote = async () => {
    if (!aiNotes.trim()) return;
    try {
      await createNote(uid, {
        subjectId: subjectId || 'general',
        resourceId: '',
        title: `Whiteboard Notes: ${title}`,
        style: 'detailed',
        content: aiNotes,
        isBookmarked: false,
      });
      setNotice('Converted whiteboard notes saved to your subject notebook.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save notes.');
    }
  };

  const handleLoadBoard = (board: WhiteboardBoard) => {
    setSelectedBoardId(board.id);
    setTitle(board.title);
    setSubjectId(board.subjectId);
    setAiNotes(board.aiNotes || '');
    bgImageRef.current = null;
    try {
      const parsed = JSON.parse(board.strokesJson || '[]');
      setStrokes(Array.isArray(parsed) ? parsed : []);
    } catch {
      setStrokes([]);
    }
    setNotice(`Loaded "${board.title}".`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            AI Whiteboard
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Draw diagrams, equations, or graphs with mouse, touch, or stylus — then ask Gemini to transcribe notes or check your working.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSaveBoard()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save Board
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedBoardId('');
              setTitle('Untitled Study Board');
              setStrokes([]);
              setAiNotes('');
              bgImageRef.current = null;
            }}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            New Board
          </button>
        </div>
      </div>

      {/* Controls & Saved Boards */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Board title"
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
          />
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

          <select
            value={selectedBoardId}
            onChange={(e) => {
              const found = whiteboards.find((b) => b.id === e.target.value);
              if (found) handleLoadBoard(found);
            }}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
          >
            <option value="">Load saved whiteboard ({whiteboards.length})...</option>
            {whiteboards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </div>

        {/* Drawing Toolbar */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          {(
            [
              { id: 'pen', label: 'Pen', icon: PenTool },
              { id: 'eraser', label: 'Eraser', icon: Eraser },
              { id: 'line', label: 'Line', icon: Minus },
              { id: 'rect', label: 'Box', icon: Square },
              { id: 'circle', label: 'Circle', icon: Circle },
              { id: 'text', label: 'Text/Math', icon: TypeIcon },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTool(item.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  tool === item.id
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}

          <div className="flex items-center gap-1.5 px-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                style={{ backgroundColor: c }}
                className={`w-5 h-5 rounded-full border-2 ${
                  color === c ? 'border-indigo-500 scale-110' : 'border-white dark:border-slate-700'
                }`}
                aria-label={`Select color ${c}`}
              />
            ))}
          </div>

          <input
            type="range"
            min={1}
            max={10}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-20"
            aria-label="Stroke width"
          />

          <button
            type="button"
            onClick={() => setShowGrid((g) => !g)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
              showGrid
                ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            Graph Grid
          </button>

          <label className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer">
            <ImagePlus className="w-3.5 h-3.5" />
            Image
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
          </label>

          <button
            type="button"
            onClick={() => setStrokes((prev) => prev.slice(0, -1))}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Undo
          </button>
          <button
            type="button"
            onClick={() => {
              setStrokes([]);
              bgImageRef.current = null;
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-medium text-rose-600"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>

        {/* Equation / Text Helper Row */}
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={textDraft}
            onChange={(e) => {
              setTextDraft(e.target.value);
              if (tool !== 'text') setTool('text');
            }}
            placeholder="Type equation or label, then click anywhere on the canvas..."
            className="flex-1 min-w-[220px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-white"
          />
          <div className="flex flex-wrap gap-1">
            {MATH_SYMBOLS.map((sym) => (
              <button
                key={sym}
                type="button"
                onClick={() => {
                  setTextDraft((prev) => prev + sym);
                  setTool('text');
                }}
                className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-mono hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {sym}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white overflow-hidden shadow-xs">
          <canvas
            ref={canvasRef}
            width={920}
            height={540}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="w-full h-auto touch-none cursor-crosshair block"
          />
        </div>

        {/* Gemini Whiteboard Analysis Panel */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              Gemini Vision Analysis
            </h3>
            {selectedBoardId && (
              <button
                type="button"
                onClick={() => {
                  void deleteWhiteboardBoard(selectedBoardId);
                  setSelectedBoardId('');
                }}
                className="text-xs text-rose-600 hover:underline"
              >
                Delete
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2">
            <button
              type="button"
              disabled={analyzing}
              onClick={() => void handleAnalyzeBoard('notes')}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-50"
            >
              {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
              Convert Board to Digital Notes
            </button>
            <button
              type="button"
              disabled={analyzing}
              onClick={() => void handleAnalyzeBoard('check_work')}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              Check Working &amp; Explain Mistakes
            </button>
            <button
              type="button"
              disabled={analyzing}
              onClick={() => void handleAnalyzeBoard('diagram')}
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-medium"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Analyze Diagram / Graph
            </button>
          </div>

          <div className="flex-1 min-h-[260px] max-h-[400px] overflow-y-auto rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-3.5 text-sm">
            {aiNotes ? (
              <MarkdownView content={aiNotes} />
            ) : (
              <p className="text-xs text-slate-400">
                Draw equations, graphs, or handwritten working on the board, then click an analysis button above.
              </p>
            )}
          </div>

          {aiNotes && (
            <button
              type="button"
              onClick={() => void handleSaveAiAsNote()}
              className="w-full px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
            >
              Save Analysis to Subject Notes
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
