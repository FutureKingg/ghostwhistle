import { LocalModerationAdapter, type ModerationDecision, type ModerationPort } from '@ghostwhistle/core';
import { postJson } from './http.js';

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

export class GeminiModerationAdapter implements ModerationPort {
  private readonly fetcher: typeof fetch;

  constructor(private readonly config: { apiKey: string; model: string; fetcher?: typeof fetch }) {
    if (!config.apiKey || !config.model) throw new Error('Gemini apiKey and model are required.');
    this.fetcher = config.fetcher ?? fetch;
  }

  async classify(text: string): Promise<ModerationDecision> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.model)}:generateContent`;
    const result = await postJson<GeminiResponse>(
      url,
      {
        systemInstruction: {
          parts: [
            {
              text: [
                "You are GhostWhistle's automatic abuse gate, not a truth judge and not a human reviewer.",
                'Return REJECT only for high-confidence submissions that are obvious direct abuse, spam, advertising, or an active first-person threat intended to cause harm.',
                'A report describing a threat received by the reporter, wrongdoing, a vulnerability, or harsh language quoted as evidence must be PASS.',
                'Use category report, abuse, spam, active-threat, or unclear. Use unclear and PASS when context is ambiguous.',
                'Return strict JSON with decision, category, reason. Keep reason short and do not repeat sensitive report details.',
              ].join(' '),
            },
          ],
        },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      },
      { 'x-goog-api-key': this.config.apiKey },
      this.fetcher,
    );
    const raw = result.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
    const parsed = JSON.parse(raw) as Partial<ModerationDecision>;
    if (
      !['PASS', 'REJECT'].includes(parsed.decision ?? '') ||
      !['report', 'abuse', 'spam', 'active-threat', 'unclear'].includes(parsed.category ?? '')
    ) {
      throw new Error('Gemini returned an invalid moderation decision.');
    }
    return { decision: parsed.decision!, category: parsed.category!, reason: String(parsed.reason ?? '') };
  }
}

/** Keeps a provider outage from blocking legitimate whistleblowing. */
export class FailSafeModerationAdapter implements ModerationPort {
  private readonly fallback = new LocalModerationAdapter();

  constructor(private readonly primary: ModerationPort) {}

  async classify(text: string): Promise<ModerationDecision> {
    try {
      return await this.primary.classify(text);
    } catch {
      return this.fallback.classify(text);
    }
  }
}
