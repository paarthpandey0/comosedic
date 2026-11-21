export interface BrowserSpeechOptions {
  text: string;
  rate?: number;
  pitch?: number;
  lang?: string;
  speaker?: 'Alex' | 'Sam' | string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

const LANGUAGE_MAP: Record<string, string> = {
  english: 'en-US',
  french: 'fr-FR',
  spanish: 'es-ES',
  german: 'de-DE',
  italian: 'it-IT',
  portuguese: 'pt-BR',
  japanese: 'ja-JP',
  korean: 'ko-KR',
  chinese: 'zh-CN',
  mandarin: 'zh-CN',
  arabic: 'ar-SA',
  hindi: 'hi-IN',
  russian: 'ru-RU',
  dutch: 'nl-NL',
  swedish: 'sv-SE',
  turkish: 'tr-TR',
};

export function isBrowserSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function resolveLanguageCode(language?: string): string {
  if (!language) return 'en-US';
  const trimmed = language.trim();
  if (/^[a-z]{2}(-[A-Z]{2})?$/.test(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  for (const [key, code] of Object.entries(LANGUAGE_MAP)) {
    if (lower.includes(key)) return code;
  }
  return 'en-US';
}

function splitIntoSpeechChunks(text: string, maxLen = 220): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  if (normalized.length <= maxLen) return [normalized];

  const sentences = normalized.match(/[^.!?]+[.!?]*\s*/g) || [normalized];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if ((current + ' ' + piece).trim().length <= maxLen) {
      current = (current + ' ' + piece).trim();
    } else {
      if (current) chunks.push(current);
      if (piece.length <= maxLen) {
        current = piece;
      } else {
        // Hard-wrap overly long run-on sentences at word boundaries
        const words = piece.split(' ');
        let buf = '';
        for (const w of words) {
          if ((buf + ' ' + w).trim().length > maxLen) {
            if (buf) chunks.push(buf);
            buf = w;
          } else {
            buf = (buf + ' ' + w).trim();
          }
        }
        current = buf;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function pickVoice(langCode: string, speaker?: string): SpeechSynthesisVoice | null {
  if (!isBrowserSpeechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const prefix = langCode.split('-')[0].toLowerCase();
  const exactMatches = voices.filter((v) => v.lang.toLowerCase() === langCode.toLowerCase());
  const langMatches = exactMatches.length
    ? exactMatches
    : voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
  const pool = langMatches.length ? langMatches : voices;

  if (speaker === 'Sam' && pool.length > 1) {
    return pool[1];
  }
  return pool[0] || null;
}

export function stopBrowserSpeech(): void {
  if (isBrowserSpeechSupported()) {
    window.speechSynthesis.cancel();
  }
}

export function speakBrowserText(options: BrowserSpeechOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!isBrowserSpeechSupported()) {
      const msg = 'Browser speech synthesis is not supported in this browser.';
      options.onError?.(msg);
      reject(new Error(msg));
      return;
    }

    const chunks = splitIntoSpeechChunks(options.text);
    if (chunks.length === 0) {
      resolve();
      return;
    }

    window.speechSynthesis.cancel();

    const langCode = resolveLanguageCode(options.lang);
    const voice = pickVoice(langCode, options.speaker);
    const rate = Math.min(Math.max(options.rate ?? 1, 0.5), 2);
    const pitch =
      options.pitch ??
      (options.speaker === 'Alex' ? 1.04 : options.speaker === 'Sam' ? 0.94 : 1);

    let settled = false;
    let started = false;

    const speakChunk = (idx: number) => {
      if (settled) return;
      if (idx >= chunks.length) {
        settled = true;
        options.onEnd?.();
        resolve();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[idx]);
      utterance.lang = langCode;
      utterance.rate = rate;
      utterance.pitch = pitch;
      if (voice) utterance.voice = voice;

      utterance.onstart = () => {
        if (!started) {
          started = true;
          options.onStart?.();
        }
      };

      utterance.onend = () => {
        speakChunk(idx + 1);
      };

      utterance.onerror = (ev) => {
        if (settled) return;
        settled = true;
        // 'canceled' and 'interrupted' happen normally when user stops/restarts playback
        if (ev.error === 'canceled' || ev.error === 'interrupted') {
          options.onEnd?.();
          resolve();
          return;
        }
        const msg = `Speech playback error: ${ev.error || 'unknown error'}`;
        options.onError?.(msg);
        reject(new Error(msg));
      };

      window.speechSynthesis.speak(utterance);
    };

    speakChunk(0);
  });
}
