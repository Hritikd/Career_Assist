const SARVAM_URL = "https://api.sarvam.ai/v1/chat/completions";
const STT_URL = "https://api.sarvam.ai/speech-to-text";

export class SarvamError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "sarvam_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getKey(): string {
  const key = process.env.SARVAM_API_KEY;
  if (!key) {
    throw new SarvamError(
      "SARVAM_API_KEY is not configured on the server.",
      503,
      "missing_key"
    );
  }
  return key;
}

export async function chatCompletion(opts: {
  system: string;
  messages: { role: "user" | "assistant" | "system"; content: string }[];
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  timeoutMs?: number;
}): Promise<string> {
  const key = getKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 28000);

  try {
    const body: Record<string, unknown> = {
      model: "sarvam-105b",
      messages: [
        { role: "system", content: opts.system },
        ...opts.messages,
      ],
      max_tokens: opts.maxTokens ?? 700,
      temperature: opts.temperature ?? 0.4,
      reasoning_effort: null,
    };
    if (opts.json) {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(SARVAM_URL, {
      method: "POST",
      headers: {
        "api-subscription-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string | null } }[];
      error?: { message?: string; code?: string };
    };

    if (!res.ok) {
      const msg =
        data.error?.message ||
        (res.status === 403
          ? "Sarvam authorization failed."
          : res.status === 429
            ? "Sarvam rate limit reached. Please retry shortly."
            : `Sarvam request failed (${res.status}).`);
      throw new SarvamError(msg, res.status, data.error?.code || "http_error");
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      throw new SarvamError(
        "Sarvam returned an empty response. Please retry.",
        502,
        "empty_response"
      );
    }
    return content.trim();
  } catch (err) {
    if (err instanceof SarvamError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new SarvamError(
        "The coaching request timed out. Please retry.",
        504,
        "timeout"
      );
    }
    throw new SarvamError(
      "Could not reach Sarvam. Please retry.",
      502,
      "network_error"
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function transcribeAudio(file: File | Blob, filename: string) {
  const key = getKey();
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", "saaras:v4");
  form.append("mode", "transcribe");
  form.append("language_code", "unknown");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(STT_URL, {
      method: "POST",
      headers: { "api-subscription-key": key },
      body: form,
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      transcript?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new SarvamError(
        data.error?.message || `Transcription failed (${res.status}).`,
        res.status
      );
    }
    if (!data.transcript) {
      throw new SarvamError("No transcript returned.", 502, "empty_transcript");
    }
    return data.transcript.trim();
  } catch (err) {
    if (err instanceof SarvamError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new SarvamError("Transcription timed out.", 504, "timeout");
    }
    throw new SarvamError("Could not transcribe audio.", 502, "network_error");
  } finally {
    clearTimeout(timeout);
  }
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("invalid_json");
  }
}

export function quoteExists(answer: string, quote: string | null | undefined): string | null {
  if (!quote) return null;
  const q = quote.trim();
  if (!q || q.length < 3) return null;
  if (!answer.includes(q)) return null;
  return q;
}

export function clampText(input: unknown, max = 4000): string {
  if (typeof input !== "string") return "";
  return input.slice(0, max);
}
