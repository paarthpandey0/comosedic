import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FileCheck2,
  FileUp,
  Info,
  Loader2,
  Move,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PdfSolvedAnswer, Subject } from '../types';
import { solvePdfWorksheet } from '../services/geminiApi';
import {
  buildSolvedPdfBytes,
  inspectClientPdf,
  MAX_PDF_PAGES,
  sanitizePdfMathText,
  type InspectedPdf,
} from '../utils/pdfWorksheet';

// Configure pdf.js worker locally via Vite asset URL (100% browser-side, zero Node.js RAM usage)
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfSolverViewProps {
  subjects: Subject[];
}

interface DragState {
  answerId: string;
  mode: 'move' | 'resize';
  startClientX: number;
  startClientY: number;
  origBox: [number, number, number, number];
  stageWidth: number;
  stageHeight: number;
}

export function PdfSolverView({ subjects }: PdfSolverViewProps) {
  const [subjectId, setSubjectId] = useState<string>(subjects[0]?.id || 'general');
  const [file, setFile] = useState<File | null>(null);
  const [inspected, setInspected] = useState<InspectedPdf | null>(null);
  const [worksheetTitle, setWorksheetTitle] = useState('');
  const [answers, setAnswers] = useState<PdfSolvedAnswer[]>([]);
  const [initialAnswers, setInitialAnswers] = useState<PdfSolvedAnswer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [solving, setSolving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [renderingPage, setRenderingPage] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [canvasFallback, setCanvasFallback] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pdfDocProxyRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const pdfTaskRef = useRef<pdfjsLib.PDFDocumentLoadingTask | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  // Clean up pdf.js loading task on unmount
  useEffect(() => {
    return () => {
      if (pdfTaskRef.current) {
        void pdfTaskRef.current.destroy();
        pdfTaskRef.current = null;
      }
      pdfDocProxyRef.current = null;
    };
  }, []);

  // Load PDF bytes into pdf.js for live client-side preview rendering
  useEffect(() => {
    let cancelled = false;
    const loadProxy = async () => {
      if (pdfTaskRef.current) {
        await pdfTaskRef.current.destroy().catch(() => {});
        pdfTaskRef.current = null;
      }
      pdfDocProxyRef.current = null;
      if (!inspected) return;

      setCanvasFallback(false);
      try {
        // Clone bytes so pdf.js worker transfer never detaches our original Uint8Array needed by pdf-lib!
        const copyForPreview = new Uint8Array(inspected.bytes);
        const loadingTask = pdfjsLib.getDocument({ data: copyForPreview });
        pdfTaskRef.current = loadingTask;
        const proxy = await loadingTask.promise;
        if (cancelled) {
          await loadingTask.destroy().catch(() => {});
          return;
        }
        pdfDocProxyRef.current = proxy;
        await renderCurrentPage(proxy, 1);
      } catch {
        if (!cancelled) {
          setCanvasFallback(true);
        }
      }
    };

    void loadProxy();
    return () => {
      cancelled = true;
    };
  }, [inspected]);

  const renderCurrentPage = useCallback(
    async (proxy: pdfjsLib.PDFDocumentProxy | null, pageNum: number) => {
      if (!proxy || !canvasRef.current) return;
      setRenderingPage(true);
      try {
        const page = await proxy.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      } catch {
        setCanvasFallback(true);
      } finally {
        setRenderingPage(false);
      }
    },
    []
  );

  useEffect(() => {
    if (pdfDocProxyRef.current && inspected && currentPage >= 1 && currentPage <= inspected.pageCount) {
      void renderCurrentPage(pdfDocProxyRef.current, currentPage);
    }
  }, [currentPage, inspected, renderCurrentPage]);

  const handleFileSelect = async (pickedFile: File | null) => {
    if (!pickedFile) return;
    setError(null);
    setNotice(null);
    try {
      const info = await inspectClientPdf(pickedFile);
      setFile(pickedFile);
      setInspected(info);
      setWorksheetTitle(pickedFile.name.replace(/\.pdf$/i, ''));
      setAnswers([]);
      setInitialAnswers([]);
      setSelectedId(null);
      setCurrentPage(1);
      setNotice(
        `Loaded "${pickedFile.name}" (${info.pageCount} page${info.pageCount === 1 ? '' : 's'}, ${(
          pickedFile.size /
          (1024 * 1024)
        ).toFixed(2)} MB). Click "Solve Worksheet" to analyze.`
      );
    } catch (err) {
      setFile(null);
      setInspected(null);
      setAnswers([]);
      setError(err instanceof Error ? err.message : 'Unable to inspect PDF file.');
    }
  };

  const handleSolveWorksheet = async () => {
    if (!file || !inspected) return;
    setSolving(true);
    setError(null);
    setNotice(null);
    try {
      const subjectName = subjects.find((s) => s.id === subjectId)?.name || '';
      const result = await solvePdfWorksheet({
        file,
        subjectName,
        pageCount: inspected.pageCount,
      });

      setWorksheetTitle(result.worksheetTitle || file.name.replace(/\.pdf$/i, ''));
      setAnswers(result.answers);
      setInitialAnswers(result.answers.map((a) => ({ ...a, answerBox: [...a.answerBox] })));
      if (result.answers.length > 0) {
        setCurrentPage(result.answers[0].pageNumber);
        setSelectedId(result.answers[0].id);
        setNotice(
          `Found and solved ${result.answers.length} question${result.answers.length === 1 ? '' : 's'}. Drag any blue-ink answer box to fine-tune placement before downloading.`
        );
      } else {
        setNotice('Analysis finished, but no blank questions were detected. You can still add custom answer boxes manually.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze PDF worksheet.');
    } finally {
      setSolving(false);
    }
  };

  const handleDownloadSolvedPdf = async () => {
    if (!inspected) return;
    setDownloading(true);
    setError(null);
    try {
      const solvedBytes = await buildSolvedPdfBytes(
        inspected.bytes,
        answers,
        worksheetTitle || 'Worksheet'
      );
      const blob = new Blob([solvedBytes as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (worksheetTitle || 'worksheet')
        .replace(/[^a-z0-9-_]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
      a.href = url;
      a.download = `solved-${safeName || 'worksheet'}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setNotice('Solved PDF downloaded (including in-place blue-ink answers + appended Step-by-Step Solution Key).');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build solved PDF in browser.');
    } finally {
      setDownloading(false);
    }
  };

  // Drag-to-nudge & resize handlers
  const startPointerInteraction = (
    e: React.PointerEvent,
    ans: PdfSolvedAnswer,
    mode: 'move' | 'resize'
  ) => {
    e.stopPropagation();
    if (!stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    setSelectedId(ans.id);
    dragStateRef.current = {
      answerId: ans.id,
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origBox: [...ans.answerBox],
      stageWidth: rect.width,
      stageHeight: rect.height,
    };

    const onPointerMove = (moveEvent: PointerEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      const dxNorm = ((moveEvent.clientX - ds.startClientX) / ds.stageWidth) * 1000;
      const dyNorm = ((moveEvent.clientY - ds.startClientY) / ds.stageHeight) * 1000;
      const [oymin, oxmin, oymax, oxmax] = ds.origBox;

      let nextBox: [number, number, number, number];
      if (ds.mode === 'move') {
        const boxW = oxmax - oxmin;
        const boxH = oymax - oymin;
        const clampedXmin = Math.max(0, Math.min(1000 - boxW, Math.round(oxmin + dxNorm)));
        const clampedYmin = Math.max(0, Math.min(1000 - boxH, Math.round(oymin + dyNorm)));
        nextBox = [clampedYmin, clampedXmin, clampedYmin + boxH, clampedXmin + boxW];
      } else {
        const nextXmax = Math.max(oxmin + 60, Math.min(1000, Math.round(oxmax + dxNorm)));
        const nextYmax = Math.max(oymin + 22, Math.min(1000, Math.round(oymax + dyNorm)));
        nextBox = [oymin, oxmin, nextYmax, nextXmax];
      }

      setAnswers((prev) =>
        prev.map((item) => (item.id === ds.answerId ? { ...item, answerBox: nextBox } : item))
      );
    };

    const onPointerUp = () => {
      dragStateRef.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  // Fine arrow-key nudging when an answer box is selected
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!selectedId) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }

      const step = e.shiftKey ? 15 : 5;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;

      e.preventDefault();
      setAnswers((prev) =>
        prev.map((item) => {
          if (item.id !== selectedId) return item;
          const [ymin, xmin, ymax, xmax] = item.answerBox;
          const w = xmax - xmin;
          const h = ymax - ymin;
          const nextXmin = Math.max(0, Math.min(1000 - w, xmin + dx));
          const nextYmin = Math.max(0, Math.min(1000 - h, ymin + dy));
          return {
            ...item,
            answerBox: [nextYmin, nextXmin, nextYmin + h, nextXmin + w],
          };
        })
      );
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId]);

  const pageAnswers = useMemo(
    () => answers.filter((a) => a.pageNumber === currentPage),
    [answers, currentPage]
  );

  const selectedAnswer = useMemo(
    () => answers.find((a) => a.id === selectedId) || null,
    [answers, selectedId]
  );

  const handleUpdateAnswer = (id: string, patch: Partial<PdfSolvedAnswer>) => {
    setAnswers((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const handleDeleteAnswer = (id: string) => {
    setAnswers((prev) => prev.filter((a) => a.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const handleAddCustomBox = () => {
    const newItem: PdfSolvedAnswer = {
      id: `custom_${Date.now().toString(36)}`,
      pageNumber: currentPage,
      questionLabel: `Note ${answers.length + 1}`,
      shortAnswer: 'Edit answer...',
      detailedExplanation: 'Custom answer added in the worksheet preview editor.',
      answerBox: [420, 320, 475, 680],
    };
    setAnswers((prev) => [...prev, newItem]);
    setSelectedId(newItem.id);
  };

  const handleResetBoxes = () => {
    if (initialAnswers.length === 0) return;
    setAnswers(initialAnswers.map((a) => ({ ...a, answerBox: [...a.answerBox] })));
    setNotice('Restored original AI answer coordinates.');
  };

  const currentPageSize = inspected?.pageSizes[currentPage - 1] || { width: 612, height: 792 };
  const pageAspectRatio = currentPageSize.width / currentPageSize.height;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <FileCheck2 className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            In-Place PDF Worksheet Solver
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Upload a PDF worksheet, write blue-ink answers directly onto every blank space, nudge positions live, and download with an appended step-by-step solution key.
          </p>
        </div>

        {inspected && (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleSolveWorksheet()}
              disabled={solving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap"
            >
              {solving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {solving ? 'Solving Worksheet...' : answers.length > 0 ? 'Re-Solve with AI' : 'Solve Worksheet'}
            </button>

            <button
              type="button"
              onClick={() => void handleDownloadSolvedPdf()}
              disabled={downloading || answers.length === 0}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap"
            >
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Download Solved PDF
            </button>
          </div>
        )}
      </div>

      {/* Processing Notice */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 px-4 py-3 flex items-start gap-3">
        <Info className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
        <p className="text-xs text-slate-600 dark:text-slate-300">
          PDF inspection, page preview rendering, blue-ink overlays, and solution-key assembly run 100% in your browser via <span className="font-mono">pdf-lib</span>. Uploads are capped at <strong>10 MB</strong> and <strong>{MAX_PDF_PAGES} pages</strong>.
        </p>
      </div>

      {/* Error & Notice Banners */}
      {error && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-3 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-3">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Upload & Subject Context Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Subject Context (Optional)
            </label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white"
            >
              <option value="general">General / Auto-Detect</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const dropped = e.dataTransfer.files?.[0] || null;
              void handleFileSelect(dropped);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`md:col-span-2 rounded-xl border-2 border-dashed px-4 py-4 cursor-pointer transition-colors flex flex-col sm:flex-row items-center justify-between gap-3 ${
              dragActive
                ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30'
                : 'border-slate-300 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 bg-slate-50/50 dark:bg-slate-900/40'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                const picked = e.target.files?.[0] || null;
                void handleFileSelect(picked);
                e.target.value = '';
              }}
              className="hidden"
            />
            <div className="flex items-center gap-3 min-w-0">
              <FileUp className="w-5 h-5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                  {file ? file.name : 'Drop a PDF worksheet here or click to browse'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {inspected
                    ? `${inspected.pageCount} page${inspected.pageCount === 1 ? '' : 's'} · ${(
                        (file?.size || 0) /
                        (1024 * 1024)
                      ).toFixed(2)} MB · Ready`
                    : 'Supports .pdf worksheets up to 10 MB and 15 pages'}
                </p>
              </div>
            </div>
            <span className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0">
              {file ? 'Change PDF' : 'Choose PDF'}
            </span>
          </div>
        </div>
      </div>

      {/* Live Interactive Preview & Drag-to-Nudge Workspace */}
      {inspected && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left / Main Stage: Annotated Page Preview */}
          <div className="xl:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-4 sm:p-5 space-y-4">
            {/* Page Controls */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 tabular-nums px-1">
                  Page {currentPage} / {inspected.pageCount}
                </span>
                <button
                  type="button"
                  disabled={currentPage >= inspected.pageCount}
                  onClick={() => setCurrentPage((p) => Math.min(inspected.pageCount, p + 1))}
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleAddCustomBox}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Box
                </button>
                {initialAnswers.length > 0 && (
                  <button
                    type="button"
                    onClick={handleResetBoxes}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                    title="Reset coordinates to original AI placement"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                )}
              </div>
            </div>

            {/* Interactive PDF Page Canvas + Draggable Blue-Ink Overlays */}
            <div className="bg-slate-100 dark:bg-slate-900/80 rounded-xl p-2 sm:p-4 overflow-auto">
              <div
                ref={stageRef}
                onClick={() => setSelectedId(null)}
                className="relative mx-auto w-full max-w-[680px] bg-white shadow-md select-none overflow-hidden rounded-sm border border-slate-200"
                style={{ aspectRatio: `${pageAspectRatio}` }}
              >
                {!canvasFallback ? (
                  <canvas
                    ref={canvasRef}
                    className="block w-full h-full pointer-events-none"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-slate-500 bg-white">
                    <p className="text-sm font-semibold text-slate-800">
                      Worksheet Page {currentPage} Layout Canvas
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      Drag the blue-ink boxes below to position answers; the downloaded PDF uses your exact original document pages.
                    </p>
                  </div>
                )}

                {renderingPage && (
                  <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                  </div>
                )}

                {solving && (
                  <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px] flex flex-col items-center justify-center gap-2 text-white p-4">
                    <Loader2 className="w-7 h-7 animate-spin" />
                    <p className="text-sm font-semibold">Analyzing questions &amp; blank spaces...</p>
                  </div>
                )}

                {/* Draggable Blue-Ink Answer Overlays */}
                {pageAnswers
                  .filter((a) => !a.hidden)
                  .map((ans) => {
                    const [ymin, xmin, ymax, xmax] = ans.answerBox;
                    const isSelected = selectedId === ans.id;
                    const topPct = ymin / 10;
                    const leftPct = xmin / 10;
                    const widthPct = Math.max(4, (xmax - xmin) / 10);
                    const heightPct = Math.max(2.2, (ymax - ymin) / 10);
                    const displayAnswer = sanitizePdfMathText(ans.shortAnswer) || ans.shortAnswer;

                    return (
                      <div
                        key={ans.id}
                        onPointerDown={(e) => startPointerInteraction(e, ans, 'move')}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(ans.id);
                        }}
                        style={{
                          top: `${topPct}%`,
                          left: `${leftPct}%`,
                          width: `${widthPct}%`,
                          height: `${heightPct}%`,
                        }}
                        className={`absolute cursor-move touch-none rounded-xs px-1 py-0.5 flex items-center transition-shadow ${
                          isSelected
                            ? 'ring-2 ring-blue-600 bg-blue-50/70 shadow-sm z-20'
                            : 'border border-dashed border-blue-500/60 bg-blue-50/35 hover:bg-blue-50/60 z-10'
                        }`}
                        title={`${ans.questionLabel}: Drag to move`}
                      >
                        <span
                          className="font-bold leading-tight overflow-hidden break-words w-full"
                          style={{
                            color: '#1D4ED8',
                            fontSize: 'clamp(9px, 1.35vw, 13px)',
                          }}
                        >
                          {displayAnswer}
                        </span>

                        {isSelected && (
                          <>
                            <span className="absolute -top-5 left-0 bg-blue-700 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-xs whitespace-nowrap flex items-center gap-1 pointer-events-none">
                              <Move className="w-2.5 h-2.5" />
                              {ans.questionLabel}
                            </span>
                            {/* Bottom-right resize handle */}
                            <div
                              onPointerDown={(e) => startPointerInteraction(e, ans, 'resize')}
                              className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-blue-700 border-2 border-white cursor-nwse-resize shadow-xs"
                              title="Drag corner to resize answer box"
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Tip: Drag any blue-ink box to nudge placement, drag its blue corner dot to resize, or click a box and use Arrow keys (hold Shift for larger steps).
            </p>
          </div>

          {/* Right Panel: Detected Questions, Inline Answer Editor & Step-by-Step Solutions */}
          <div className="xl:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Answers &amp; Step-by-Step Key ({answers.length})
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Edit any short answer inline — changes sync instantly to the PDF overlay and appended key.
                </p>
              </div>
            </div>

            {/* Selected Box Fine Coordinate Inspector */}
            {selectedAnswer && (
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/50 dark:bg-indigo-950/25 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                    Editing Box · {selectedAnswer.questionLabel} (Page {selectedAnswer.pageNumber})
                  </span>
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    [{selectedAnswer.answerBox.join(', ')}]
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[10px] font-medium text-slate-600 dark:text-slate-300 mb-0.5">
                      Label
                    </label>
                    <input
                      type="text"
                      value={selectedAnswer.questionLabel}
                      onChange={(e) =>
                        handleUpdateAnswer(selectedAnswer.id, { questionLabel: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-white"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[10px] font-medium text-slate-600 dark:text-slate-300 mb-0.5">
                      Short Ink Answer (Drawn on Worksheet)
                    </label>
                    <input
                      type="text"
                      value={selectedAnswer.shortAnswer}
                      onChange={(e) =>
                        handleUpdateAnswer(selectedAnswer.id, { shortAnswer: e.target.value })
                      }
                      className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300"
                    />
                  </div>
                </div>
              </div>
            )}

            {answers.length === 0 ? (
              <div className="py-10 text-center space-y-3">
                <Sparkles className="w-7 h-7 text-indigo-500 mx-auto" />
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  Ready to solve "{worksheetTitle}"
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mx-auto">
                  Click <strong>Solve Worksheet</strong> above to locate every question, place concise blue-ink answers, and generate the full step-by-step solution key.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {answers.map((ans) => {
                  const isSelected = selectedId === ans.id;
                  return (
                    <div
                      key={ans.id}
                      onClick={() => {
                        setCurrentPage(ans.pageNumber);
                        setSelectedId(ans.id);
                      }}
                      className={`rounded-xl border p-3.5 space-y-2 cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/25'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                      } ${ans.hidden ? 'opacity-55' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {ans.questionLabel}
                          </span>
                          <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 tabular-nums">
                            p.{ans.pageNumber}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateAnswer(ans.id, { hidden: !ans.hidden });
                            }}
                            className="p-1 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700"
                            title={ans.hidden ? 'Show on PDF' : 'Hide from PDF'}
                            aria-label={ans.hidden ? 'Show answer' : 'Hide answer'}
                          >
                            {ans.hidden ? (
                              <EyeOff className="w-3.5 h-3.5" />
                            ) : (
                              <Eye className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteAnswer(ans.id);
                            }}
                            className="p-1 rounded-md text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                            title="Remove answer"
                            aria-label="Remove answer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <input
                        type="text"
                        value={ans.shortAnswer}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleUpdateAnswer(ans.id, { shortAnswer: e.target.value })}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300"
                        placeholder="Short worksheet answer..."
                      />

                      <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                        {ans.detailedExplanation}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
