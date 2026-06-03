import { GoogleGenAI } from "@google/genai";

export const EMBED_DIM = 768;
const EMBED_MODEL = "text-embedding-004";
const CHAT_MODEL = "gemini-2.5-flash";

export interface ChatMessage {
  role: "user" | "model";
  content: string;
}

export interface LLM {
  chat(opts: { system?: string; messages: ChatMessage[] }): Promise<string>;
  embed(opts: { texts: string[] }): Promise<number[][]>;
}

/** Format a number[] as a Postgres pgvector literal: "[0.1,0.2,...]". */
export function toPgVector(values: number[], expectedDim?: number): string {
  if (expectedDim != null && values.length !== expectedDim) {
    throw new Error(
      `Embedding dimension mismatch: got ${values.length}, expected ${expectedDim}`
    );
  }
  return `[${values.join(",")}]`;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2 ** i * 500));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("LLM call failed");
}

function geminiLLM(): LLM {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");
  const ai = new GoogleGenAI({ apiKey });

  return {
    async chat({ system, messages }) {
      const contents = messages.map((m) => ({
        role: m.role,
        parts: [{ text: m.content }],
      }));
      const res = await withRetry(() =>
        ai.models.generateContent({
          model: CHAT_MODEL,
          contents,
          ...(system ? { config: { systemInstruction: system } } : {}),
        })
      );
      return res.text ?? "";
    },
    async embed({ texts }) {
      const res = await withRetry(() =>
        ai.models.embedContent({
          model: EMBED_MODEL,
          contents: texts,
        })
      );
      return (res.embeddings ?? []).map((e) => e.values ?? []);
    },
  };
}

let _llm: LLM | null = null;

/** Lazily-constructed default LLM. Swap the factory here to change providers. */
export function getLLM(): LLM {
  if (!_llm) _llm = geminiLLM();
  return _llm;
}
