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

/** Summarize a transcript to HTML via the Anthropic Messages API. Throws on API error. */
export async function summarizeTranscript(anthropicKey: string, model: string, maxTokens: number, transcript: string): Promise<string> {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt(transcript) }] }),
  });
  if (!res.ok) throw new Error(`Anthropic summarize failed: HTTP ${res.status} — ${(await res.text()).slice(0, 300)}`);
  const j = (await res.json()) as { content?: Array<{ text?: string }> };
  const text = j.content?.map((c) => c.text ?? "").join("").trim();
  if (!text) throw new Error("Anthropic returned no summary text.");
  return text;
}
