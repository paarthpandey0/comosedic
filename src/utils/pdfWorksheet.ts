import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import type { PdfSolvedAnswer } from '../types';

export const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_PDF_PAGES = 15;

export interface InspectedPdf {
  bytes: Uint8Array;
  pageCount: number;
  pageSizes: Array<{ width: number; height: number }>;
}

/**
 * Converts Unicode math symbols, Greek letters, superscripts/subscripts, and
 * typographic punctuation into clean ASCII equivalents so pdf-lib's StandardFonts
 * (WinAnsi) never render blank squares or throw encoding errors.
 */
export function sanitizePdfMathText(raw: string): string {
  if (!raw) return '';

  const replacements: Array<[RegExp, string]> = [
    [/\r\n/g, '\n'],
    [/\r/g, '\n'],
    [/√\s*\(([^)]+)\)/g, 'sqrt($1)'],
    [/√([a-zA-Z0-9.]+)/g, 'sqrt($1)'],
    [/√/g, 'sqrt()'],
    [/∛/g, 'cbrt'],
    [/π/g, 'pi'],
    [/Π/g, 'Pi'],
    [/≠/g, '!='],
    [/≤/g, '<='],
    [/≥/g, '>='],
    [/≈/g, '~='],
    [/≡/g, '=='],
    [/±/g, '+/-'],
    [/∓/g, '-/+'],
    [/×/g, '*'],
    [/·/g, '*'],
    [/∙/g, '*'],
    [/÷/g, '/'],
    [/∞/g, 'infinity'],
    [/°/g, ' deg'],
    [/→/g, '->'],
    [/←/g, '<-'],
    [/↔/g, '<->'],
    [/⇒/g, '=>'],
    [/⇔/g, '<=>'],
    [/∈/g, ' in '],
    [/∉/g, ' not in '],
    [/∪/g, ' U '],
    [/∩/g, ' intersect '],
    [/⊂/g, ' subset '],
    [/⊆/g, ' subseteq '],
    [/∑/g, 'sum'],
    [/∫/g, 'integral'],
    [/∂/g, 'd'],
    [/∇/g, 'grad'],
    [/Δ/g, 'Delta'],
    [/δ/g, 'delta'],
    [/θ/g, 'theta'],
    [/Θ/g, 'Theta'],
    [/α/g, 'alpha'],
    [/β/g, 'beta'],
    [/γ/g, 'gamma'],
    [/λ/g, 'lambda'],
    [/μ/g, 'mu'],
    [/σ/g, 'sigma'],
    [/Σ/g, 'Sigma'],
    [/Ω/g, 'Ohm'],
    [/ω/g, 'omega'],
    [/φ/g, 'phi'],
    [/ρ/g, 'rho'],
    [/τ/g, 'tau'],
    [/½/g, '1/2'],
    [/⅓/g, '1/3'],
    [/⅔/g, '2/3'],
    [/¼/g, '1/4'],
    [/¾/g, '3/4'],
    [/⁰/g, '^0'],
    [/¹/g, '^1'],
    [/²/g, '^2'],
    [/³/g, '^3'],
    [/⁴/g, '^4'],
    [/⁵/g, '^5'],
    [/⁶/g, '^6'],
    [/⁷/g, '^7'],
    [/⁸/g, '^8'],
    [/⁹/g, '^9'],
    [/⁺/g, '+'],
    [/⁻/g, '-'],
    [/₀/g, '_0'],
    [/₁/g, '_1'],
    [/₂/g, '_2'],
    [/₃/g, '_3'],
    [/₄/g, '_4'],
    [/₅/g, '_5'],
    [/₆/g, '_6'],
    [/₇/g, '_7'],
    [/₈/g, '_8'],
    [/₉/g, '_9'],
    [/[“”«»]/g, '"'],
    [/[‘’`´]/g, "'"],
    [/[–—−]/g, '-'],
    [/…/g, '...'],
    [/•/g, '-'],
    [/\u00A0/g, ' '],
  ];

  let out = raw;
  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }

  // Strip any remaining characters outside printable ASCII (0x20-0x7E) and newline
  out = out.replace(/[^\x20-\x7E\n]/g, '');
  // Clean excessive spaces per line while preserving intentional newlines
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .trim();
}

/**
 * Validates size (<= 10MB) and page count (<= 15 pages) entirely client-side
 * using pdf-lib before uploading anything to the API.
 */
export async function inspectClientPdf(file: File): Promise<InspectedPdf> {
  if (!file) {
    throw new Error('Please choose a PDF worksheet to upload.');
  }

  const isPdf =
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    throw new Error('Please select a valid PDF (.pdf) worksheet file.');
  }

  if (file.size > MAX_PDF_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `This file is ${sizeMb} MB, which exceeds the 10 MB limit. Please compress or split the worksheet before uploading.`
    );
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    throw new Error(
      'Unable to read this PDF file. Please ensure it is not corrupted or password-locked.'
    );
  }

  const pageCount = pdfDoc.getPageCount();
  if (pageCount === 0) {
    throw new Error('This PDF contains no pages.');
  }
  if (pageCount > MAX_PDF_PAGES) {
    throw new Error(
      `This worksheet has ${pageCount} pages, which exceeds the ${MAX_PDF_PAGES}-page limit. Please upload a PDF with 15 pages or fewer.`
    );
  }

  const pageSizes = pdfDoc.getPages().map((page) => {
    const { width, height } = page.getSize();
    return { width, height };
  });

  return { bytes, pageCount, pageSizes };
}

function wrapTextToWidth(
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number
): string[] {
  const safeMax = Math.max(24, maxWidth);
  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para.trim()) {
      lines.push('');
      continue;
    }

    const words = para.split(/\s+/);
    let currentLine = '';

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, fontSize) <= safeMax) {
        currentLine = candidate;
      } else {
        if (currentLine) {
          lines.push(currentLine);
          currentLine = '';
        }
        // Handle a single token wider than safeMax
        if (font.widthOfTextAtSize(word, fontSize) > safeMax) {
          let chunk = '';
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, fontSize) <= safeMax) {
              chunk += ch;
            } else {
              if (chunk) lines.push(chunk);
              chunk = ch;
            }
          }
          currentLine = chunk;
        } else {
          currentLine = word;
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.length > 0 ? lines : [''];
}

/**
 * Generates the final solved PDF entirely in browser memory using pdf-lib:
 * 1. Draws every visible shortAnswer in crisp blue ink (#1D4ED8) inside its mapped
 *    answerBox [ymin, xmin, ymax, xmax], auto-wrapping and scaling font size from
 *    11pt down to 7.5pt.
 * 2. Appends clean Step-by-Step Solutions pages at the end of the document.
 */
export async function buildSolvedPdfBytes(
  originalBytes: Uint8Array,
  answers: PdfSolvedAnswer[],
  worksheetTitle: string
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Crisp blue ink (#1D4ED8)
  const blueInk = rgb(29 / 255, 78 / 255, 216 / 255);
  const inkDark = rgb(15 / 255, 23 / 255, 42 / 255);
  const inkMuted = rgb(100 / 255, 116 / 255, 139 / 255);
  const dividerColor = rgb(226 / 255, 232 / 255, 240 / 255);
  const badgeBg = rgb(239 / 255, 246 / 255, 255 / 255);

  const pages = pdfDoc.getPages();
  const visibleAnswers = answers.filter((a) => !a.hidden && a.shortAnswer.trim().length > 0);

  // Step 1: In-place blue-ink overlay on each worksheet page
  for (const ans of visibleAnswers) {
    const pageIdx = ans.pageNumber - 1;
    if (pageIdx < 0 || pageIdx >= pages.length) continue;

    const page = pages[pageIdx];
    const { width, height } = page.getSize();
    const [ymin, xmin, ymax, xmax] = ans.answerBox;

    // Map top-left normalized (0-1000) coordinates to PDF bottom-left point system
    const boxLeft = (Math.max(0, Math.min(990, xmin)) / 1000) * width;
    const boxRight = (Math.max(xmin + 20, Math.min(1000, xmax)) / 1000) * width;
    const boxTopY = height - (Math.max(0, Math.min(990, ymin)) / 1000) * height;
    const boxBottomY = height - (Math.max(ymin + 15, Math.min(1000, ymax)) / 1000) * height;

    const padX = 3;
    const padY = 2;
    const boxWidth = Math.max(36, boxRight - boxLeft - padX * 2);
    const boxHeight = Math.max(12, boxTopY - boxBottomY - padY * 2);

    const cleanShort = sanitizePdfMathText(ans.shortAnswer);
    if (!cleanShort) continue;

    // Auto-scale font size from 11pt down to 7.5pt until wrapped lines fit inside box
    let chosenSize = 11;
    let chosenLines = wrapTextToWidth(cleanShort, fontBold, chosenSize, boxWidth);

    for (let size = 11; size >= 7.5; size = Number((size - 0.5).toFixed(1))) {
      const candidateLines = wrapTextToWidth(cleanShort, fontBold, size, boxWidth);
      const lineHeight = size * 1.22;
      const totalHeight = candidateLines.length * lineHeight;
      chosenSize = size;
      chosenLines = candidateLines;
      if (totalHeight <= boxHeight + 2) {
        break;
      }
    }

    const lineHeight = chosenSize * 1.22;
    const maxRenderableLines = Math.max(1, Math.floor((boxHeight + 4) / lineHeight));
    const linesToDraw = chosenLines.slice(0, maxRenderableLines);

    // Vertically center if single-line blank, otherwise top-align with slight padding
    const totalTextHeight = linesToDraw.length * lineHeight;
    const startTopOffset =
      linesToDraw.length === 1 && boxHeight > chosenSize * 1.6
        ? (boxHeight - totalTextHeight) / 2
        : 0;

    linesToDraw.forEach((line, lineIdx) => {
      const baselineY =
        boxTopY - padY - startTopOffset - chosenSize - lineIdx * lineHeight;
      const clampedY = Math.max(8, Math.min(height - chosenSize - 4, baselineY));
      const clampedX = Math.max(6, Math.min(width - 24, boxLeft + padX));

      page.drawText(line, {
        x: clampedX,
        y: clampedY,
        size: chosenSize,
        font: fontBold,
        color: blueInk,
      });
    });
  }

  // Step 2: Append Step-by-Step Solutions pages at the end of the PDF
  const activeKeyItems = answers.filter((a) => !a.hidden);
  if (activeKeyItems.length > 0) {
    const PAGE_W = 612;
    const PAGE_H = 792;
    const MARGIN_X = 48;
    const CONTENT_W = PAGE_W - MARGIN_X * 2;
    const BOTTOM_MARGIN = 54;

    const cleanTitle = sanitizePdfMathText(worksheetTitle || 'Worksheet') || 'Worksheet';
    let keyPageIndex = 0;

    const createSolutionPage = () => {
      keyPageIndex += 1;
      const p = pdfDoc.addPage([PAGE_W, PAGE_H]);

      // Top header
      p.drawText('Lumina Study  |  Step-by-Step Solution Key', {
        x: MARGIN_X,
        y: PAGE_H - 42,
        size: 9,
        font: fontBold,
        color: blueInk,
      });

      const headerTitle =
        keyPageIndex === 1
          ? `Solutions: ${cleanTitle}`
          : `Solutions (cont.): ${cleanTitle}`;
      const truncatedTitle =
        headerTitle.length > 74 ? `${headerTitle.slice(0, 71)}...` : headerTitle;
      p.drawText(truncatedTitle, {
        x: MARGIN_X,
        y: PAGE_H - 64,
        size: 15,
        font: fontBold,
        color: inkDark,
      });

      p.drawLine({
        start: { x: MARGIN_X, y: PAGE_H - 74 },
        end: { x: PAGE_W - MARGIN_X, y: PAGE_H - 74 },
        thickness: 1.2,
        color: blueInk,
      });

      // Footer page indicator
      p.drawText(`Solution Key Page ${keyPageIndex}`, {
        x: PAGE_W - MARGIN_X - 95,
        y: 26,
        size: 8.5,
        font: fontRegular,
        color: inkMuted,
      });

      return { page: p, cursorY: PAGE_H - 98 };
    };

    let { page: curPage, cursorY } = createSolutionPage();

    for (const item of activeKeyItems) {
      const label = sanitizePdfMathText(item.questionLabel || 'Question');
      const shortAns = sanitizePdfMathText(item.shortAnswer || '(No answer)');
      const detail = sanitizePdfMathText(item.detailedExplanation || 'No explanation provided.');

      const headerLine = `[Page ${item.pageNumber}]  ${label}`;
      const answerLines = wrapTextToWidth(`Final Answer: ${shortAns}`, fontBold, 10, CONTENT_W - 16);
      const detailLines = wrapTextToWidth(detail, fontRegular, 9.5, CONTENT_W - 8);

      const headerBlockHeight = 20 + answerLines.length * 14 + 8;

      // Start new page if header + first 2 lines of explanation won't fit
      if (cursorY - (headerBlockHeight + 32) < BOTTOM_MARGIN) {
        ({ page: curPage, cursorY } = createSolutionPage());
      }

      // Soft highlight bar for question + short answer
      const boxH = 18 + answerLines.length * 13.5 + 8;
      curPage.drawRectangle({
        x: MARGIN_X,
        y: cursorY - boxH + 10,
        width: CONTENT_W,
        height: boxH,
        color: badgeBg,
        borderColor: dividerColor,
        borderWidth: 0.75,
      });

      curPage.drawText(headerLine, {
        x: MARGIN_X + 10,
        y: cursorY - 4,
        size: 10.5,
        font: fontBold,
        color: inkDark,
      });

      let innerY = cursorY - 19;
      for (const aLine of answerLines) {
        curPage.drawText(aLine, {
          x: MARGIN_X + 10,
          y: innerY,
          size: 10,
          font: fontBold,
          color: blueInk,
        });
        innerY -= 13.5;
      }

      cursorY -= boxH + 8;

      // Detailed step-by-step explanation (paginates gracefully across pages)
      for (const dLine of detailLines) {
        if (cursorY < BOTTOM_MARGIN) {
          ({ page: curPage, cursorY } = createSolutionPage());
        }
        if (dLine) {
          curPage.drawText(dLine, {
            x: MARGIN_X + 4,
            y: cursorY,
            size: 9.5,
            font: fontRegular,
            color: inkDark,
          });
        }
        cursorY -= 13.5;
      }

      // Separator below each item
      cursorY -= 6;
      if (cursorY >= BOTTOM_MARGIN) {
        curPage.drawLine({
          start: { x: MARGIN_X, y: cursorY },
          end: { x: PAGE_W - MARGIN_X, y: cursorY },
          thickness: 0.6,
          color: dividerColor,
        });
      }
      cursorY -= 16;
    }
  }

  return pdfDoc.save();
}
