import { FeedbackError, messageOf, safeBodyText } from "./errors";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

function prompt(transcript: string): string {
  return [
    "Summarize this screen-recording feedback transcript for a developer's task.",
    "Return concise HTML using <p>, <strong>, <ul>, <li> only (no <html>/<body>).",
    "Lead with a one-line summary, then bullet the concrete issues/requests.",
    "",
    "Transcript:",
    transcript.slice(0, 20000),
  ].join("\n");
}

/**
 * Summarize a transcript to HTML via the Anthropic Messages API.
 *
 * Throws {@link FeedbackError}. A 401 (bad key) or 400 (bad model name) is marked
 * non-retryable so a poller gives up at once; 429 and 5xx stay retryable, which is
 * the whole point of separating them.
 */
export async function summarizeTranscript(anthropicKey: string, model: string, maxTokens: number, transcript: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt(transcript) }] }),
    });
  } catch (err) {
    throw new FeedbackError({ step: "anthropic.summarize", message: `Anthropic summarize could not reach the API: ${messageOf(err)}`, cause: err });
  }

  if (!res.ok) {
    const body = await safeBodyText(res);
    throw new FeedbackError({
      step: "anthropic.summarize",
      message: `Anthropic summarize failed: HTTP ${res.status} — ${body}`,
      httpStatus: res.status,
      responseBody: body,
    });
  }

  let j: { content?: Array<{ text?: string }> };
  try {
    j = (await res.json()) as typeof j;
  } catch (err) {
    throw new FeedbackError({ step: "anthropic.summarize", message: `Anthropic returned unparseable JSON: ${messageOf(err)}`, httpStatus: res.status, cause: err });
  }

  const text = j.content?.map((c) => c.text ?? "").join("").trim();
  // An empty completion is a model hiccup, not a config error — worth one more go.
  if (!text) throw new FeedbackError({ step: "anthropic.summarize", message: "Anthropic returned no summary text.", retryable: true });
  return text;
}
