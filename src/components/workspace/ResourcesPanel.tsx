import React, { useState } from 'react';
import { BookOpen, Eye, FileText, GitCompare, Layers, Loader2, Sparkles, Trash2, Upload, X } from 'lucide-react';
import type { AcademicMemory, StudyResource, Subject } from '../../types';
import { awardLearningXp, createResource, deleteResource, updateSubject } from '../../services/studyDb';
import { analyzeStudyMaterial, compareResources } from '../../services/geminiApi';
import { MarkdownView } from '../MarkdownView';

interface ResourcesPanelProps {
  uid: string;
  subject: Subject;
  resources: StudyResource[];
  academicMemory?: AcademicMemory | null;
  pastPapersOnly?: boolean;
  onGenerateNotesFromResource: (resource: StudyResource) => void;
  onGenerateFlashcardsFromResource: (resource: StudyResource) => void;
}

export function ResourcesPanel({
  uid,
  subject,
  resources,
  academicMemory,
  pastPapersOnly = false,
  onGenerateNotesFromResource,
  onGenerateFlashcardsFromResource,
}: ResourcesPanelProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState('');
  const [pastedText, setPastedText] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [isPastPaper, setIsPastPaper] = useState(pastPapersOnly);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingResource, setViewingResource] = useState<StudyResource | null>(null);
  const [showPasteBox, setShowPasteBox] = useState(false);

  // Cross-document compare & library Q&A state
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareQuestion, setCompareQuestion] = useState('');
  const [comparing, setComparing] = useState(false);
  const [compareResult, setCompareResult] = useState('');

  const filteredResources = resources.filter(
    (r) => r.subjectId === subject.id && (pastPapersOnly ? r.isPastPaper : true)
  );

  const toggleCompareId = (id: string) => {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 6 ? [...prev, id] : prev
    );
  };

  const handleCompareDocuments = async (e: React.FormEvent) => {
    e.preventDefault();
    if (academicMemory?.aiPrivacyBlockedSubjectIds?.includes(subject.id)) {
      setError('AI Privacy Lock is enabled for this subject in Gemini Control Centre.');
      return;
    }
    const chosen = filteredResources.filter((r) =>
      compareIds.length > 0 ? compareIds.includes(r.id) : true
    ).slice(0, 6);
    if (chosen.length === 0) return;

    setComparing(true);
    setError(null);
    try {
      const res = await compareResources({
        subjectName: subject.name,
        documents: chosen.map((d) => ({
          title: d.title,
          summary: d.summary,
          excerpt: d.extractedText.slice(0, 12000),
        })),
        question: compareQuestion.trim() || undefined,
      });
      setCompareResult(res.answer);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to synthesize documents.');
    } finally {
      setComparing(false);
    }
  };

  const handleAnalyzeAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0 && !pastedText.trim()) {
      setError('Select one or more PDF, Word (.docx), PowerPoint (.pptx), image files, or paste text.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      if (selectedFiles.length > 0) {
        for (let i = 0; i < selectedFiles.length; i++) {
          const f = selectedFiles[i];
          setUploadProgress(`Analyzing ${i + 1} of ${selectedFiles.length}: ${f.name}`);
          const analyzed = await analyzeStudyMaterial({
            file: f,
            title: selectedFiles.length === 1 ? customTitle.trim() : '',
            subjectName: subject.name,
            isPastPaper: pastPapersOnly ? true : isPastPaper,
          });
          await createResource(uid, {
            subjectId: subject.id,
            title: analyzed.title,
            fileName: analyzed.fileName,
            fileType: analyzed.fileType,
            fileSize: analyzed.fileSize,
            isPastPaper: analyzed.isPastPaper,
            extractedText: analyzed.extractedText,
            summary: analyzed.summary,
            keyConcepts: analyzed.keyConcepts,
            definitions: analyzed.definitions,
            formulas: analyzed.formulas,
            detectedTopics: analyzed.detectedTopics || [],
          });
          if (analyzed.detectedTopics?.length) {
            const mergedTopics = Array.from(new Set([...(subject.topics || []), ...analyzed.detectedTopics])).slice(0, 40);
            await updateSubject(subject.id, { topics: mergedTopics }).catch(() => {});
          }
          await awardLearningXp(uid, academicMemory || null, 15);
        }
      } else {
        setUploadProgress('Analyzing pasted text...');
        const analyzed = await analyzeStudyMaterial({
          pastedText: pastedText.trim(),
          title: customTitle.trim(),
          subjectName: subject.name,
          isPastPaper: pastPapersOnly ? true : isPastPaper,
        });
        await createResource(uid, {
          subjectId: subject.id,
          title: analyzed.title,
          fileName: analyzed.fileName,
          fileType: analyzed.fileType,
          fileSize: analyzed.fileSize,
          isPastPaper: analyzed.isPastPaper,
          extractedText: analyzed.extractedText,
          summary: analyzed.summary,
          keyConcepts: analyzed.keyConcepts,
          definitions: analyzed.definitions,
          formulas: analyzed.formulas,
          detectedTopics: analyzed.detectedTopics || [],
        });
        if (analyzed.detectedTopics?.length) {
          const mergedTopics = Array.from(new Set([...(subject.topics || []), ...analyzed.detectedTopics])).slice(0, 40);
          await updateSubject(subject.id, { topics: mergedTopics }).catch(() => {});
        }
        await awardLearningXp(uid, academicMemory || null, 15);
      }

      setSelectedFiles([]);
      setUploadProgress('');
      setPastedText('');
      setCustomTitle('');
      setShowPasteBox(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to analyze study document.');
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Card */}
      <form
        onSubmit={handleAnalyzeAndSave}
        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {pastPapersOnly ? 'Upload Past Exam Paper' : 'Upload Study Materials (Single or Multi-File Batch)'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Supports multiple PDFs (including scanned OCR), PowerPoint (.pptx), Word (.docx), images, or pasted text with page references and diagram/equation extraction.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPasteBox((v) => !v)}
            className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline self-start sm:self-center whitespace-nowrap"
          >
            {showPasteBox ? 'Switch to File Upload' : 'Or Paste Raw Text'}
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              Document Title (optional)
            </label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder={pastPapersOnly ? 'e.g. 2024 Final Paper' : 'e.g. Chapter 4: Thermodynamics'}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {!pastPapersOnly && (
            <div className="flex items-end pb-2">
              <label className="inline-flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPastPaper}
                  onChange={(e) => setIsPastPaper(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                Tag as Past Exam Paper
              </label>
            </div>
          )}
        </div>

        {showPasteBox ? (
          <textarea
            rows={5}
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Paste textbook chapters, lecture transcripts, or revision notes here..."
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        ) : (
          <label className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 px-6 py-7 cursor-pointer hover:border-indigo-500 transition-colors">
            <Upload className="w-6 h-6 text-indigo-600 dark:text-indigo-400 mb-2" />
            <span className="text-sm font-medium text-slate-800 dark:text-slate-200 text-center">
              {selectedFiles.length > 0
                ? `${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''} queued: ${selectedFiles.map((f) => f.name).join(', ')}`
                : 'Choose one or multiple files to upload & analyze simultaneously'}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              PDF (with OCR), DOCX, PPTX, PNG, JPG, TXT (up to 25 MB per file)
            </span>
            <input
              type="file"
              multiple
              accept=".pdf,.docx,.pptx,.txt,.md,.csv,image/*"
              onChange={(e) => setSelectedFiles(Array.from(e.target.files || []))}
              className="hidden"
            />
          </label>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-indigo-600 dark:text-indigo-400">{uploadProgress}</span>
          <button
            type="submit"
            disabled={uploading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-medium transition-colors"
          >
            {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
            {uploading ? 'Analyzing with Gemini...' : 'Upload & Analyze'}
          </button>
        </div>
      </form>

      {/* Cross-Document Synthesis & Library Q&A */}
      {filteredResources.length >= 1 && (
        <form
          onSubmit={handleCompareDocuments}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6 space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <GitCompare className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                Compare Documents & Cross-Library Q&A
              </h3>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {compareIds.length > 0
                ? `${compareIds.length} selected for comparison`
                : `Using up to ${Math.min(filteredResources.length, 6)} documents in ${subject.name}`}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              value={compareQuestion}
              onChange={(e) => setCompareQuestion(e.target.value)}
              placeholder="Ask a question across documents or leave blank to compare & synthesize themes..."
              className="flex-1 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
            />
            <button
              type="submit"
              disabled={comparing}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium disabled:opacity-60 whitespace-nowrap"
            >
              {comparing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {comparing ? 'Synthesizing...' : compareQuestion.trim() ? 'Ask Across Library' : 'Compare & Synthesize'}
            </button>
          </div>

          {compareResult && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <MarkdownView content={compareResult} className="text-sm" />
            </div>
          )}
        </form>
      )}

      {/* Resource List */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] p-6">
        <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white mb-4">
          {pastPapersOnly ? 'Uploaded Past Papers' : 'Subject Library'} ({filteredResources.length})
        </h3>

        {filteredResources.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
            {pastPapersOnly
              ? 'No past exam papers uploaded for this subject yet.'
              : 'No study documents uploaded yet. Upload a file above to unlock AI notes, flashcards, and tutor citations.'}
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {filteredResources.map((res) => {
              const selectedForCompare = compareIds.includes(res.id);
              return (
                <div key={res.id} className="py-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedForCompare}
                        onChange={() => toggleCompareId(res.id)}
                        title="Include in comparison"
                        className="mt-1 rounded border-slate-300 text-indigo-600"
                      />
                      <FileText className="w-5 h-5 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">{res.title}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {res.fileName} · {res.fileType.toUpperCase()} · {res.keyConcepts.length} concepts ·{' '}
                          {res.definitions.length} definitions · {res.formulas.length} formulas
                          {res.isPastPaper ? ' · Past Paper' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => onGenerateNotesFromResource(res)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-xs font-medium hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        AI Notes
                      </button>
                      <button
                        type="button"
                        onClick={() => onGenerateFlashcardsFromResource(res)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-medium hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        Flashcards
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewingResource(res)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Inspect
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteResource(res.id)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                        aria-label="Delete resource"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {res.summary && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed pl-8">
                      {res.summary}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Resource Inspector Modal */}
      {viewingResource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-3xl max-h-[85vh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#1A202C] flex flex-col overflow-hidden shadow-xl">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  {viewingResource.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">{viewingResource.fileName}</p>
              </div>
              <button
                type="button"
                onClick={() => setViewingResource(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-5 text-sm">
              <div>
                <h4 className="font-display font-semibold text-slate-900 dark:text-white mb-1.5">AI Summary</h4>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">{viewingResource.summary}</p>
              </div>
              {viewingResource.keyConcepts.length > 0 && (
                <div>
                  <h4 className="font-display font-semibold text-slate-900 dark:text-white mb-1.5">Key Concepts</h4>
                  <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-300">
                    {viewingResource.keyConcepts.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {viewingResource.definitions.length > 0 && (
                <div>
                  <h4 className="font-display font-semibold text-slate-900 dark:text-white mb-1.5">Definitions</h4>
                  <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-300">
                    {viewingResource.definitions.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {viewingResource.formulas.length > 0 && (
                <div>
                  <h4 className="font-display font-semibold text-slate-900 dark:text-white mb-1.5">
                    Formulas & Laws
                  </h4>
                  <div className="space-y-1.5 font-mono text-xs bg-slate-50 dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                    {viewingResource.formulas.map((f, i) => (
                      <div key={i}>{f}</div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <h4 className="font-display font-semibold text-slate-900 dark:text-white mb-1.5">
                  Extracted Document Text
                </h4>
                <pre className="whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 max-h-72 overflow-y-auto font-sans leading-relaxed">
                  {viewingResource.extractedText}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
