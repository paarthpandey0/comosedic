import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  Type,
  type LiveServerMessage,
} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const MODEL_NAME = 'gemini-4-hydrogen';
const FALLBACK_MODEL_NAME = 'gemini-3.1-flash-lite';
const LIVE_MODEL_NAME = 'gemini-3.8-live';
const TRANSCRIBE_MODEL_NAME = 'gemini-3.5-transcribe';

let primaryModelCooldownUntil = 0;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractGeminiErrorDetails(error: unknown): {
  code?: number;
  status?: string;
  message: string;
} {
  let rawMessage = error instanceof Error ? error.message : String(error);
  let code =
    typeof (error as { status?: unknown })?.status === 'number'
      ? (error as { status: number }).status
      : undefined;
  let statusStr: string | undefined;

  for (let depth = 0; depth < 3; depth++) {
    const trimmed = rawMessage.trim();
    const jsonStart = trimmed.indexOf('{');
    if (jsonStart === -1) break;
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart)) as {
        error?: { code?: number; message?: string; status?: string };
        code?: number;
        message?: string;
        status?: string;
      };
      const inner = parsed.error || parsed;
      if (typeof inner.code === 'number') code = inner.code;
      if (typeof inner.status === 'string') statusStr = inner.status;
      if (typeof inner.message === 'string' && inner.message.trim()) {
        rawMessage = inner.message.trim();
      } else {
        break;
      }
    } catch {
      break;
    }
  }

  return { code, status: statusStr, message: rawMessage };
}

function isTransientGeminiError(error: unknown): boolean {
  const { code, status, message } = extractGeminiErrorDetails(error);
  const lower = message.toLowerCase();
  return (
    code === 503 ||
    code === 502 ||
    code === 504 ||
    code === 500 ||
    code === 429 ||
    status === 'UNAVAILABLE' ||
    status === 'RESOURCE_EXHAUSTED' ||
    status === 'INTERNAL' ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('temporarily unavailable') ||
    lower.includes('service unavailable') ||
    lower.includes('aborted') ||
    lower.includes('timeout') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('fetch failed')
  );
}

type ModelMode = 'auto' | 'primary' | 'fast';

interface ServerAiTelemetryEvent {
  id: string;
  endpoint: string;
  modelUsed: string;
  status: 'success' | 'error';
  promptTokens: number;
  outputTokens: number;
  durationMs: number;
  summary: string;
  timestamp: string;
}

const aiTelemetryState = {
  preferredMode: 'auto' as ModelMode,
  totalRequests: 0,
  failedRequests: 0,
  totalPromptTokens: 0,
  totalOutputTokens: 0,
  recentEvents: [] as ServerAiTelemetryEvent[],
};

function recordServerTelemetry(event: Omit<ServerAiTelemetryEvent, 'id' | 'timestamp'>) {
  aiTelemetryState.totalRequests += 1;
  if (event.status === 'error') {
    aiTelemetryState.failedRequests += 1;
  }
  aiTelemetryState.totalPromptTokens += event.promptTokens || 0;
  aiTelemetryState.totalOutputTokens += event.outputTokens || 0;
  aiTelemetryState.recentEvents.unshift({
    ...event,
    id: `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
  });
  if (aiTelemetryState.recentEvents.length > 50) {
    aiTelemetryState.recentEvents.length = 50;
  }
}

function getCandidateModels(modeOverride?: ModelMode): string[] {
  const mode = modeOverride || aiTelemetryState.preferredMode;
  if (mode === 'fast') {
    return [FALLBACK_MODEL_NAME, MODEL_NAME];
  }
  if (mode === 'primary') {
    return [MODEL_NAME, FALLBACK_MODEL_NAME];
  }
  if (Date.now() < primaryModelCooldownUntil) {
    return [FALLBACK_MODEL_NAME, MODEL_NAME];
  }
  return [MODEL_NAME, FALLBACK_MODEL_NAME];
}

async function generateContentWithResilience(
  ai: GoogleGenAI,
  params: Omit<Parameters<GoogleGenAI['models']['generateContent']>[0], 'model'>,
  timeoutMs = 24000,
  meta?: { endpoint?: string; modeOverride?: ModelMode }
) {
  const models = getCandidateModels(meta?.modeOverride);
  const startedAt = Date.now();
  let lastError: unknown;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const config = {
          ...(params.config || {}),
          abortSignal: AbortSignal.timeout(model === MODEL_NAME ? Math.min(timeoutMs, 10000) : timeoutMs),
        };
        const result = await ai.models.generateContent({
          ...params,
          model,
          config,
        });
        if (model === MODEL_NAME) {
          primaryModelCooldownUntil = 0;
        }
        const usage = (result as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } })
          ?.usageMetadata;
        recordServerTelemetry({
          endpoint: meta?.endpoint || 'generateContent',
          modelUsed: model,
          status: 'success',
          promptTokens: usage?.promptTokenCount || 0,
          outputTokens: usage?.candidatesTokenCount || 0,
          durationMs: Date.now() - startedAt,
          summary: `Completed with ${model}`,
        });
        return result;
      } catch (err) {
        lastError = err;
        const details = extractGeminiErrorDetails(err);
        console.warn(`[Gemini] ${model} attempt ${attempt + 1} failed:`, details.code || '', details.status || '', details.message.slice(0, 140));
        if (
          model === MODEL_NAME &&
          (details.code === 503 || details.status === 'UNAVAILABLE' || isTransientGeminiError(err))
        ) {
          primaryModelCooldownUntil = Date.now() + 60_000;
          break; // switch immediately to fallback model during demand spike/timeout
        }
        if (model === FALLBACK_MODEL_NAME && details.code === 400 && params.config && 'thinkingConfig' in params.config) {
          const { thinkingConfig: _omit, ...restConfig } = params.config as Record<string, unknown>;
          const result = await ai.models.generateContent({
            ...params,
            model,
            config: {
              ...(restConfig as typeof params.config),
              abortSignal: AbortSignal.timeout(timeoutMs),
            },
          });
          const usage = (result as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } })
            ?.usageMetadata;
          recordServerTelemetry({
            endpoint: meta?.endpoint || 'generateContent',
            modelUsed: model,
            status: 'success',
            promptTokens: usage?.promptTokenCount || 0,
            outputTokens: usage?.candidatesTokenCount || 0,
            durationMs: Date.now() - startedAt,
            summary: `Completed with ${model}`,
          });
          return result;
        }
        if (isTransientGeminiError(err) && attempt === 0) {
          await sleep(500);
          continue;
        }
        if (isTransientGeminiError(err)) {
          break;
        }
        recordServerTelemetry({
          endpoint: meta?.endpoint || 'generateContent',
          modelUsed: model,
          status: 'error',
          promptTokens: 0,
          outputTokens: 0,
          durationMs: Date.now() - startedAt,
          summary: details.message.slice(0, 220),
        });
        throw err;
      }
    }
  }
  const finalDetails = extractGeminiErrorDetails(lastError);
  recordServerTelemetry({
    endpoint: meta?.endpoint || 'generateContent',
    modelUsed: models[models.length - 1] || MODEL_NAME,
    status: 'error',
    promptTokens: 0,
    outputTokens: 0,
    durationMs: Date.now() - startedAt,
    summary: finalDetails.message.slice(0, 220),
  });
  throw lastError;
}

async function* generateContentStreamWithResilience(
  ai: GoogleGenAI,
  params: Omit<Parameters<GoogleGenAI['models']['generateContentStream']>[0], 'model'>
) {
  const models = getCandidateModels();
  let lastError: unknown;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const stream = await ai.models.generateContentStream({
          ...params,
          model,
          config: {
            ...(params.config || {}),
            abortSignal: AbortSignal.timeout(model === MODEL_NAME ? 9000 : 30000),
          },
        });
        const iterator = stream[Symbol.asyncIterator]();
        const first = await iterator.next();
        if (model === MODEL_NAME) {
          primaryModelCooldownUntil = 0;
        }
        if (!first.done) {
          yield first.value;
        }
        while (true) {
          const next = await iterator.next();
          if (next.done) break;
          yield next.value;
        }
        return;
      } catch (err) {
        lastError = err;
        const details = extractGeminiErrorDetails(err);
        console.warn(`[Gemini Stream] ${model} attempt ${attempt + 1} failed:`, details.code || '', details.status || '', details.message.slice(0, 140));
        if (
          model === MODEL_NAME &&
          (details.code === 503 || details.status === 'UNAVAILABLE' || isTransientGeminiError(err))
        ) {
          primaryModelCooldownUntil = Date.now() + 60_000;
          break;
        }
        if (isTransientGeminiError(err) && attempt === 0) {
          await sleep(500);
          continue;
        }
        if (isTransientGeminiError(err)) {
          break;
        }
        throw err;
      }
    }
  }
  throw lastError;
}

function formatGeminiError(error: unknown): { status: number; message: string } {
  const { code, status, message } = extractGeminiErrorDetails(error);
  if (message.includes('GEMINI_API_KEY')) {
    return { status: 500, message };
  }
  if (
    code === 403 ||
    status === 'PERMISSION_DENIED' ||
    message.includes('API_KEY_INVALID') ||
    message.includes('PERMISSION_DENIED')
  ) {
    return {
      status: 403,
      message: 'Gemini API key is invalid or unauthorized. Please verify GEMINI_API_KEY in Settings > Secrets.',
    };
  }
  if (code === 503 || status === 'UNAVAILABLE' || message.toLowerCase().includes('high demand')) {
    return {
      status: 503,
      message: 'Gemini AI models are experiencing temporary high demand. Please retry in a few seconds.',
    };
  }
  if (code === 429 || status === 'RESOURCE_EXHAUSTED') {
    return {
      status: 429,
      message: 'Gemini API rate limit or quota reached. Please wait a moment and try again.',
    };
  }
  if (code === 404 || status === 'NOT_FOUND') {
    return {
      status: 404,
      message: 'Requested Gemini model was not found.',
    };
  }
  return { status: code && code >= 400 && code < 600 ? code : 500, message: message || 'An unexpected AI processing error occurred.' };
}

async function extractTextFromPptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml/)?.[1] || '0', 10);
      return numA - numB;
    });

  const slideTexts: string[] = [];
  for (const slidePath of slideFiles) {
    const xml = await zip.files[slidePath].async('string');
    const matches = xml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g) || [];
    const text = matches
      .map((tag) =>
        tag
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
      )
      .filter((s) => s.trim().length > 0)
      .join(' ');
    if (text.trim()) {
      const slideNum = slidePath.match(/slide(\d+)\.xml/)?.[1] || '?';
      slideTexts.push(`--- Slide ${slideNum} ---\n${text.trim()}`);
    }
  }
  return slideTexts.join('\n\n');
}

function detectFileType(
  mimeType: string,
  fileName: string
): 'pdf' | 'docx' | 'pptx' | 'image' | 'text' | 'csv' {
  const lower = fileName.toLowerCase();
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    return 'docx';
  }
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    lower.endsWith('.pptx')
  ) {
    return 'pptx';
  }
  if (mimeType === 'text/csv' || lower.endsWith('.csv')) {
    return 'csv';
  }
  if (mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(lower)) {
    return 'image';
  }
  return 'text';
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const app = express();
app.use(express.json({ limit: '15mb' }));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    model: MODEL_NAME,
    fallbackModel: FALLBACK_MODEL_NAME,
    liveModel: LIVE_MODEL_NAME,
  });
});

// 1. Upload & Analyze Study Material (OCR for scanned PDFs, diagrams, tables, equations, chapter & subject detection)
app.post('/api/resources/analyze', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const subjectName = String(req.body.subjectName || 'General Study');
    const customTitle = String(req.body.title || '').trim();
    const pastedText = String(req.body.pastedText || '').trim();
    const isPastPaper = req.body.isPastPaper === 'true' || req.body.isPastPaper === true;

    const file = req.file;
    if (!file && !pastedText) {
      res.status(400).json({ error: 'Please provide a file or paste study text to analyze.' });
      return;
    }

    let fileType: 'pdf' | 'docx' | 'pptx' | 'image' | 'text' | 'csv' = 'text';
    let fileName = customTitle ? `${customTitle}.txt` : 'pasted-notes.txt';
    let fileSize = Buffer.byteLength(pastedText, 'utf8');
    let rawExtractedText = pastedText;
    let inlinePart: { inlineData: { mimeType: string; data: string } } | null = null;

    if (file) {
      fileName = file.originalname;
      fileSize = file.size;
      fileType = detectFileType(file.mimetype, file.originalname);

      if (fileType === 'docx') {
        const result = await mammoth.extractRawText({ buffer: file.buffer });
        rawExtractedText = result.value.trim();
        if (!rawExtractedText) {
          res.status(400).json({ error: 'Could not extract readable text from this Word document.' });
          return;
        }
      } else if (fileType === 'pptx') {
        rawExtractedText = await extractTextFromPptx(file.buffer);
        if (!rawExtractedText) {
          res.status(400).json({ error: 'Could not extract readable slide text from this PowerPoint file.' });
          return;
        }
      } else if (fileType === 'text' || fileType === 'csv') {
        rawExtractedText = file.buffer.toString('utf8').trim();
        if (!rawExtractedText) {
          res.status(400).json({ error: 'The uploaded text/CSV file is empty.' });
          return;
        }
      } else if (fileType === 'pdf' || fileType === 'image') {
        const mime =
          fileType === 'pdf'
            ? 'application/pdf'
            : file.mimetype && file.mimetype.startsWith('image/')
              ? file.mimetype
              : 'image/png';
        inlinePart = {
          inlineData: {
            mimeType: mime,
            data: file.buffer.toString('base64'),
          },
        };
      }
    }

    const analysisPrompt = inlinePart
      ? `You are an expert academic OCR & document intelligence system for the subject "${subjectName}".
Analyze the attached ${isPastPaper ? 'past exam paper' : 'study material'} (${fileName}) thoroughly:
1. Perform full OCR and transcription of ALL pages/sections into "extractedText", including [Page X] markers where applicable, plus detailed descriptions of any diagrams, tables, graphs, and mathematical/chemical equations.
2. Write a comprehensive academic summary with page/section references in "summary".
3. Extract the most important key concepts into "keyConcepts" (up to 20).
4. Extract important definitions in "Term: Definition" format into "definitions" (up to 25).
5. Extract key formulas, laws, or equations into "formulas" (up to 20).
6. Identify 2 to 6 core syllabus topic tags into "detectedTopics".
7. Propose a clean academic title reflecting the detected subject/chapter in "suggestedTitle".`
      : `You are an expert academic document analyzer for the subject "${subjectName}".
Analyze the following ${isPastPaper ? 'past exam paper' : 'study material'} (${fileName}):

"""
${rawExtractedText.slice(0, 120000)}
"""

1. Write a comprehensive structured academic summary with section/slide references in "summary".
2. Extract key concepts into "keyConcepts" (up to 20).
3. Extract definitions in "Term: Definition" format into "definitions" (up to 25).
4. Extract formulas, laws, or equations into "formulas" (up to 20).
5. Identify 2 to 6 core syllabus topic tags into "detectedTopics".
6. Propose a clean academic title in "suggestedTitle".
Set "extractedText" to a brief confirmation string.`;

    const contents = inlinePart
      ? { parts: [inlinePart, { text: analysisPrompt }] }
      : analysisPrompt;

    const response = await generateContentWithResilience(ai, {
      contents,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            suggestedTitle: { type: Type.STRING },
            extractedText: { type: Type.STRING },
            summary: { type: Type.STRING },
            keyConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
            definitions: { type: Type.ARRAY, items: { type: Type.STRING } },
            formulas: { type: Type.ARRAY, items: { type: Type.STRING } },
            detectedTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['suggestedTitle', 'extractedText', 'summary', 'keyConcepts', 'definitions', 'formulas', 'detectedTopics'],
        },
      },
    }, 26000, { endpoint: '/api/resources/analyze' });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    const finalExtracted = (inlinePart ? parsed.extractedText || parsed.summary : rawExtractedText).slice(
      0,
      195000
    );

    res.json({
      title: (customTitle || parsed.suggestedTitle || fileName.replace(/\.[^/.]+$/, '')).slice(0, 200),
      fileName: fileName.slice(0, 255),
      fileType,
      fileSize,
      isPastPaper,
      extractedText: finalExtracted,
      summary: String(parsed.summary || '').slice(0, 19500),
      keyConcepts: Array.isArray(parsed.keyConcepts)
        ? parsed.keyConcepts.slice(0, 40).map((s: unknown) => String(s).slice(0, 200))
        : [],
      definitions: Array.isArray(parsed.definitions)
        ? parsed.definitions.slice(0, 50).map((s: unknown) => String(s).slice(0, 400))
        : [],
      formulas: Array.isArray(parsed.formulas)
        ? parsed.formulas.slice(0, 40).map((s: unknown) => String(s).slice(0, 300))
        : [],
      detectedTopics: Array.isArray(parsed.detectedTopics)
        ? parsed.detectedTopics.slice(0, 12).map((s: unknown) => String(s).slice(0, 120))
        : [],
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 1b. Compare Multiple Documents & Ask Across Document Library
app.post('/api/resources/compare', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjectName, documents, question } = req.body as {
      subjectName: string;
      documents: Array<{ title: string; summary: string; excerpt: string }>;
      question?: string;
    };

    if (!Array.isArray(documents) || documents.length === 0) {
      res.status(400).json({ error: 'Select at least one document to synthesize or compare.' });
      return;
    }

    const docText = documents
      .slice(0, 6)
      .map((d, i) => `### Document ${i + 1}: ${d.title}\nSummary: ${d.summary}\nExcerpt:\n${d.excerpt.slice(0, 14000)}`)
      .join('\n\n---\n\n');

    const prompt = question?.trim()
      ? `Answer this cross-document question for "${subjectName}" using ONLY the documents below. Cite exact document titles and any page/slide references present.\nQuestion: ${question}\n\n${docText}`
      : `Compare and synthesize these ${documents.length} documents for "${subjectName}". Highlight:\n1. Core overlapping themes\n2. Complementary details or differing perspectives\n3. Key formulas/definitions unified across sources\n4. Citation references by document title\n\n${docText}`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      },
    });

    res.json({ answer: response.text ?? '' });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 2. AI Notes Generator
app.post('/api/notes/generate', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjectName, resourceTitle, resourceContent, style, customFocus } = req.body as {
      subjectName: string;
      resourceTitle: string;
      resourceContent: string;
      style: 'quick' | 'detailed' | 'exam';
      customFocus?: string;
    };

    if (!resourceContent || !resourceContent.trim()) {
      res.status(400).json({ error: 'Resource content is required to generate notes.' });
      return;
    }

    const styleInstructions: Record<'quick' | 'detailed' | 'exam', string> = {
      quick: `Create **Quick Revision Notes** in crisp Markdown:
- Executive 3-sentence overview
- High-yield bulleted takeaways
- Essential definitions & key formulas table
- Rapid 60-second memory checklist`,
      detailed: `Create **Detailed Study Notes** in rich Markdown:
- Structured chapter/section hierarchy with clear H2 and H3 headings
- Full explanations of difficult concepts in clear, accessible language
- Important definitions and key formulas highlighted cleanly
- Concrete worked examples or analogies where helpful`,
      exam: `Create **Exam-Focused Revision Notes** in strategic Markdown:
- Core examinable principles & mark-scheme terminology
- Formula & theorem quick-reference sheet
- Common student misconceptions and examiner traps to avoid
- 3 high-probability exam-style prompts with model answer outlines`,
    };

    const prompt = `Subject: ${subjectName}
Source Material: ${resourceTitle}
${customFocus ? `Student Focus Request: ${customFocus}\n` : ''}
${styleInstructions[style] || styleInstructions.detailed}

Source Content:
"""
${resourceContent.slice(0, 120000)}
"""`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        systemInstruction:
          'You are an elite academic study synthesizer. Produce accurate, deeply organized Markdown revision notes grounded in the provided study material.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            content: { type: Type.STRING },
          },
          required: ['title', 'content'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({
      title: String(parsed.title || `${resourceTitle} — Notes`).slice(0, 200),
      content: String(parsed.content || '').slice(0, 195000),
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 3. Smart Flashcards Generator
app.post('/api/flashcards/generate', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjectName, resourceTitle, resourceContent, count = 10, weakTopics = [] } = req.body as {
      subjectName: string;
      resourceTitle: string;
      resourceContent: string;
      count?: number;
      weakTopics?: string[];
    };

    const safeCount = Math.min(Math.max(Number(count) || 10, 3), 25);
    const prompt = `Subject: ${subjectName}
Source: ${resourceTitle}
${weakTopics.length ? `Prioritize these weak topics where relevant: ${weakTopics.join(', ')}\n` : ''}
Generate ${safeCount} high-retention active-recall flashcards from the study material below.

Material:
"""
${String(resourceContent || '').slice(0, 100000)}
"""`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              front: { type: Type.STRING },
              back: { type: Type.STRING },
              hint: { type: Type.STRING },
              topic: { type: Type.STRING },
              difficulty: { type: Type.STRING },
            },
            required: ['front', 'back', 'hint', 'topic', 'difficulty'],
          },
        },
      },
    });

    const raw = JSON.parse((response.text ?? '[]').trim());
    const cards = (Array.isArray(raw) ? raw : []).slice(0, 25).map((c: Record<string, unknown>) => {
      const diff = String(c.difficulty || 'medium').toLowerCase();
      return {
        front: String(c.front || '').slice(0, 2000),
        back: String(c.back || '').slice(0, 4000),
        hint: String(c.hint || '').slice(0, 1000),
        topic: String(c.topic || 'Core Concept').slice(0, 120),
        difficulty: diff === 'easy' || diff === 'hard' ? diff : 'medium',
      };
    });

    res.json({ flashcards: cards });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 4. Adaptive Quiz & Full-Length Mock Exam Generator
app.post('/api/quizzes/generate', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const {
      subjectName,
      resourcesText,
      count = 6,
      difficulty = 'standard',
      questionTypes = ['mcq', 'tf', 'short'],
      pastWeakTopics = [],
      customTopic = '',
      isMockExam = false,
    } = req.body as {
      subjectName: string;
      resourcesText: string;
      count?: number;
      difficulty?: 'foundation' | 'standard' | 'advanced';
      questionTypes?: string[];
      pastWeakTopics?: string[];
      customTopic?: string;
      isMockExam?: boolean;
    };

    const safeCount = Math.min(Math.max(Number(count) || 6, 2), 25);
    const allowedTypes = questionTypes.length ? questionTypes : ['mcq', 'tf', 'short'];

    const prompt = `Generate a ${difficulty}-level ${isMockExam ? 'realistic formal mock examination' : 'academic practice assessment'} for "${subjectName}".
Total questions: ${safeCount}.
Allowed question types: ${allowedTypes.join(', ')}.
Type definitions:
- "mcq": Multiple choice with 4 distinct options in "options" array, and "correctAnswer" matching one option verbatim.
- "tf": True or False with "options": ["True", "False"], and "correctAnswer": "True" or "False".
- "short": Short answer ("options": []).
- "extended": Extended response / essay ("options": [], points: 4).
- "calculation": Quantitative calculation ("options": [], points: 3).
- "application": Scenario application ("options": [], points: 3).

${pastWeakTopics.length ? `ADAPTIVE FOCUS: Student previously struggled with: ${pastWeakTopics.join(', ')}. Target at least 40% of questions toward these topics.\n` : ''}
${customTopic ? `Specific topic focus: ${customTopic}\n` : ''}

Study Material Context:
"""
${String(resourcesText || 'Use standard curriculum concepts for ' + subjectName).slice(0, 110000)}
"""`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        systemInstruction:
          'You are an academic examiner creating rigorous, fair, clearly worded exam questions with marking criteria and explanations.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  type: { type: Type.STRING },
                  prompt: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  correctAnswer: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                  topic: { type: Type.STRING },
                  points: { type: Type.INTEGER },
                },
                required: ['id', 'type', 'prompt', 'options', 'correctAnswer', 'explanation', 'topic', 'points'],
              },
            },
          },
          required: ['title', 'questions'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    const validTypes = new Set(['mcq', 'tf', 'short', 'extended', 'calculation', 'application']);
    const questions = (Array.isArray(parsed.questions) ? parsed.questions : [])
      .slice(0, 30)
      .map((q: Record<string, unknown>, idx: number) => {
        const qType = String(q.type || 'mcq').toLowerCase();
        return {
          id: String(q.id || `q_${idx + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_'),
          type: validTypes.has(qType) ? qType : 'mcq',
          prompt: String(q.prompt || '').slice(0, 2000),
          options: Array.isArray(q.options) ? q.options.slice(0, 6).map((o: unknown) => String(o)) : [],
          correctAnswer: String(q.correctAnswer || '').slice(0, 2000),
          explanation: String(q.explanation || '').slice(0, 3000),
          topic: String(q.topic || 'General').slice(0, 120),
          points: Math.min(Math.max(Number(q.points) || 1, 1), 10),
        };
      });

    res.json({
      title: String(parsed.title || `${subjectName} Assessment`).slice(0, 200),
      questions,
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 5. AI Quiz & Exam Grading + Missing Points + Next Exam Advice
app.post('/api/quizzes/grade', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjectName, questions, answers } = req.body as {
      subjectName: string;
      questions: Array<{
        id: string;
        type: string;
        prompt: string;
        options: string[];
        correctAnswer: string;
        explanation: string;
        topic: string;
        points: number;
      }>;
      answers: Record<string, string>;
    };

    if (!Array.isArray(questions) || questions.length === 0) {
      res.status(400).json({ error: 'Questions array is required for grading.' });
      return;
    }

    const gradingPayload = questions.map((q) => ({
      id: q.id,
      type: q.type,
      topic: q.topic,
      prompt: q.prompt,
      maxPoints: q.points,
      correctAnswer: q.correctAnswer,
      studentAnswer: answers[q.id] || '(No answer submitted)',
    }));

    const prompt = `Grade this ${subjectName} assessment against formal marking criteria.
- For objective questions (mcq, tf), award full points on match and 0 otherwise.
- For written/calculation/application questions, award partial credit (0 to maxPoints), explicitly identify missing marking points, and explain how to earn full marks.
- Identify weakTopics and provide a crisp aiSummary recommending exact revision actions before the next exam.

Submissions:
${JSON.stringify(gradingPayload, null, 2)}`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            results: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  questionId: { type: Type.STRING },
                  isCorrect: { type: Type.BOOLEAN },
                  earnedPoints: { type: Type.NUMBER },
                  maxPoints: { type: Type.NUMBER },
                  feedback: { type: Type.STRING },
                },
                required: ['questionId', 'isCorrect', 'earnedPoints', 'maxPoints', 'feedback'],
              },
            },
            weakTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
            aiSummary: { type: Type.STRING },
          },
          required: ['results', 'weakTopics', 'aiSummary'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    const results = (Array.isArray(parsed.results) ? parsed.results : []).slice(0, 30);
    const totalScore = results.reduce(
      (sum: number, r: { earnedPoints?: number }) => sum + (Number(r.earnedPoints) || 0),
      0
    );

    res.json({
      results,
      score: Math.round(totalScore * 10) / 10,
      weakTopics: Array.isArray(parsed.weakTopics)
        ? parsed.weakTopics.slice(0, 30).map((t: unknown) => String(t).slice(0, 160))
        : [],
      aiSummary: String(parsed.aiSummary || '').slice(0, 10000),
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 6. Personal AI Tutor (Streaming SSE with Subject-Specific Teaching Approaches & Academic Memory)
app.post('/api/tutor/chat', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const {
      subjectName,
      mode = 'general',
      message,
      history = [],
      resourcesContext = '',
      weakTopics = [],
      confidence = 3,
      preferredComplexity = 'balanced',
    } = req.body as {
      subjectName: string;
      mode?: 'simple' | 'step_by_step' | 'example' | 'test_me' | 'explain_mistake' | 'general';
      message: string;
      history?: Array<{ role: 'user' | 'model'; content: string }>;
      resourcesContext?: string;
      weakTopics?: string[];
      confidence?: number;
      preferredComplexity?: string;
    };

    if (!message || !message.trim()) {
      res.status(400).json({ error: 'Message cannot be empty.' });
      return;
    }

    const modeInstructions: Record<string, string> = {
      simple:
        'Teaching Mode: EXPLAIN SIMPLY. Use plain intuition, zero jargon, short paragraphs, and end with a check-for-understanding question.',
      step_by_step:
        'Teaching Mode: STEP BY STEP. Break into numbered logical steps and ask the student to predict or verify the next step.',
      example:
        'Teaching Mode: WORKED EXAMPLE. Provide a clear worked example and then a quick mini-problem for active practice.',
      test_me:
        'Teaching Mode: TEST MY KNOWLEDGE. Ask ONE targeted Socratic question grounded in uploaded materials without revealing the answer prematurely.',
      explain_mistake:
        'Teaching Mode: EXPLAIN MY MISTAKE. Diagnose the exact misconception, clarify the rule, and invite a re-try.',
      general:
        'Teaching Mode: ADAPTIVE PERSONAL TUTOR. Adapt to the subject domain (Math/Physics formulas & step solutions, Chemistry equations, Biology processes, English literary/essay feedback, Language conjugation/grammar). Encourage active learning.',
    };

    const systemInstruction = `You are a dedicated Personal AI Tutor for "${subjectName}".
Student confidence: ${confidence}/5. Preferred explanation complexity: ${preferredComplexity}.
${weakTopics.length ? `Identified weak topics: ${weakTopics.join(', ')}.` : ''}
${modeInstructions[mode] || modeInstructions.general}

Uploaded Subject Materials Context:
${resourcesContext ? resourcesContext.slice(0, 70000) : 'No documents uploaded yet in this workspace.'}`;

    const chatContents = [
      ...history.slice(-16).map((h) => ({
        role: h.role === 'model' ? 'model' : 'user',
        parts: [{ text: h.content }],
      })),
      { role: 'user', parts: [{ text: message }] },
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = generateContentStreamWithResilience(ai, {
      contents: chatContents,
      config: {
        systemInstruction,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    });

    for await (const chunk of stream) {
      const text = chunk.text || '';
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    const formatted = formatGeminiError(error);
    if (!res.headersSent) {
      res.status(formatted.status).json({ error: formatted.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: formatted.message })}\n\n`);
      res.end();
    }
  }
});

// 7. Smart Study Planner Generator
app.post('/api/planner/generate', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const {
      subjects,
      availableHoursPerDay = 3,
      startDate,
      daysCount = 7,
      weakTopics = [],
      missedTasks = [],
    } = req.body as {
      subjects: Array<{
        id: string;
        name: string;
        examDate: string;
        confidence: number;
        topics: string[];
      }>;
      availableHoursPerDay?: number;
      startDate: string;
      daysCount?: number;
      weakTopics?: string[];
      missedTasks?: Array<{ title: string; subjectId: string; topic: string }>;
    };

    if (!Array.isArray(subjects) || subjects.length === 0) {
      res.status(400).json({ error: 'Add at least one subject before generating a study plan.' });
      return;
    }

    const prompt = `Create an intelligent ${daysCount}-day personalized study timetable starting on ${startDate}.
Daily study budget: ${availableHoursPerDay} hours (${Math.round(availableHoursPerDay * 60)} minutes/day max).

Subjects:
${JSON.stringify(subjects, null, 2)}

${weakTopics.length ? `Weak topics needing spaced revision: ${weakTopics.join(', ')}\n` : ''}
${missedTasks.length ? `Missed tasks to reschedule early: ${JSON.stringify(missedTasks)}\n` : ''}

Output 2 to 4 concrete tasks per day using exact subjectId, scheduledDate (YYYY-MM-DD), startTime (HH:MM), durationMinutes (25-90), priority ("high"|"medium"|"low"), taskType ("revision"|"flashcards"|"quiz"|"reading").`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rationale: { type: Type.STRING },
            tasks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  subjectId: { type: Type.STRING },
                  title: { type: Type.STRING },
                  topic: { type: Type.STRING },
                  scheduledDate: { type: Type.STRING },
                  startTime: { type: Type.STRING },
                  durationMinutes: { type: Type.INTEGER },
                  priority: { type: Type.STRING },
                  taskType: { type: Type.STRING },
                },
                required: [
                  'subjectId',
                  'title',
                  'topic',
                  'scheduledDate',
                  'startTime',
                  'durationMinutes',
                  'priority',
                  'taskType',
                ],
              },
            },
          },
          required: ['rationale', 'tasks'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    const validIds = new Set(subjects.map((s) => s.id));
    const fallbackId = subjects[0].id;
    const validPriorities = new Set(['high', 'medium', 'low']);
    const validTaskTypes = new Set(['revision', 'flashcards', 'quiz', 'reading']);

    const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : []).slice(0, 35).map((t: Record<string, unknown>) => ({
      subjectId: validIds.has(String(t.subjectId)) ? String(t.subjectId) : fallbackId,
      title: String(t.title || 'Focused Revision').slice(0, 200),
      topic: String(t.topic || 'Core Syllabus').slice(0, 160),
      scheduledDate: String(t.scheduledDate || startDate).slice(0, 20),
      startTime: String(t.startTime || '09:00').slice(0, 20),
      durationMinutes: Math.min(Math.max(Number(t.durationMinutes) || 45, 15), 180),
      priority: validPriorities.has(String(t.priority)) ? String(t.priority) : 'medium',
      taskType: validTaskTypes.has(String(t.taskType)) ? String(t.taskType) : 'revision',
    }));

    res.json({ rationale: String(parsed.rationale || ''), tasks });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 8. Dashboard Recommendations
app.post('/api/recommendations', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjects, recentQuizzes, flashcardsDueCount, resourcesCount, studyMinutesToday, dailyGoalMinutes } = req.body;

    const prompt = `As the student's AI academic coach, analyze their telemetry and return 3-4 actionable revision recommendations for today.
Telemetry:
- Subjects: ${JSON.stringify(subjects)}
- Recent Quizzes: ${JSON.stringify(recentQuizzes)}
- Flashcards Due: ${flashcardsDueCount}
- Resources: ${resourcesCount}
- Minutes Today: ${studyMinutesToday} / ${dailyGoalMinutes}`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            coachMessage: { type: Type.STRING },
            recommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  actionType: { type: Type.STRING },
                  subjectId: { type: Type.STRING },
                  estimatedMinutes: { type: Type.INTEGER },
                },
                required: ['title', 'reason', 'actionType', 'subjectId', 'estimatedMinutes'],
              },
            },
          },
          required: ['coachMessage', 'recommendations'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({
      coachMessage: String(parsed.coachMessage || ''),
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 4) : [],
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 9. STUDY AUTOPILOT ("Start My Study Day")
app.post('/api/autopilot/run', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjects, resources, quizzes, flashcardsDueCount, todayDate, dailyGoalMinutes } = req.body as {
      subjects: Array<{ id: string; name: string; examDate: string; confidence: number; topics: string[] }>;
      resources: Array<{ subjectId: string; title: string; summary: string }>;
      quizzes: Array<{ subjectId: string; score: number; maxScore: number; weakTopics: string[] }>;
      flashcardsDueCount: number;
      todayDate: string;
      dailyGoalMinutes: number;
    };

    if (!Array.isArray(subjects) || subjects.length === 0) {
      res.status(400).json({ error: 'Create at least one subject to activate Study Autopilot.' });
      return;
    }

    const prompt = `You are STUDY AUTOPILOT on ${todayDate}.
Analyze the student's subjects, upcoming exams, uploaded materials, and quiz performance, then orchestrate their entire study day:
1. Choose the single highest-priority subjectId right now ("focusSubjectId").
2. Write an encouraging, concrete daily briefing ("briefing") explaining what needs revision and why.
3. Generate 3 concrete scheduled tasks for today (${todayDate}) fitting within ${dailyGoalMinutes} minutes.
4. Generate 1 targeted high-yield micro-lesson note ("microNoteTitle", "microNoteContent" in Markdown) addressing the highest-risk exam topic or weak spot.
5. Generate 3 rapid warm-up practice questions ("practiceQuestions") with answers & explanations.

Subjects: ${JSON.stringify(subjects)}
Resources: ${JSON.stringify(resources.slice(0, 12))}
Recent Quizzes: ${JSON.stringify(quizzes.slice(0, 8))}
Due Flashcards: ${flashcardsDueCount}`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            focusSubjectId: { type: Type.STRING },
            briefing: { type: Type.STRING },
            nextActionLabel: { type: Type.STRING },
            tasks: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  subjectId: { type: Type.STRING },
                  title: { type: Type.STRING },
                  topic: { type: Type.STRING },
                  startTime: { type: Type.STRING },
                  durationMinutes: { type: Type.INTEGER },
                  priority: { type: Type.STRING },
                  taskType: { type: Type.STRING },
                },
                required: ['subjectId', 'title', 'topic', 'startTime', 'durationMinutes', 'priority', 'taskType'],
              },
            },
            microNoteTitle: { type: Type.STRING },
            microNoteContent: { type: Type.STRING },
            practiceQuestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  type: { type: Type.STRING },
                  prompt: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  correctAnswer: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                  topic: { type: Type.STRING },
                  points: { type: Type.INTEGER },
                },
                required: ['id', 'type', 'prompt', 'options', 'correctAnswer', 'explanation', 'topic', 'points'],
              },
            },
          },
          required: [
            'focusSubjectId',
            'briefing',
            'nextActionLabel',
            'tasks',
            'microNoteTitle',
            'microNoteContent',
            'practiceQuestions',
          ],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    const validIds = new Set(subjects.map((s) => s.id));
    const focusSubjectId = validIds.has(String(parsed.focusSubjectId)) ? String(parsed.focusSubjectId) : subjects[0].id;
    const validPriorities = new Set(['high', 'medium', 'low']);
    const validTaskTypes = new Set(['revision', 'flashcards', 'quiz', 'reading']);

    const tasks = (Array.isArray(parsed.tasks) ? parsed.tasks : []).slice(0, 5).map((t: Record<string, unknown>) => ({
      subjectId: validIds.has(String(t.subjectId)) ? String(t.subjectId) : focusSubjectId,
      title: String(t.title || 'Focused Revision').slice(0, 200),
      topic: String(t.topic || 'Priority Topic').slice(0, 160),
      scheduledDate: todayDate,
      startTime: String(t.startTime || '09:00').slice(0, 20),
      durationMinutes: Math.min(Math.max(Number(t.durationMinutes) || 30, 10), 120),
      priority: (validPriorities.has(String(t.priority)) ? String(t.priority) : 'high') as 'high' | 'medium' | 'low',
      taskType: (validTaskTypes.has(String(t.taskType)) ? String(t.taskType) : 'revision') as 'revision' | 'flashcards' | 'quiz' | 'reading',
    }));

    res.json({
      focusSubjectId,
      briefing: String(parsed.briefing || ''),
      nextActionLabel: String(parsed.nextActionLabel || 'Start Focus Session'),
      tasks,
      microNoteTitle: String(parsed.microNoteTitle || 'Autopilot Daily Focus Note').slice(0, 200),
      microNoteContent: String(parsed.microNoteContent || '').slice(0, 195000),
      practiceQuestions: Array.isArray(parsed.practiceQuestions) ? parsed.practiceQuestions.slice(0, 5) : [],
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 10. AI Learning Intelligence & Weekly Learning Report
app.post('/api/intelligence/analyze', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjects, quizzes, flashcards, sessions } = req.body;

    const prompt = `Perform deep AI Learning Intelligence analysis on this student's actual performance telemetry:
Subjects: ${JSON.stringify(subjects)}
Completed Quizzes & Results: ${JSON.stringify(quizzes)}
Flashcard Retention Stats: ${JSON.stringify(flashcards)}
Study Sessions: ${JSON.stringify(sessions)}

Return:
1. recurringMistakes: Specific patterns of mistakes observed across assessments/flashcards.
2. strugglingTopics: Topics needing urgent reinforcement.
3. topicEstimates: Array of { topic, masteryScore (0-100), guessingRisk ("low"|"medium"|"high"), note }.
4. recommendedComplexity: "foundation" | "balanced" | "rigorous" (automatic complexity adjustment).
5. revisionPath: Ordered 4-step personalized revision path ({ step, title, action }).
6. weeklyReport: Detailed Markdown Weekly AI Learning Report with achievements, gaps, and next week's strategy.`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            recurringMistakes: { type: Type.ARRAY, items: { type: Type.STRING } },
            strugglingTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
            topicEstimates: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  topic: { type: Type.STRING },
                  masteryScore: { type: Type.INTEGER },
                  guessingRisk: { type: Type.STRING },
                  note: { type: Type.STRING },
                },
                required: ['topic', 'masteryScore', 'guessingRisk', 'note'],
              },
            },
            recommendedComplexity: { type: Type.STRING },
            revisionPath: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  step: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  action: { type: Type.STRING },
                },
                required: ['step', 'title', 'action'],
              },
            },
            weeklyReport: { type: Type.STRING },
          },
          required: [
            'recurringMistakes',
            'strugglingTopics',
            'topicEstimates',
            'recommendedComplexity',
            'revisionPath',
            'weeklyReport',
          ],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    const comp = String(parsed.recommendedComplexity || 'balanced');
    res.json({
      recurringMistakes: Array.isArray(parsed.recurringMistakes) ? parsed.recurringMistakes.slice(0, 20) : [],
      strugglingTopics: Array.isArray(parsed.strugglingTopics) ? parsed.strugglingTopics.slice(0, 20) : [],
      topicEstimates: Array.isArray(parsed.topicEstimates) ? parsed.topicEstimates.slice(0, 15) : [],
      recommendedComplexity:
        comp === 'foundation' || comp === 'rigorous' ? comp : 'balanced',
      revisionPath: Array.isArray(parsed.revisionPath) ? parsed.revisionPath.slice(0, 6) : [],
      weeklyReport: String(parsed.weeklyReport || ''),
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 11. Interactive Learning Mode Generator
app.post('/api/interactive/generate', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjectName, resourceContent, activityType, topic } = req.body as {
      subjectName: string;
      resourceContent: string;
      activityType: 'auto' | 'match' | 'fill_gaps' | 'equation_steps' | 'timeline' | 'diagram_label';
      topic?: string;
    };

    const chosenHint =
      activityType === 'auto'
        ? `Pick the single best interactive activityType for "${subjectName}" from: "match", "fill_gaps", "equation_steps", "timeline", "diagram_label".`
        : `Generate an activity of exact activityType "${activityType}".`;

    const prompt = `${chosenHint}
Subject: ${subjectName}
${topic ? `Topic: ${topic}\n` : ''}
Context:
"""
${String(resourceContent || subjectName).slice(0, 45000)}
"""

Return a JSON object with:
- title: Activity title
- activityType: One of "match" | "fill_gaps" | "equation_steps" | "timeline" | "diagram_label"
- instructions: Brief 1-sentence instructions
- items: Array of structured items appropriate for the chosen type:
  - For "match": [{ id, left: "Term", right: "Definition", hint }] (6 pairs)
  - For "fill_gaps": [{ id, left: "Sentence with ___ blank", right: "exact missing word/formula", hint }] (5 items)
  - For "equation_steps": [{ id, left: "Step prompt or equation to transform", right: "Next simplified step / answer", hint }] (4-5 ordered steps)
  - For "timeline": [{ id, left: "Event / Stage name", right: "Year or order index (1..N) + short significance", hint }] (5 items in correct chronological/process order)
  - For "diagram_label": [{ id, left: "Label #1 (e.g. Mitochondria)", right: "Function/description shown on diagram", hint: "top-left | center | bottom-right | left | right" }] (5-6 labelled regions of a key system/diagram)`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            activityType: { type: Type.STRING },
            instructions: { type: Type.STRING },
            items: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  left: { type: Type.STRING },
                  right: { type: Type.STRING },
                  hint: { type: Type.STRING },
                },
                required: ['id', 'left', 'right', 'hint'],
              },
            },
          },
          required: ['title', 'activityType', 'instructions', 'items'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    const validTypes = new Set(['match', 'fill_gaps', 'equation_steps', 'timeline', 'diagram_label']);
    const resolvedType = validTypes.has(String(parsed.activityType)) ? String(parsed.activityType) : 'match';

    res.json({
      title: String(parsed.title || `${subjectName} Interactive Exercise`).slice(0, 200),
      activityType: resolvedType,
      payload: {
        instructions: String(parsed.instructions || 'Complete each step carefully.'),
        items: Array.isArray(parsed.items) ? parsed.items.slice(0, 10) : [],
      },
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 12. Smart Homework Assistant (Photo / PDF / Text Recognition + Checking)
app.post('/api/homework/analyze', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const subjectName = String(req.body.subjectName || 'General');
    const pastedText = String(req.body.pastedText || '').trim();
    const title = String(req.body.title || '').trim();
    const file = req.file;

    if (!file && !pastedText) {
      res.status(400).json({ error: 'Upload a worksheet photo/PDF or paste homework questions.' });
      return;
    }

    const prompt = `You are a Smart Homework Assistant for "${subjectName}".
Examine the worksheet and recognize each individual question (up to 12).
For each question provide:
- id: e.g. "hw_1"
- prompt: Exact recognized question text
- whatItAsks: Clear explanation of what the question is actually asking the student to do
- hint: A helpful starting nudge WITHOUT giving away the final answer
- steps: Array of 3-5 logical scaffolded steps to solve it
- topic: Topic name`;

    let contents: unknown = `${prompt}\n\nWorksheet Text:\n${pastedText.slice(0, 50000)}`;
    if (file) {
      const fType = detectFileType(file.mimetype, file.originalname);
      if (fType === 'pdf' || fType === 'image') {
        const mime = fType === 'pdf' ? 'application/pdf' : file.mimetype || 'image/png';
        contents = {
          parts: [{ inlineData: { mimeType: mime, data: file.buffer.toString('base64') } }, { text: prompt }],
        };
      } else if (fType === 'docx') {
        const docRes = await mammoth.extractRawText({ buffer: file.buffer });
        contents = `${prompt}\n\nWorksheet Text:\n${docRes.value.slice(0, 50000)}`;
      } else {
        contents = `${prompt}\n\nWorksheet Text:\n${file.buffer.toString('utf8').slice(0, 50000)}`;
      }
    }

    const response = await generateContentWithResilience(ai, {
      contents: contents as never,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  prompt: { type: Type.STRING },
                  whatItAsks: { type: Type.STRING },
                  hint: { type: Type.STRING },
                  steps: { type: Type.ARRAY, items: { type: Type.STRING } },
                  topic: { type: Type.STRING },
                },
                required: ['id', 'prompt', 'whatItAsks', 'hint', 'steps', 'topic'],
              },
            },
          },
          required: ['title', 'questions'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({
      title: (title || String(parsed.title || `${subjectName} Homework Worksheet`)).slice(0, 200),
      questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 20) : [],
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

app.post('/api/homework/check', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjectName, questionPrompt, studentAnswer } = req.body as {
      subjectName: string;
      questionPrompt: string;
      studentAnswer: string;
    };

    const prompt = `Subject: ${subjectName}
Question: ${questionPrompt}
Student Attempt: ${studentAnswer}

Check the student's attempt carefully:
1. Is it correct? (isCorrect: boolean)
2. Explain any errors clearly and kindly, or affirm strong reasoning (explanation).
3. Generate one similar practice question at the same level so they can test mastery (similarQuestion).`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isCorrect: { type: Type.BOOLEAN },
            explanation: { type: Type.STRING },
            similarQuestion: { type: Type.STRING },
          },
          required: ['isCorrect', 'explanation', 'similarQuestion'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json(parsed);
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 13. AI Mind Map & Knowledge Graph Generator
app.post('/api/mindmap/generate', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjectName, topicOrContent } = req.body as {
      subjectName: string;
      topicOrContent: string;
    };

    const prompt = `Build an interactive hierarchical Mind Map & Knowledge Graph for "${subjectName}" based on:
"""
${String(topicOrContent || subjectName).slice(0, 45000)}
"""

Return a flat list of 12-20 connected nodes representing a tree/graph (level 0 = root topic, level 1 = main branches, level 2 = sub-concepts/definitions):
- id: short unique id (e.g. "n0", "n1", "n1_1")
- parentId: null for root (n0), otherwise parent's id
- label: Concise concept name (2-5 words)
- category: Category name (e.g. "Core Principle", "Formula", "Mechanism", "Application")
- color: One of "indigo" | "blue" | "emerald" | "amber" | "violet" | "rose"
- definition: Clear 1-2 sentence explanation of this node
- prerequisites: Array of 0-3 prerequisite concept names
- level: Integer 0, 1, or 2`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            nodes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  parentId: { type: Type.STRING, nullable: true },
                  label: { type: Type.STRING },
                  category: { type: Type.STRING },
                  color: { type: Type.STRING },
                  definition: { type: Type.STRING },
                  prerequisites: { type: Type.ARRAY, items: { type: Type.STRING } },
                  level: { type: Type.INTEGER },
                },
                required: ['id', 'label', 'category', 'color', 'definition', 'prerequisites', 'level'],
              },
            },
          },
          required: ['title', 'nodes'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    const nodes = (Array.isArray(parsed.nodes) ? parsed.nodes : []).slice(0, 60).map((n: Record<string, unknown>, idx: number) => ({
      id: String(n.id || `n${idx}`),
      parentId: idx === 0 ? null : n.parentId ? String(n.parentId) : 'n0',
      label: String(n.label || 'Concept').slice(0, 120),
      category: String(n.category || 'Concept').slice(0, 60),
      color: String(n.color || 'indigo'),
      definition: String(n.definition || '').slice(0, 1000),
      prerequisites: Array.isArray(n.prerequisites) ? n.prerequisites.slice(0, 5).map(String) : [],
      level: Math.min(Math.max(Number(n.level) || 0, 0), 3),
    }));

    res.json({
      title: String(parsed.title || `${subjectName} Knowledge Map`).slice(0, 200),
      nodes,
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 14. AI Language Learning Lab
app.post('/api/language/generate', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { language, level = 'intermediate', focusMode = 'mixed', topic = 'Everyday & Academic' } = req.body as {
      language: string;
      level?: string;
      focusMode?: string;
      topic?: string;
    };

    const prompt = `Create a structured ${level}-level ${language} Language Lab session focused on "${focusMode}" (Topic: ${topic}).
Return:
1. vocabulary: 6 useful words/phrases ({ term, translation, partOfSpeech, exampleSentence })
2. conjugations: 2 key verbs with full tense conjugation ({ verb, tense, forms: [{ pronoun, form }] })
3. exercises: 4 interactive exercises mixing grammar, sentence construction, translation, and reading comprehension ({ id, type, prompt, targetAnswer, hint })
4. readingPassage: A short paragraph in ${language} with 2 comprehension questions ({ passage, englishSummary, questions: [{ q, a }] })`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            vocabulary: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  term: { type: Type.STRING },
                  translation: { type: Type.STRING },
                  partOfSpeech: { type: Type.STRING },
                  exampleSentence: { type: Type.STRING },
                },
                required: ['term', 'translation', 'partOfSpeech', 'exampleSentence'],
              },
            },
            conjugations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  verb: { type: Type.STRING },
                  tense: { type: Type.STRING },
                  forms: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        pronoun: { type: Type.STRING },
                        form: { type: Type.STRING },
                      },
                      required: ['pronoun', 'form'],
                    },
                  },
                },
                required: ['verb', 'tense', 'forms'],
              },
            },
            exercises: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  type: { type: Type.STRING },
                  prompt: { type: Type.STRING },
                  targetAnswer: { type: Type.STRING },
                  hint: { type: Type.STRING },
                },
                required: ['id', 'type', 'prompt', 'targetAnswer', 'hint'],
              },
            },
            readingPassage: {
              type: Type.OBJECT,
              properties: {
                passage: { type: Type.STRING },
                englishSummary: { type: Type.STRING },
                questions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      q: { type: Type.STRING },
                      a: { type: Type.STRING },
                    },
                    required: ['q', 'a'],
                  },
                },
              },
              required: ['passage', 'englishSummary', 'questions'],
            },
          },
          required: ['vocabulary', 'conjugations', 'exercises', 'readingPassage'],
        },
      },
    });

    res.json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

app.post('/api/language/check', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { language, prompt: exPrompt, targetAnswer, studentAnswer } = req.body;
    const response = await generateContentWithResilience(ai, {
      contents: `Evaluate this ${language} student exercise answer.
Prompt: ${exPrompt}
Expected Target: ${targetAnswer}
Student Answer: ${studentAnswer}
Be encouraging, note exact grammar/accent/gender nuances, and state whether it is acceptable.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            isCorrect: { type: Type.BOOLEAN },
            feedback: { type: Type.STRING },
            correctedSentence: { type: Type.STRING },
          },
          required: ['isCorrect', 'feedback', 'correctedSentence'],
        },
      },
    });
    res.json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 15. AI Universal Natural-Language Search
app.post('/api/search/semantic', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { queryText, indexItems } = req.body as {
      queryText: string;
      indexItems: Array<{ id: string; kind: string; subjectId: string; title: string; snippet: string }>;
    };

    if (!queryText?.trim()) {
      res.json({ rankedIds: [], answer: '' });
      return;
    }

    const prompt = `The student searched their study library using natural language: "${queryText}"
Rank the most relevant matching item IDs (up to 10) from the index below, and provide a brief 2-sentence direct answer synthesizing what their library contains on this query.

Library Index:
${JSON.stringify(indexItems.slice(0, 60))}`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            answer: { type: Type.STRING },
            rankedIds: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['answer', 'rankedIds'],
        },
      },
    });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({
      answer: String(parsed.answer || ''),
      rankedIds: Array.isArray(parsed.rankedIds) ? parsed.rankedIds : [],
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 16. Subject-Specific AI Mode Helper (Chemistry balancing, Math/Physics graphs, English essay analysis)
app.post('/api/subject-lab/run', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { domain, task, input } = req.body as { domain: string; task: string; input: string };

    const prompt = `You are a Subject-Specific Academic Specialist in ${domain}.
Task: ${task}
Student Input:
"""
${String(input || '').slice(0, 25000)}
"""
Provide a crystal-clear, structured Markdown response tailored specifically to ${domain} conventions (worked equations, balanced chemical equations, literary critiques, or biological mechanism tables).`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      },
    });

    res.json({ result: response.text ?? '' });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 17. Standard Text-to-Speech Endpoint (delegates playback to browser speechSynthesis; real-time voice uses /ws/voice-tutor Live API)
app.post('/api/tts', (req: Request, res: Response) => {
  const { text = '', lang = 'en-US' } = req.body as {
    text?: string;
    lang?: string;
  };

  if (!text || !text.trim()) {
    res.status(400).json({ error: 'Text is required for speech synthesis.' });
    return;
  }

  res.json({
    mode: 'browser_speech',
    text: text.trim().slice(0, 4000),
    lang,
    message: 'Standard text-to-speech uses browser speechSynthesis. Use /ws/voice-tutor for Gemini Live API audio.',
  });
});

// 18. AI Teacher Mode Virtual Classroom
app.post('/api/teacher/lesson', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const {
      subjectName,
      topic,
      difficulty = 'standard',
      action = 'start',
      question = '',
      resourcesContext = '',
      answers = {},
      knowledgeCheck = [],
    } = req.body as {
      subjectName: string;
      topic: string;
      difficulty?: string;
      action?: 'start' | 'example' | 'qa' | 'grade_check';
      question?: string;
      resourcesContext?: string;
      answers?: Record<string, string>;
      knowledgeCheck?: Array<{ id: string; prompt: string; correctAnswer: string }>;
    };

    if (action === 'example') {
      const response = await generateContentWithResilience(ai, {
        contents: `In "${subjectName}" on topic "${topic}", the student requested another concrete worked example${question ? ` focusing on: ${question}` : ''}. Provide a crisp step-by-step worked example in Markdown plus a quick check question.`,
        config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      }, 20000, { endpoint: '/api/teacher/lesson:example' });
      res.json({ markdown: response.text ?? '' });
      return;
    }

    if (action === 'qa') {
      const response = await generateContentWithResilience(ai, {
        contents: `You are teaching a live classroom lesson on "${topic}" in "${subjectName}".
A student paused to ask: "${question}"
Context: ${resourcesContext.slice(0, 20000)}
Answer clearly, kindly, and concretely in 2-3 short paragraphs, then invite them to continue the lesson.`,
        config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      }, 20000, { endpoint: '/api/teacher/lesson:qa' });
      res.json({ markdown: response.text ?? '' });
      return;
    }

    if (action === 'grade_check') {
      const response = await generateContentWithResilience(ai, {
        contents: `Evaluate the student's end-of-lesson knowledge check for "${topic}" in "${subjectName}".
Questions & Correct Answers: ${JSON.stringify(knowledgeCheck)}
Student Answers: ${JSON.stringify(answers)}
Return score (0-100) and concise encouraging feedback.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              score: { type: Type.INTEGER },
              feedback: { type: Type.STRING },
            },
            required: ['score', 'feedback'],
          },
        },
      }, 20000, { endpoint: '/api/teacher/lesson:grade_check' });
      res.json(JSON.parse((response.text ?? '{}').trim()));
      return;
    }

    const prompt = `Design a structured virtual classroom lesson for "${subjectName}" on "${topic}" at "${difficulty}" level.
Ground in context if provided:
"""
${resourcesContext.slice(0, 30000)}
"""
Return JSON with:
- introduction: Engaging 2-paragraph introduction stating learning goals.
- explanation: Thorough, well-structured Markdown explanation with headings and key takeaways.
- workedExamples: Array of 2 worked examples ({ title, problem, solutionMarkdown }).
- whiteboardSvg: A clean self-contained SVG diagram (<svg viewBox="0 0 640 280" ...>...</svg>) visually illustrating a core concept/relationship/equation from this lesson using dark-slate strokes (#4f46e5, #0f172a, #059669) and legible labels (no external images/scripts).
- lessonNotes: Clean revision summary notes in Markdown to auto-save.
- knowledgeCheck: 3 short end-of-lesson check questions ({ id, prompt, options (4 choices), correctAnswer, explanation }).`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            introduction: { type: Type.STRING },
            explanation: { type: Type.STRING },
            workedExamples: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  problem: { type: Type.STRING },
                  solutionMarkdown: { type: Type.STRING },
                },
                required: ['title', 'problem', 'solutionMarkdown'],
              },
            },
            whiteboardSvg: { type: Type.STRING },
            lessonNotes: { type: Type.STRING },
            knowledgeCheck: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  prompt: { type: Type.STRING },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  correctAnswer: { type: Type.STRING },
                  explanation: { type: Type.STRING },
                },
                required: ['id', 'prompt', 'options', 'correctAnswer', 'explanation'],
              },
            },
          },
          required: ['introduction', 'explanation', 'workedExamples', 'whiteboardSvg', 'lessonNotes', 'knowledgeCheck'],
        },
      },
    }, 28000, { endpoint: '/api/teacher/lesson:start' });

    res.json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 19. AI Whiteboard Vision Analysis
app.post('/api/whiteboard/analyze', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { imageDataUrl, subjectName = 'General', mode = 'notes', boardTitle = 'Whiteboard' } = req.body as {
      imageDataUrl: string;
      subjectName?: string;
      mode?: 'notes' | 'check_work' | 'diagram';
      boardTitle?: string;
    };

    if (!imageDataUrl || !imageDataUrl.includes('base64,')) {
      res.status(400).json({ error: 'Whiteboard snapshot is empty.' });
      return;
    }

    const [header, base64Data] = imageDataUrl.split('base64,');
    const mimeMatch = header.match(/data:(.*?);/);
    const mimeType = mimeMatch?.[1] || 'image/png';

    const modePrompt =
      mode === 'check_work'
        ? `Examine this handwritten/drawn "${subjectName}" whiteboard ("${boardTitle}"). Transcribe equations/diagrams/working shown, identify any mistakes in working or reasoning line-by-line, and show the corrected solution clearly in Markdown.`
        : mode === 'diagram'
          ? `Examine the diagram/graph drawn on this "${subjectName}" whiteboard ("${boardTitle}"). Explain what the diagram represents, verify labels/axes/relationships, and highlight key principles in Markdown.`
          : `Convert all handwritten notes, equations, sketches, and labels on this "${subjectName}" whiteboard ("${boardTitle}") into clean, well-structured digital Markdown revision notes.`;

    const response = await generateContentWithResilience(ai, {
      contents: {
        parts: [
          { inlineData: { mimeType, data: base64Data } },
          { text: modePrompt },
        ],
      },
      config: { thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM } },
    }, 26000, { endpoint: '/api/whiteboard/analyze' });

    res.json({ analysis: response.text ?? '' });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 20. Personal Textbook Builder
app.post('/api/textbook/generate', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjectName, topic, difficulty = 'standard', chapterCount = 3, resourcesContext = '' } = req.body as {
      subjectName: string;
      topic: string;
      difficulty?: 'foundation' | 'standard' | 'advanced';
      chapterCount?: number;
      resourcesContext?: string;
    };

    const count = Math.min(Math.max(Number(chapterCount) || 3, 2), 5);
    const prompt = `Author a personalized ${difficulty}-level interactive textbook for "${subjectName}" covering "${topic}" in ${count} cohesive chapters.
${resourcesContext ? `Ground in student resources:\n${resourcesContext.slice(0, 30000)}\n` : ''}
Each chapter MUST include:
- id, title
- objectives: 3 learning objectives
- explanationMarkdown: Rich, clear explanation (400+ words with headings & callouts)
- illustrationSvg: Clean crisp SVG concept diagram (<svg viewBox="0 0 560 220" ...>...</svg>)
- workedExamples: 2 worked examples ({ problem, solution })
- terminology: 4 key terms ({ term, definition })
- summary: Concise chapter summary
- exercises: 3 practice exercises ({ prompt, hint, answer })
- chapterTest: 3 end-of-chapter MCQ items ({ prompt, options (4), correctAnswer, explanation })`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            chapters: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  objectives: { type: Type.ARRAY, items: { type: Type.STRING } },
                  explanationMarkdown: { type: Type.STRING },
                  illustrationSvg: { type: Type.STRING },
                  workedExamples: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        problem: { type: Type.STRING },
                        solution: { type: Type.STRING },
                      },
                      required: ['problem', 'solution'],
                    },
                  },
                  terminology: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        term: { type: Type.STRING },
                        definition: { type: Type.STRING },
                      },
                      required: ['term', 'definition'],
                    },
                  },
                  summary: { type: Type.STRING },
                  exercises: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        prompt: { type: Type.STRING },
                        hint: { type: Type.STRING },
                        answer: { type: Type.STRING },
                      },
                      required: ['prompt', 'hint', 'answer'],
                    },
                  },
                  chapterTest: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        prompt: { type: Type.STRING },
                        options: { type: Type.ARRAY, items: { type: Type.STRING } },
                        correctAnswer: { type: Type.STRING },
                        explanation: { type: Type.STRING },
                      },
                      required: ['prompt', 'options', 'correctAnswer', 'explanation'],
                    },
                  },
                },
                required: [
                  'id',
                  'title',
                  'objectives',
                  'explanationMarkdown',
                  'illustrationSvg',
                  'workedExamples',
                  'terminology',
                  'summary',
                  'exercises',
                  'chapterTest',
                ],
              },
            },
          },
          required: ['title', 'chapters'],
        },
      },
    }, 35000, { endpoint: '/api/textbook/generate' });

    const parsed = JSON.parse((response.text ?? '{}').trim());
    res.json({
      title: String(parsed.title || `${subjectName}: ${topic}`).slice(0, 200),
      chapters: Array.isArray(parsed.chapters) ? parsed.chapters.slice(0, 10) : [],
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 21. AI Video Learning Storyboard, Slides, Script & Subtitles
app.post('/api/video-studio/generate', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjectName, topic, content = '', format = 'short_explainer' } = req.body as {
      subjectName: string;
      topic: string;
      content?: string;
      format?: 'short_explainer' | 'chapter_summary' | 'lesson_script';
    };

    const prompt = `Create an educational Visual Lesson Storyboard & Script (${format}) for "${subjectName}" on "${topic}".
Source notes/material:
"""
${content.slice(0, 35000)}
"""
Generate 5 cohesive visual scenes/slides suitable for a narrated slide-deck explainer with timed captions.
For each scene provide:
- index (1..5)
- title: Slide heading
- durationSeconds: Integer (12-25)
- narration: Clear spoken script sentence(s) for audio narration
- subtitle: Crisp on-screen subtitle text
- bulletPoints: 3 concise key points shown on the slide
- diagramSvg: Clean inline SVG illustration (<svg viewBox="0 0 480 220" ...>...</svg>) visualizing the concept with readable labels.`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            overviewScript: { type: Type.STRING },
            scenes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  index: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  durationSeconds: { type: Type.INTEGER },
                  narration: { type: Type.STRING },
                  subtitle: { type: Type.STRING },
                  bulletPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                  diagramSvg: { type: Type.STRING },
                },
                required: ['index', 'title', 'durationSeconds', 'narration', 'subtitle', 'bulletPoints', 'diagramSvg'],
              },
            },
          },
          required: ['title', 'overviewScript', 'scenes'],
        },
      },
    }, 28000, { endpoint: '/api/video-studio/generate' });

    res.json({
      ...JSON.parse((response.text ?? '{}').trim()),
      videoRenderingSupported: false,
      videoStatusNote:
        'Storyboard slides, timed .srt subtitles, scripts, and Gemini TTS voiceover are active. Direct MP4 video rendering requires a paid/external video generation model.',
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 22. Predictive Exam Preparation (Evidence-Based Readiness)
app.post('/api/exam-prep/analyze', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjectName, examDate, topics, completedTopics, strugglingTopics, quizStats, flashcardAccuracy, studyMinutes } =
      req.body;

    const prompt = `Evaluate evidence-based exam preparation readiness for "${subjectName}" (exam date: ${examDate || 'Not set'}).
Actual evidence available:
- Syllabus topics: ${JSON.stringify(topics)}
- Completed topics: ${JSON.stringify(completedTopics)}
- Struggling topics: ${JSON.stringify(strugglingTopics)}
- Practice quiz stats: ${JSON.stringify(quizStats)}
- Flashcard accuracy: ${flashcardAccuracy}%
- Recorded study minutes in subject: ${studyMinutes}

Important rules:
1. Base estimatedReadinessPercent (0-100) strictly on actual available evidence (if little practice evidence exists, explain clearly that readiness is uncertain/low confidence due to limited recorded practice).
2. NEVER present estimates as guaranteed exam scores or predicted grades.
3. Return per-topic attention priorities explaining WHY each topic needs revision, plus a structured daily preparation plan until the exam.`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            estimatedReadinessPercent: { type: Type.INTEGER },
            evidenceConfidence: { type: Type.STRING },
            readinessSummary: { type: Type.STRING },
            topicAssessments: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  topic: { type: Type.STRING },
                  status: { type: Type.STRING },
                  reason: { type: Type.STRING },
                  recommendedMinutes: { type: Type.INTEGER },
                },
                required: ['topic', 'status', 'reason', 'recommendedMinutes'],
              },
            },
            prepPlan: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['estimatedReadinessPercent', 'evidenceConfidence', 'readinessSummary', 'topicAssessments', 'prepPlan'],
        },
      },
    }, 24000, { endpoint: '/api/exam-prep/analyze' });

    res.json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 23. Mistake Database Misconception Analyzer
app.post('/api/mistakes/analyze', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjectName, topic, question, studentAnswer, correctAnswer } = req.body as {
      subjectName: string;
      topic?: string;
      question: string;
      studentAnswer: string;
      correctAnswer: string;
    };

    const prompt = `Analyze a student's mistake in "${subjectName}"${topic ? ` (${topic})` : ''}:
Question: ${question}
Student's Answer: ${studentAnswer || '(blank)'}
Correct Answer / Marking Criteria: ${correctAnswer || '(derive accurately)'}

Return:
- inferredTopic: Concise topic name
- misconception: Root cognitive/conceptual error in 1 crisp sentence
- explanation: Clear step-by-step correction explaining why the student's answer missed the mark and how to get it right
- practiceQuestion: One fresh similar practice question at the same level`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            inferredTopic: { type: Type.STRING },
            misconception: { type: Type.STRING },
            explanation: { type: Type.STRING },
            practiceQuestion: { type: Type.STRING },
          },
          required: ['inferredTopic', 'misconception', 'explanation', 'practiceQuestion'],
        },
      },
    }, 20000, { endpoint: '/api/mistakes/analyze' });

    res.json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 24. AI Explanation Studio (8 Explanation Formats)
app.post('/api/explain/studio', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjectName = 'General Study', topic, style = 'eli10', context = '' } = req.body as {
      subjectName?: string;
      topic: string;
      style?:
        | 'eli10'
        | 'school_level'
        | 'academic'
        | 'real_world'
        | 'visual'
        | 'analogy'
        | 'step_by_step'
        | 'exam_answer';
      context?: string;
    };

    const styleMap: Record<string, string> = {
      eli10: 'Explain Like I am 10: warm, vivid everyday words, zero intimidating jargon, concrete mental picture.',
      school_level: 'Simple School-Level Explanation: clear high-school clarity, intuitive examples, clean key terms.',
      academic: 'Detailed Academic Explanation: formal university-grade rigor, mechanisms, edge cases, and precision.',
      real_world: 'Real-World Example Explanation: anchor the entire concept in practical engineering, medicine, finance, or everyday phenomena.',
      visual: 'Visual Explanation: organize spatial relationships and include a clean illustrative SVG diagram.',
      analogy: 'Analogy-Based Explanation: build an unforgettable extended analogy mapping every part cleanly to the concept.',
      step_by_step: 'Step-by-Step Explanation: numbered sequential logical progression from first principles.',
      exam_answer: 'Exam-Answer Explanation: structured high-scoring model exam response highlighting mark-scheme keywords and common traps.',
    };

    const prompt = `Subject: ${subjectName}
Topic to explain: ${topic}
Selected Format: ${styleMap[style] || styleMap.school_level}
${context ? `Study Material Reference:\n${context.slice(0, 20000)}` : ''}

Return JSON with:
- contentMarkdown: Richly formatted explanation strictly matching the requested format.
- keyTakeaway: 1-sentence memorable synthesis.
- diagramSvg: Clean, valid inline SVG (<svg viewBox="0 0 520 200" ...>...</svg>) illustrating the core idea visually with high-contrast labels.`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            contentMarkdown: { type: Type.STRING },
            keyTakeaway: { type: Type.STRING },
            diagramSvg: { type: Type.STRING },
          },
          required: ['contentMarkdown', 'keyTakeaway', 'diagramSvg'],
        },
      },
    }, 24000, { endpoint: '/api/explain/studio' });

    res.json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 25. AI Resource Discovery (Google Search Grounding -> Real Source URLs)
app.post('/api/discovery/search', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { subjectName = 'General', topic, resourceKind = 'all' } = req.body as {
      subjectName?: string;
      topic: string;
      resourceKind?: string;
    };

    const prompt = `Search the web for reliable, high-quality educational study resources on "${topic}" in "${subjectName}" (focus: ${resourceKind}: explanatory articles, lecture notes, educational videos, textbook chapters, and practice problems).
Organize the response in crisp Markdown grouped by resource category (Core Guides & Notes, Interactive / Practice Problems, Lectures & Visual Explainers), describing what each resource helps the student master.`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    }, 26000, { endpoint: '/api/discovery/search' });

    const candidate = response.candidates?.[0] as
      | {
          groundingMetadata?: {
            groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
            webSearchQueries?: string[];
          };
        }
      | undefined;

    const rawChunks = candidate?.groundingMetadata?.groundingChunks || [];
    const seen = new Set<string>();
    const sources = rawChunks
      .map((c) => ({
        title: String(c.web?.title || 'Educational Source'),
        uri: String(c.web?.uri || ''),
      }))
      .filter((s) => {
        if (!s.uri || seen.has(s.uri)) return false;
        seen.add(s.uri);
        return true;
      });

    res.json({
      guideMarkdown: response.text ?? '',
      sources,
      queriesUsed: candidate?.groundingMetadata?.webSearchQueries || [],
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 26. Study Session Replay Summarizer
app.post('/api/sessions/summarize', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { topic, subjectName, transcript = [], notesContent = '' } = req.body as {
      topic: string;
      subjectName: string;
      transcript?: Array<{ role: string; text: string }>;
      notesContent?: string;
    };

    const response = await generateContentWithResilience(ai, {
      contents: `Summarize this completed "${subjectName}" study session on "${topic}" in concise Markdown:
1. Concepts mastered
2. Key questions asked & clarifications
3. Recommended next revision step

Transcript: ${JSON.stringify(transcript.slice(-25))}
Notes: ${notesContent.slice(0, 10000)}`,
      config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    }, 20000, { endpoint: '/api/sessions/summarize' });

    res.json({ summary: response.text ?? '' });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 27. AI Essay & Writing Lab
app.post('/api/writing/analyze', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const {
      essayText,
      subjectName = 'Academic Writing',
      rubricGoal = 'Clarity, Thesis Strength, Evidence, and Style',
      mode = 'full',
    } = req.body as {
      essayText: string;
      subjectName?: string;
      rubricGoal?: string;
      mode?: 'full' | 'argument' | 'concise';
    };

    if (!essayText || !essayText.trim()) {
      res.status(400).json({ error: 'Please paste your essay or writing draft first.' });
      return;
    }

    const prompt = `Evaluate this ${subjectName} essay/writing draft against rubric focus: "${rubricGoal}" (Analysis mode: ${mode}).
Draft:
"""
${essayText.slice(0, 45000)}
"""
Return structured feedback:
- overallScore: Integer 0-100
- rubricBreakdown: Array of 4 criteria ({ criterion, score (0-25), feedback })
- grammarAndVocabulary: Array of 3-6 specific sentence-level improvements ({ original, improved, reason })
- argumentStrength: Critique of thesis, structure, flow, and evidence
- improvedDraft: Full polished before-and-after improved version preserving the student's voice.`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallScore: { type: Type.INTEGER },
            rubricBreakdown: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  criterion: { type: Type.STRING },
                  score: { type: Type.INTEGER },
                  feedback: { type: Type.STRING },
                },
                required: ['criterion', 'score', 'feedback'],
              },
            },
            grammarAndVocabulary: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  original: { type: Type.STRING },
                  improved: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
                required: ['original', 'improved', 'reason'],
              },
            },
            argumentStrength: { type: Type.STRING },
            improvedDraft: { type: Type.STRING },
          },
          required: ['overallScore', 'rubricBreakdown', 'grammarAndVocabulary', 'argumentStrength', 'improvedDraft'],
        },
      },
    }, 26000, { endpoint: '/api/writing/analyze' });

    res.json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 29. AI Study Podcast Script Generator (Dual-Host Alex & Sam)
app.post('/api/podcasts/script', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const {
      subjectName = 'General Study',
      topic = '',
      hostStyle = 'conversational',
      context = '',
    } = req.body as {
      subjectName?: string;
      topic?: string;
      hostStyle?: string;
      context?: string;
    };

    if (!topic.trim() && !context.trim()) {
      res.status(400).json({ error: 'Provide a topic or select a subject with uploaded resources.' });
      return;
    }

    const styleDesc: Record<string, string> = {
      conversational: 'warm, engaging, curiosity-driven study podcast between two friends',
      exam_cram: 'fast-paced, high-yield exam revision podcast focusing on common exam traps and recall hooks',
      deep_dive: 'rigorous academic seminar conversation unpacking mechanisms, intuition, and proofs',
      debate_duo: 'spirited point-counterpoint intellectual debate examining multiple perspectives',
    };

    const prompt = `Write a sharp, natural dual-host educational podcast episode script for ${subjectName} on "${topic || 'Core Subject Review'}".
Style: ${styleDesc[hostStyle] || styleDesc.conversational}.
Hosts:
- Alex: energetic lead host who introduces concepts and asks probing questions.
- Sam: insightful co-host who explains clearly with vivid analogies and concrete examples.
${context ? `\nGrounding study material:\n${context.slice(0, 24000)}` : ''}

Return 10 to 14 alternating dialogue turns (each 1-3 crisp spoken sentences so it sounds great when spoken aloud, avoiding markdown formatting or bullet symbols inside dialogue lines) plus 4-6 concise key takeaways.`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            estimatedMinutes: { type: Type.INTEGER },
            turns: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  speaker: { type: Type.STRING, enum: ['Alex', 'Sam'] },
                  line: { type: Type.STRING },
                },
                required: ['speaker', 'line'],
              },
            },
            takeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['title', 'estimatedMinutes', 'turns', 'takeaways'],
        },
      },
    }, 26000, { endpoint: '/api/podcasts/script' });

    res.json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 30. Study Podcast Dialogue Playback Payload (uses browser speechSynthesis on client without invalid generateContent speech fields)
app.post('/api/podcasts/audio', (req: Request, res: Response) => {
  const { turns = [] } = req.body as {
    turns?: Array<{ speaker: 'Alex' | 'Sam'; line: string }>;
  };

  const cleanTurns = turns
    .filter((t) => t && typeof t.line === 'string' && t.line.trim().length > 0)
    .slice(0, 20)
    .map((t) => ({
      speaker: t.speaker === 'Sam' ? 'Sam' : 'Alex',
      line: t.line.trim().slice(0, 800),
    }));

  if (cleanTurns.length === 0) {
    res.status(400).json({ error: 'No dialogue turns available to play.' });
    return;
  }

  res.json({
    mode: 'browser_speech',
    turns: cleanTurns,
    modelUsed: 'Browser Web Speech Synthesis',
  });
});

// 31. Lecture Audio Transcription (gemini-3.5-transcribe) & Cornell Notes Generator
app.post('/api/lectures/transcribe-cornell', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const subjectName = String(req.body.subjectName || 'General Study');
    const lectureTitle = String(req.body.lectureTitle || '').trim();
    const pastedTranscript = String(req.body.pastedTranscript || '').trim();
    const file = req.file;

    if (!file && !pastedTranscript) {
      res.status(400).json({ error: 'Record audio, upload an audio file, or paste a lecture transcript.' });
      return;
    }

    let transcriptText = pastedTranscript;

    if (file) {
      const startedAt = Date.now();
      const rawMime = file.mimetype || 'audio/webm';
      const safeMime = rawMime.split(';')[0].trim() || 'audio/webm';
      const audioPart = {
        inlineData: {
          mimeType: safeMime,
          data: file.buffer.toString('base64'),
        },
      };

      try {
        const transcribeRes = await ai.models.generateContent({
          model: TRANSCRIBE_MODEL_NAME,
          contents: {
            parts: [
              audioPart,
              { text: `Transcribe this ${subjectName} lecture accurately with punctuation and paragraph breaks.` },
            ],
          },
          config: {
            abortSignal: AbortSignal.timeout(45000),
          },
        });
        transcriptText = (transcribeRes.text || '').trim();
        recordServerTelemetry({
          endpoint: '/api/lectures/transcribe-cornell',
          modelUsed: TRANSCRIBE_MODEL_NAME,
          status: 'success',
          promptTokens: 0,
          outputTokens: 0,
          durationMs: Date.now() - startedAt,
          summary: `Transcribed lecture audio (${Math.round(file.size / 1024)} KB)`,
        });
      } catch (transcribeErr) {
        console.warn('[Transcribe] Falling back to multimodal primary model:', transcribeErr instanceof Error ? transcribeErr.message : String(transcribeErr));
        const fallbackTranscribe = await generateContentWithResilience(ai, {
          contents: {
            parts: [
              audioPart,
              { text: `Provide a clean, verbatim transcript of this ${subjectName} audio recording.` },
            ],
          },
        }, 35000, { endpoint: '/api/lectures/transcribe-cornell' });
        transcriptText = (fallbackTranscribe.text || '').trim();
      }
    }

    if (!transcriptText) {
      res.status(400).json({ error: 'No speech could be transcribed from the audio recording. Please try speaking closer to the mic or uploading a clearer clip.' });
      return;
    }

    const cornellPrompt = `Transform this ${subjectName} lecture transcript into high-clarity **Cornell Notes** and study flashcards.
${lectureTitle ? `Suggested Title: ${lectureTitle}` : ''}
Transcript:
"""
${transcriptText.slice(0, 40000)}
"""
Return JSON with:
- title: Concise descriptive lecture title
- cues: 5-8 Cornell Cue Column entries ({ cue: exam question or key term, detail: crisp 1-2 sentence explanation })
- detailedNotesMarkdown: Structured Markdown notes covering main ideas, definitions, formulas, and examples
- summary: 3-4 sentence bottom Cornell synthesis summary
- actionItems: 3-5 concrete revision next steps
- flashcardSeeds: 4-6 high-yield study flashcards ({ front, back, hint, topic })`;

    const cornellRes = await generateContentWithResilience(ai, {
      contents: cornellPrompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            cues: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  cue: { type: Type.STRING },
                  detail: { type: Type.STRING },
                },
                required: ['cue', 'detail'],
              },
            },
            detailedNotesMarkdown: { type: Type.STRING },
            summary: { type: Type.STRING },
            actionItems: { type: Type.ARRAY, items: { type: Type.STRING } },
            flashcardSeeds: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  front: { type: Type.STRING },
                  back: { type: Type.STRING },
                  hint: { type: Type.STRING },
                  topic: { type: Type.STRING },
                },
                required: ['front', 'back', 'hint', 'topic'],
              },
            },
          },
          required: ['title', 'cues', 'detailedNotesMarkdown', 'summary', 'actionItems', 'flashcardSeeds'],
        },
      },
    }, 26000, { endpoint: '/api/lectures/transcribe-cornell' });

    const parsed = JSON.parse((cornellRes.text ?? '{}').trim());
    res.json({
      ...parsed,
      transcript: transcriptText,
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 32. Feynman Teach-Back Evaluator
app.post('/api/feynman/evaluate', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const {
      subjectName = 'General Study',
      topic = '',
      explanationText = '',
      followUpAnswers = '',
      context = '',
    } = req.body as {
      subjectName?: string;
      topic?: string;
      explanationText?: string;
      followUpAnswers?: string;
      context?: string;
    };

    if (!topic.trim() || !explanationText.trim()) {
      res.status(400).json({ error: 'Enter a topic and write your explanation in your own words first.' });
      return;
    }

    const prompt = `You are a rigorous yet encouraging Feynman Technique coach for ${subjectName}.
Topic the student is teaching back: "${topic}"
Student's explanation in their own words:
"""
${explanationText.slice(0, 18000)}
"""
${followUpAnswers ? `Student's answers to your follow-up probing questions:\n"""\n${followUpAnswers.slice(0, 8000)}\n"""` : ''}
${context ? `Reference course material:\n${context.slice(0, 16000)}` : ''}

Grade honestly:
- overallScore: integer 0-100
- scores: { clarity (0-25), accuracy (0-25), completeness (0-25), simplicity (0-25) }
- verdict: 2-sentence encouraging assessment of what clicked and what still needs work
- blindSpots: 2-5 exact conceptual gaps, leaps in logic, or missing mechanisms
- jargonFlags: 1-5 technical terms the student used without explaining simply (empty array if none)
- followUpQuestions: 2 sharp "curious novice" follow-up questions that expose hidden gaps
- refinedSummary: A crystal-clear model Feynman explanation in Markdown for the student to compare against.`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            overallScore: { type: Type.INTEGER },
            scores: {
              type: Type.OBJECT,
              properties: {
                clarity: { type: Type.INTEGER },
                accuracy: { type: Type.INTEGER },
                completeness: { type: Type.INTEGER },
                simplicity: { type: Type.INTEGER },
              },
              required: ['clarity', 'accuracy', 'completeness', 'simplicity'],
            },
            verdict: { type: Type.STRING },
            blindSpots: { type: Type.ARRAY, items: { type: Type.STRING } },
            jargonFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
            followUpQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
            refinedSummary: { type: Type.STRING },
          },
          required: ['overallScore', 'scores', 'verdict', 'blindSpots', 'jargonFlags', 'followUpQuestions', 'refinedSummary'],
        },
      },
    }, 24000, { endpoint: '/api/feynman/evaluate' });

    res.json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 33. STEM Function & Calculus Analyzer
app.post('/api/stem/analyze', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const {
      expression = '',
      xMin = -10,
      xMax = 10,
      integralA,
      integralB,
      numericIntegral,
    } = req.body as {
      expression?: string;
      xMin?: number;
      xMax?: number;
      integralA?: number;
      integralB?: number;
      numericIntegral?: number | null;
    };

    if (!expression.trim()) {
      res.status(400).json({ error: 'Provide a mathematical expression f(x) to analyze.' });
      return;
    }

    const prompt = `Analyze the mathematical function f(x) = ${expression} on the domain [${xMin}, ${xMax}].
${integralA !== undefined && integralB !== undefined ? `Student also computed definite integral from a=${integralA} to b=${integralB}${numericIntegral !== null && numericIntegral !== undefined ? ` (numerical estimate: ${numericIntegral.toFixed(4)})` : ''}.` : ''}
Return crisp Markdown with:
1. **Domain, Range & Symmetry**
2. **Roots & Intercepts**
3. **Symbolic Derivative f'(x) & Critical Points / Extrema**
4. **Indefinite Integral & Interpretation of the Shaded Area**
5. **Exam Tip** for sketching or differentiating this family of functions.`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    }, 22000, { endpoint: '/api/stem/analyze' });

    res.json({ analysisMarkdown: (response.text || '').trim() });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 34. STEM Code & Algorithm Reviewer
app.post('/api/stem/code-review', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const {
      code = '',
      task = 'complexity',
      consoleOutput = '',
      question = '',
    } = req.body as {
      code?: string;
      task?: 'debug' | 'complexity' | 'trace' | 'translate_python';
      consoleOutput?: string;
      question?: string;
    };

    if (!code.trim()) {
      res.status(400).json({ error: 'Enter code in the sandbox first.' });
      return;
    }

    const taskGuide: Record<string, string> = {
      debug: 'Identify any logic bugs, edge cases, off-by-one errors, or runtime issues and show the corrected version.',
      complexity: 'Derive the exact Time and Space Big-O complexity step by step and suggest an asymptotically faster approach if possible.',
      trace: 'Provide a clean step-by-step variable state trace table showing how the algorithm executes line by line.',
      translate_python: 'Translate this JavaScript code into idiomatic, clean Python 3 and explain key syntax/standard library differences.',
    };

    const prompt = `You are a Computer Science tutor reviewing a student's sandbox code.
Task: ${taskGuide[task] || taskGuide.complexity}
${question ? `Student's specific question: ${question}` : ''}
Code:
\`\`\`javascript
${code.slice(0, 12000)}
\`\`\`
${consoleOutput ? `Observed console output:\n\`\`\`\n${consoleOutput.slice(0, 3000)}\n\`\`\`` : ''}
Respond in structured, concise Markdown.`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    }, 22000, { endpoint: '/api/stem/code-review' });

    res.json({ markdown: (response.text || '').trim() });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 35. Academic Citation & Bibliography Generator (Google Search Grounded)
app.post('/api/citations/generate', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const {
      queryInput = '',
      sourceType = 'article',
      subjectName = 'Academic Research',
    } = req.body as {
      queryInput?: string;
      sourceType?: string;
      subjectName?: string;
    };

    if (!queryInput.trim()) {
      res.status(400).json({ error: 'Enter a URL, DOI, book title, paper title, or author details.' });
      return;
    }

    // Step 1: Ground real bibliographic details via Google Search so we never fabricate DOIs/pages
    let groundedNotes = '';
    let groundedUrl = '';
    try {
      const searchRes = await generateContentWithResilience(ai, {
        contents: `Find accurate bibliographic metadata (exact title, authors, publication year, publisher/journal, volume/issue/pages if any, and canonical URL/DOI) for this ${sourceType} reference: "${queryInput}". If any field cannot be verified, explicitly mark it as [Unverified].`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      }, 20000, { endpoint: '/api/citations/generate' });

      groundedNotes = (searchRes.text || '').trim();
      const chunks = searchRes.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      for (const c of chunks) {
        const uri = (c as { web?: { uri?: string } })?.web?.uri;
        if (uri) {
          groundedUrl = uri;
          break;
        }
      }
    } catch {
      groundedNotes = `User-provided details only (live search lookup skipped): ${queryInput}`;
    }

    // Step 2: Format cleanly into APA 7, MLA 9, Chicago, Harvard, IEEE, BibTeX + annotation
    const formatPrompt = `Format accurate academic citations based strictly on the verified bibliographic metadata below. Do NOT invent missing volume numbers, DOIs, or page ranges—omit unverified fields cleanly and mention them in verificationNote.
Subject: ${subjectName}
Source Type: ${sourceType}
User Input: ${queryInput}
Canonical URL found: ${groundedUrl || 'None'}
Grounded Metadata:
${groundedNotes.slice(0, 8000)}`;

    const formattedRes = await generateContentWithResilience(ai, {
      contents: formatPrompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            authors: { type: Type.STRING },
            year: { type: Type.STRING },
            url: { type: Type.STRING },
            inText: { type: Type.STRING },
            apa: { type: Type.STRING },
            mla: { type: Type.STRING },
            chicago: { type: Type.STRING },
            harvard: { type: Type.STRING },
            ieee: { type: Type.STRING },
            bibtex: { type: Type.STRING },
            annotation: { type: Type.STRING },
            verificationNote: { type: Type.STRING },
          },
          required: [
            'title', 'authors', 'year', 'url', 'inText',
            'apa', 'mla', 'chicago', 'harvard', 'ieee', 'bibtex',
            'annotation', 'verificationNote',
          ],
        },
      },
    }, 24000, { endpoint: '/api/citations/generate' });

    res.json(JSON.parse((formattedRes.text ?? '{}').trim()));
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 36. Printable Exam Cheat Sheet & Formula Crib Builder
app.post('/api/cheatsheets/generate', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const {
      subjectName = 'General Study',
      focusTopics = '',
      layoutColumns = 2,
      context = '',
    } = req.body as {
      subjectName?: string;
      focusTopics?: string;
      layoutColumns?: number;
      context?: string;
    };

    if (!focusTopics.trim() && !context.trim()) {
      res.status(400).json({ error: 'Provide focus topics or choose a subject with study resources.' });
      return;
    }

    const prompt = `Build an ultra-high-yield, exam-ready printable Cheat Sheet for ${subjectName}.
Focus Topics: ${focusTopics || 'Comprehensive Core Exam Topics'}
Target Print Grid: ${layoutColumns === 3 ? '3-column ultra-compact crib sheet' : '2-column structured reference sheet'}.
${context ? `Source study materials:\n${context.slice(0, 26000)}` : ''}

Return 4 to 6 dense, scannable sections. Each section must have:
- id: short slug
- heading: clear topic title
- keyPoints: 4-6 ultra-concise bullet facts or definitions
- formulas: 1-4 core equations, identities, or rules (empty array if non-quantitative)
- mnemonics: 1-2 memorable recall hooks or acronyms
- pitfalls: 1-3 classic exam traps to avoid.`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            sections: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  heading: { type: Type.STRING },
                  keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                  formulas: { type: Type.ARRAY, items: { type: Type.STRING } },
                  mnemonics: { type: Type.ARRAY, items: { type: Type.STRING } },
                  pitfalls: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['id', 'heading', 'keyPoints', 'formulas', 'mnemonics', 'pitfalls'],
              },
            },
          },
          required: ['title', 'sections'],
        },
      },
    }, 26000, { endpoint: '/api/cheatsheets/generate' });

    res.json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 37. Socratic Debate Arena — Live Turn & Logical Fallacy Detector
app.post('/api/debate/turn', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const {
      motion = '',
      studentStance = 'pro',
      subjectName = 'Critical Thinking',
      history = [],
      studentArgument = '',
    } = req.body as {
      motion?: string;
      studentStance?: 'pro' | 'con';
      subjectName?: string;
      history?: Array<{ role: 'student' | 'opponent'; text: string }>;
      studentArgument?: string;
    };

    if (!motion.trim() || !studentArgument.trim()) {
      res.status(400).json({ error: 'Provide a debate motion and your argument.' });
      return;
    }

    const aiStance = studentStance === 'pro' ? 'OPPOSITION (CON)' : 'AFFIRMATIVE (PRO)';
    const transcript = history
      .slice(-8)
      .map((h) => `${h.role === 'student' ? 'Student' : 'Opponent'}: ${h.text}`)
      .join('\n');

    const prompt = `You are a sharp, fair academic debate opponent in ${subjectName}.
Motion: "${motion}"
Student's Stance: ${studentStance.toUpperCase()}
Your Stance: ${aiStance}
Recent Debate Transcript:
${transcript || '(Opening statement)'}

Student's Latest Argument:
"""
${studentArgument.slice(0, 6000)}
"""

Respond with JSON:
- rebuttal: A crisp, well-reasoned 3-5 sentence rebuttal from the ${aiStance} perspective challenging the student's core premise.
- fallacyCheck: Array of 0-2 genuine logical fallacies or unsupported leaps found in the student's latest turn ({ name, quote, fix }). Return empty array if the reasoning is logically sound!
- counterQuestion: One incisive Socratic cross-examination question to force deeper evidence in the student's next turn.
- strengthDelta: Integer from -10 to +15 scoring how persuasive and well-supported the student's latest turn was.`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rebuttal: { type: Type.STRING },
            fallacyCheck: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  quote: { type: Type.STRING },
                  fix: { type: Type.STRING },
                },
                required: ['name', 'quote', 'fix'],
              },
            },
            counterQuestion: { type: Type.STRING },
            strengthDelta: { type: Type.INTEGER },
          },
          required: ['rebuttal', 'fallacyCheck', 'counterQuestion', 'strengthDelta'],
        },
      },
    }, 22000, { endpoint: '/api/debate/turn' });

    res.json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 38. Socratic Debate Arena — Judge's Scorecard
app.post('/api/debate/judge', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const {
      motion = '',
      studentStance = 'pro',
      history = [],
    } = req.body as {
      motion?: string;
      studentStance?: 'pro' | 'con';
      history?: Array<{ role: 'student' | 'opponent'; text: string }>;
    };

    if (history.length === 0) {
      res.status(400).json({ error: 'Complete at least one debate turn before requesting a judge scorecard.' });
      return;
    }

    const transcript = history
      .map((h, i) => `Turn ${i + 1} (${h.role === 'student' ? `Student - ${studentStance.toUpperCase()}` : 'AI Opponent'}): ${h.text}`)
      .join('\n\n');

    const prompt = `Act as an impartial academic debate adjudicator judging this debate.
Motion: "${motion}"
Student Stance: ${studentStance.toUpperCase()}

Transcript:
${transcript.slice(0, 20000)}

Evaluate the student's performance fairly:
- winner: "student" | "opponent" | "draw"
- totalScore: integer 0-100
- breakdown: { evidence (0-25), rebuttal (0-25), logic (0-25), persuasion (0-25) }
- strongestMove: What the student argued best
- improvementTip: One high-leverage tactic to improve essay/oral argumentation
- judgeVerdict: 2-3 sentence adjudication summary.`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            winner: { type: Type.STRING, enum: ['student', 'opponent', 'draw'] },
            totalScore: { type: Type.INTEGER },
            breakdown: {
              type: Type.OBJECT,
              properties: {
                evidence: { type: Type.INTEGER },
                rebuttal: { type: Type.INTEGER },
                logic: { type: Type.INTEGER },
                persuasion: { type: Type.INTEGER },
              },
              required: ['evidence', 'rebuttal', 'logic', 'persuasion'],
            },
            strongestMove: { type: Type.STRING },
            improvementTip: { type: Type.STRING },
            judgeVerdict: { type: Type.STRING },
          },
          required: ['winner', 'totalScore', 'breakdown', 'strongestMove', 'improvementTip', 'judgeVerdict'],
        },
      },
    }, 22000, { endpoint: '/api/debate/judge' });

    res.json(JSON.parse((response.text ?? '{}').trim()));
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 39. GPA & Final Exam Grade Strategy Advisor
app.post('/api/grades/strategy', async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const { courses = [] } = req.body as {
      courses?: Array<{
        courseName: string;
        credits: number;
        currentPercent: number | null;
        targetGradePercent: number;
        neededOnRemainingPercent: number | null;
        remainingWeightPercent: number;
      }>;
    };

    if (courses.length === 0) {
      res.status(400).json({ error: 'Add at least one course before asking for a grade strategy.' });
      return;
    }

    const prompt = `You are a pragmatic academic strategist. Analyze these courses and recommend where the student should allocate revision time for the highest GPA return on effort. Never promise guaranteed outcomes—base advice strictly on the math provided.
Courses JSON:
${JSON.stringify(courses, null, 2)}

Provide concise Markdown with:
1. **Highest-ROI Priority Ranking** (ranked by credit weight x remaining exam leverage)
2. **Realistic Target Adjustments** (flag any course where the required final score exceeds 100% or is very steep)
3. **Weekly Study Hour Split Recommendation** (concrete % split across courses).`;

    const response = await generateContentWithResilience(ai, {
      contents: prompt,
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    }, 20000, { endpoint: '/api/grades/strategy' });

    res.json({ strategyMarkdown: (response.text || '').trim() });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

// 28. Gemini Control Centre & Multi-Model Capability Status
app.get('/api/control-centre/status', (_req: Request, res: Response) => {
  const hasApiKey = Boolean(process.env.GEMINI_API_KEY);
  const cooldownRemainingSec = Math.max(0, Math.ceil((primaryModelCooldownUntil - Date.now()) / 1000));

  res.json({
    apiKeyConfigured: hasApiKey,
    preferredMode: aiTelemetryState.preferredMode,
    primaryCooldownSeconds: cooldownRemainingSec,
    telemetry: {
      totalRequests: aiTelemetryState.totalRequests,
      failedRequests: aiTelemetryState.failedRequests,
      totalPromptTokens: aiTelemetryState.totalPromptTokens,
      totalOutputTokens: aiTelemetryState.totalOutputTokens,
      recentEvents: aiTelemetryState.recentEvents.slice(0, 25),
    },
    models: [
      {
        id: MODEL_NAME,
        role: 'Primary Reasoning & Multimodal Engine',
        connected: hasApiKey,
        requiresPaidKey: false,
        status: !hasApiKey
          ? 'Missing API Key'
          : cooldownRemainingSec > 0
            ? `Cooldown (${cooldownRemainingSec}s)`
            : 'Active',
        capabilities: ['Notes & Quizzes', 'OCR & Document Analysis', 'Feynman & Debate', 'Google Search Grounding'],
      },
      {
        id: FALLBACK_MODEL_NAME,
        role: 'High-Speed Automatic Failover Engine',
        connected: hasApiKey,
        requiresPaidKey: false,
        status: hasApiKey ? 'Standby / Ready' : 'Missing API Key',
        capabilities: ['Low-Latency Grading', 'Resilient Fallback', 'Structured JSON'],
      },
      {
        id: LIVE_MODEL_NAME,
        role: 'Real-Time Bidirectional Voice & Oral Exam Model',
        connected: hasApiKey,
        requiresPaidKey: false,
        status: hasApiKey ? 'Active' : 'Missing API Key',
        capabilities: ['Low-Latency Audio Stream', 'Interruptible Speech', 'Pronunciation Coaching'],
      },
      {
        id: 'browser-speech-synthesis',
        role: 'Client-Side Text-to-Speech Narration Engine',
        connected: true,
        requiresPaidKey: false,
        status: 'Active (Browser Native)',
        capabilities: ['Storyboard Narration', 'Language Pronunciation', 'Dual-Host Study Podcasts'],
      },
      {
        id: TRANSCRIBE_MODEL_NAME,
        role: 'Lecture Audio Speech-to-Text Engine',
        connected: hasApiKey,
        requiresPaidKey: false,
        status: hasApiKey ? 'Active' : 'Missing API Key',
        capabilities: ['Live Mic Lecture Capture', 'Audio File Transcription', 'Cornell Notes Pipeline'],
      },
      {
        id: 'gemini-nano-banana-2.1',
        role: 'Direct Raster Image Generation',
        connected: false,
        requiresPaidKey: true,
        status: 'Requires Paid API Key (Not Enabled)',
        capabilities: ['Raster Illustration Generation (Using crisp SVG/Canvas diagrams instead)'],
      },
      {
        id: 'gemini-omni-1.2-flash',
        role: 'Video Understanding & Generation',
        connected: false,
        requiresPaidKey: true,
        status: 'Requires Paid API Key (Not Enabled)',
        capabilities: ['Direct Video Processing (Using storyboard slides + SRT + TTS instead)'],
      },
    ],
  });
});

app.post('/api/control-centre/mode', (req: Request, res: Response) => {
  const mode = String(req.body?.preferredMode || 'auto');
  if (mode === 'auto' || mode === 'primary' || mode === 'fast') {
    aiTelemetryState.preferredMode = mode;
    if (mode === 'primary') {
      primaryModelCooldownUntil = 0;
    }
    res.json({ ok: true, preferredMode: aiTelemetryState.preferredMode });
    return;
  }
  res.status(400).json({ error: 'Invalid model mode.' });
});

// 37. In-Place PDF Worksheet Solver (Structured JSON analysis — zero server-side PDF rendering)
app.post('/api/solve-pdf', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const ai = getAiClient();
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Please upload a PDF worksheet to solve.' });
      return;
    }

    const isPdf =
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      res.status(400).json({ error: 'Only PDF files (.pdf) are supported by the PDF Worksheet Solver.' });
      return;
    }

    const MAX_SOLVE_PDF_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_SOLVE_PDF_BYTES) {
      res.status(400).json({
        error: 'PDF exceeds the 10 MB limit. Please upload a smaller worksheet (max 10 MB and 15 pages).',
      });
      return;
    }

    const subjectHint = String(req.body?.subjectName || '').trim();
    const pageCountHint = Number(req.body?.pageCount || 0);
    if (pageCountHint > 15) {
      res.status(400).json({
        error: 'This worksheet has more than 15 pages. Please upload a PDF with 15 pages or fewer.',
      });
      return;
    }

    const prompt = `You are an expert teacher and examiner solving an uploaded PDF worksheet${subjectHint ? ` for ${subjectHint}` : ''}.
Carefully inspect EVERY page of this PDF (1-indexed pageNumber).
Find EVERY question, sub-question (e.g. 1a, 1b, 2, Question 3), fill-in-the-blank, equation, or problem on every page and solve it accurately.

For each question return an item in the "answers" array:
- pageNumber: 1-indexed integer page number where this question appears.
- questionLabel: Short label matching the worksheet (e.g. "1a", "2", "Question 3", "Part B").
- shortAnswer: A concise final answer (max 1-2 short lines, e.g. "x = 12", "B) Mitochondria", "4.5 m/s^2", "True") sized to fit cleanly inside the worksheet's blank space without overflowing. Prefer plain ASCII math notation (e.g. sqrt(2), pi, <=, >=, !=, ^2) when possible.
- detailedExplanation: Complete, clear step-by-step solution showing formulas, reasoning, and verification for the appended Solution Key pages.
- answerBox: Normalized [ymin, xmin, ymax, xmax] bounding box on a 0-1000 coordinate scale (0=top/left, 1000=bottom/right) pointing directly to the EMPTY blank line, answer box, or open whitespace immediately beside or below that question where a teacher would write the final answer in blue ink. Never overlap printed question text if open whitespace exists nearby. Ensure ymax > ymin + 20 and xmax > xmin + 80.`;

    const response = await generateContentWithResilience(
      ai,
      {
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: file.buffer.toString('base64'),
              },
            },
            { text: prompt },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              worksheetTitle: { type: Type.STRING },
              answers: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    pageNumber: { type: Type.INTEGER },
                    questionLabel: { type: Type.STRING },
                    shortAnswer: { type: Type.STRING },
                    detailedExplanation: { type: Type.STRING },
                    answerBox: {
                      type: Type.ARRAY,
                      items: { type: Type.INTEGER },
                    },
                  },
                  required: [
                    'pageNumber',
                    'questionLabel',
                    'shortAnswer',
                    'detailedExplanation',
                    'answerBox',
                  ],
                },
              },
            },
            required: ['worksheetTitle', 'answers'],
          },
        },
      },
      45000,
      { endpoint: '/api/solve-pdf' }
    );

    const parsed = JSON.parse((response.text ?? '{}').trim()) as {
      worksheetTitle?: string;
      answers?: Array<{
        pageNumber?: number;
        questionLabel?: string;
        shortAnswer?: string;
        detailedExplanation?: string;
        answerBox?: number[];
      }>;
    };

    const rawAnswers = Array.isArray(parsed.answers) ? parsed.answers : [];
    const answers = rawAnswers.slice(0, 120).map((item, idx) => {
      const box = Array.isArray(item.answerBox) && item.answerBox.length >= 4
        ? item.answerBox.map((n) => Math.max(0, Math.min(1000, Math.round(Number(n) || 0))))
        : [120 + (idx % 8) * 95, 550, 175 + (idx % 8) * 95, 920];

      let ymin = Math.min(box[0], box[2]);
      let ymax = Math.max(box[0], box[2]);
      let xmin = Math.min(box[1], box[3]);
      let xmax = Math.max(box[1], box[3]);

      if (ymax - ymin < 24) {
        ymax = Math.min(990, ymin + 36);
        ymin = Math.max(10, ymax - 36);
      }
      if (xmax - xmin < 80) {
        xmax = Math.min(980, xmin + 180);
        xmin = Math.max(20, xmax - 180);
      }

      const maxPage = pageCountHint > 0 ? pageCountHint : 15;
      const pageNumber = Math.max(1, Math.min(maxPage, Math.round(Number(item.pageNumber) || 1)));

      return {
        id: `ans_${idx + 1}_${Date.now().toString(36)}`,
        pageNumber,
        questionLabel: String(item.questionLabel || `Q${idx + 1}`).trim().slice(0, 60),
        shortAnswer: String(item.shortAnswer || '').trim().slice(0, 240),
        detailedExplanation: String(item.detailedExplanation || '').trim().slice(0, 3000),
        answerBox: [ymin, xmin, ymax, xmax] as [number, number, number, number],
      };
    });

    res.json({
      worksheetTitle: String(
        parsed.worksheetTitle || file.originalname.replace(/\.pdf$/i, '')
      ).slice(0, 160),
      answers,
    });
  } catch (error) {
    const formatted = formatGeminiError(error);
    res.status(formatted.status).json({ error: formatted.message });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = http.createServer(app);

  // Use noServer: true so multiple WebSocket endpoints cleanly share port 3000
  const wssLive = new WebSocketServer({ noServer: true });
  const wssRoom = new WebSocketServer({ noServer: true });

  // Live API WebSocket Bridge (/ws/live-tutor) using gemini-3.8-live
  wssLive.on('connection', (clientWs: WebSocket) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let isClosing = false;

    const connectLiveSession = async (initPayload: {
      subjectName?: string;
      mode?: string;
      language?: string;
      resourcesContext?: string;
      voiceName?: string;
    }) => {
      try {
        const ai = getAiClient();
        const subjectName = initPayload.subjectName || 'General Study';
        const mode = initPayload.mode || 'voice_tutor';
        const language = initPayload.language || '';
        const ctx = initPayload.resourcesContext ? initPayload.resourcesContext.slice(0, 20000) : '';

        const modeGuidance =
          mode === 'oral_exam'
            ? `Conduct a realistic spoken Oral Examination for "${subjectName}". Ask one focused question at a time, listen to the student's spoken answer, give concise constructive feedback, and follow up.`
            : mode === 'pronunciation'
              ? `You are an encouraging ${language || subjectName} speaking & pronunciation coach. Speak clearly, invite the student to repeat phrases or respond in ${language || 'the target language'}, and gently correct pronunciation or grammar.`
              : mode === 'vocab_test'
                ? `Run a rapid spoken vocabulary test for "${subjectName}" ${language ? `(${language})` : ''}. Prompt with a word or definition, wait for the spoken answer, verify, and keep pace brisk.`
                : `You are a warm, sharp real-time Voice AI Tutor for "${subjectName}". Speak concisely (2-4 sentences per turn so the student can interrupt anytime), encourage active thinking, and ground explanations in the student's materials.`;

        const systemInstruction = `${modeGuidance}\n\nStudy Material Context:\n${ctx || 'No documents loaded yet.'}`;

        liveSession = await ai.live.connect({
          model: LIVE_MODEL_NAME,
          config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: initPayload.voiceName || 'Zephyr' },
              },
            },
            systemInstruction,
          },
          callbacks: {
            onopen: () => {
              if (clientWs.readyState === clientWs.OPEN) {
                clientWs.send(JSON.stringify({ type: 'ready' }));
              }
            },
            onmessage: (message: LiveServerMessage) => {
              if (clientWs.readyState !== clientWs.OPEN) return;
              const sc = message.serverContent;
              if (sc?.inputTranscription?.text) {
                clientWs.send(
                  JSON.stringify({ type: 'inputTranscript', text: sc.inputTranscription.text })
                );
              }
              if (sc?.outputTranscription?.text) {
                clientWs.send(
                  JSON.stringify({ type: 'outputTranscript', text: sc.outputTranscription.text })
                );
              }
              for (const part of sc?.modelTurn?.parts ?? []) {
                if (part.inlineData?.data) {
                  clientWs.send(JSON.stringify({ type: 'audio', data: part.inlineData.data }));
                }
              }
              if (sc?.interrupted) {
                clientWs.send(JSON.stringify({ type: 'interrupted' }));
              }
              if (sc?.turnComplete) {
                clientWs.send(JSON.stringify({ type: 'turnComplete' }));
              }
            },
            onerror: (err) => {
              if (clientWs.readyState === clientWs.OPEN) {
                clientWs.send(
                  JSON.stringify({
                    type: 'error',
                    message: err instanceof Error ? err.message : 'Live session error',
                  })
                );
              }
            },
            onclose: () => {
              if (!isClosing && clientWs.readyState === clientWs.OPEN) {
                clientWs.send(JSON.stringify({ type: 'closed' }));
              }
            },
          },
        });
      } catch (err) {
        const formatted = formatGeminiError(err);
        if (clientWs.readyState === clientWs.OPEN) {
          clientWs.send(JSON.stringify({ type: 'error', message: formatted.message }));
        }
      }
    };

    clientWs.on('message', async (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString()) as {
          type?: string;
          audio?: string;
          text?: string;
          subjectName?: string;
          mode?: string;
          language?: string;
          resourcesContext?: string;
          voiceName?: string;
        };

        if (msg.type === 'init') {
          await connectLiveSession(msg);
          return;
        }

        if (!liveSession) return;

        if (msg.audio) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'text' && msg.text) {
          liveSession.sendRealtimeInput({ text: msg.text });
        }
      } catch (err) {
        if (clientWs.readyState === clientWs.OPEN) {
          clientWs.send(
            JSON.stringify({
              type: 'error',
              message: err instanceof Error ? err.message : 'Invalid Live message',
            })
          );
        }
      }
    });

    clientWs.on('close', () => {
      isClosing = true;
      try {
        liveSession?.close();
      } catch {
        // ignore close errors
      }
      liveSession = null;
    });
  });

  // Collaborative Study Rooms Real-Time WebSocket Hub (/ws/study-room)
  interface RoomPeer {
    ws: WebSocket;
    uid: string;
    displayName: string;
  }
  const activeRooms = new Map<string, Map<string, RoomPeer>>();

  const broadcastToRoom = (roomId: string, payload: unknown, excludeUid?: string) => {
    const peers = activeRooms.get(roomId);
    if (!peers) return;
    const raw = JSON.stringify(payload);
    for (const [peerUid, peer] of peers.entries()) {
      if (excludeUid && peerUid === excludeUid) continue;
      if (peer.ws.readyState === peer.ws.OPEN) {
        peer.ws.send(raw);
      }
    }
  };

  const broadcastPresence = (roomId: string) => {
    const peers = activeRooms.get(roomId);
    if (!peers) return;
    const members = Array.from(peers.values()).map((p) => ({
      uid: p.uid,
      displayName: p.displayName,
    }));
    broadcastToRoom(roomId, { type: 'presence', members });
  };

  wssRoom.on('connection', (ws: WebSocket) => {
    let joinedRoomId = '';
    let peerUid = '';

    ws.on('message', (rawData) => {
      try {
        const msg = JSON.parse(rawData.toString()) as {
          type?: string;
          roomId?: string;
          uid?: string;
          displayName?: string;
          text?: string;
          stroke?: unknown;
          quizAction?: unknown;
        };

        if (msg.type === 'join' && msg.roomId && msg.uid) {
          joinedRoomId = msg.roomId;
          peerUid = msg.uid;
          if (!activeRooms.has(joinedRoomId)) {
            activeRooms.set(joinedRoomId, new Map());
          }
          activeRooms.get(joinedRoomId)!.set(peerUid, {
            ws,
            uid: peerUid,
            displayName: String(msg.displayName || 'Scholar').slice(0, 60),
          });
          broadcastPresence(joinedRoomId);
          return;
        }

        if (!joinedRoomId) return;

        if (msg.type === 'chat' && msg.text) {
          broadcastToRoom(joinedRoomId, {
            type: 'chat',
            id: `chat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            uid: peerUid,
            displayName: String(msg.displayName || 'Scholar').slice(0, 60),
            text: String(msg.text).slice(0, 2000),
            timestamp: new Date().toISOString(),
          });
        } else if (msg.type === 'stroke' && msg.stroke) {
          broadcastToRoom(
            joinedRoomId,
            { type: 'stroke', uid: peerUid, stroke: msg.stroke },
            peerUid
          );
        } else if (msg.type === 'clear_board') {
          broadcastToRoom(joinedRoomId, { type: 'clear_board', uid: peerUid }, peerUid);
        } else if (msg.type === 'quiz_sync' && msg.quizAction) {
          broadcastToRoom(
            joinedRoomId,
            { type: 'quiz_sync', uid: peerUid, quizAction: msg.quizAction },
            peerUid
          );
        }
      } catch {
        // ignore malformed websocket payload
      }
    });

    ws.on('close', () => {
      if (joinedRoomId && peerUid) {
        const peers = activeRooms.get(joinedRoomId);
        if (peers) {
          peers.delete(peerUid);
          if (peers.size === 0) {
            activeRooms.delete(joinedRoomId);
          } else {
            broadcastPresence(joinedRoomId);
          }
        }
      }
    });
  });

  server.on('upgrade', (request, socket, head) => {
    const pathname = (request.url || '').split('?')[0];
    if (pathname === '/ws/live-tutor') {
      wssLive.handleUpgrade(request, socket, head, (ws) => {
        wssLive.emit('connection', ws, request);
      });
    } else if (pathname === '/ws/study-room') {
      wssRoom.handleUpgrade(request, socket, head, (ws) => {
        wssRoom.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Lumina Study server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
