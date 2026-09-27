// QVAC Paragraph Shortener — core logic.
// completion() writes a short summary of the pasted paragraph, grounded to
// only what's stated in the source text (no invented facts).

import { completion } from "@qvac/sdk";

function looksUnusable(text) {
  if (!text || text.trim().length === 0) return true;
  const bad = ["i cannot", "i can't", "as an ai", "i'm not able", "i am not able"];
  const lower = text.toLowerCase();
  return bad.some((phrase) => lower.includes(phrase));
}

function stripPreamble(text) {
  return text
    .trim()
    .replace(/^(here'?s|here is)[^:\n]*:\s*/i, "")
    .replace(/^summary:\s*/i, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

// Deterministic fallback: first sentence(s) of the original text, truncated.
function extractiveFallback(text) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let out = sentences[0].trim();
  if (out.length < 40 && sentences[1]) out += " " + sentences[1].trim();
  if (out.length > 400) out = out.slice(0, 397).trim() + "...";
  return out;
}

const NUMBER_WORDS = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7",
  eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13",
  fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18",
  nineteen: "19", twenty: "20", thirty: "30", forty: "40", fifty: "50",
  sixty: "60", seventy: "70", eighty: "80", ninety: "90", hundred: "100",
  thousand: "1000", million: "1000000", billion: "1000000000",
};

// Light grounding guard: if the summary introduces a 3+ digit number that
// never appears anywhere in the source text (as digits OR spelled out), it's
// likely a hallucinated fact, so fall back to the extractive summary instead.
// 1-2 digit numbers are exempt since the model legitimately converts spelled-
// out numbers ("fifteen percent" -> "15%") which would otherwise false-positive.
function hasInventedNumbers(summary, source) {
  const sourceLower = source.toLowerCase();
  const sourceDigitEquivalents = new Set();
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    if (sourceLower.includes(word)) sourceDigitEquivalents.add(digit);
  }
  const summaryNums = summary.match(/\b\d{3,}\b/g) || [];
  for (const n of summaryNums) {
    if (!source.includes(n) && !sourceDigitEquivalents.has(n)) return true;
  }
  return false;
}

function capWords(text, maxWords) {
  const words = text.split(/\s+/);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ").replace(/[,;:]$/, "") + "...";
}

export async function shorten(modelId, text) {
  const source = text.slice(0, 6000); // keep prompt bounded
  const originalWords = source.trim().split(/\s+/).length;
  // The prompt alone is not reliably obeyed by a small on-device model (it
  // tends to barely trim long, well-organized paragraphs), so a concrete
  // target length is computed and then hard-enforced in code afterward.
  const targetWords = Math.max(20, Math.min(80, Math.ceil(originalWords * 0.4)));

  const run = completion({
    modelId,
    history: [
      {
        role: "system",
        content:
          `Condense the given text into a much shorter summary of about ${targetWords} words ` +
          "(no more than 3 sentences). Cut it down aggressively — keep only the single most " +
          "important point and any critical numbers, drop all secondary details and examples. " +
          "Use ONLY facts, names, and numbers that appear in the given text. Never add outside " +
          "information or opinions. Reply with ONLY the summary paragraph, no preamble, no labels.",
      },
      { role: "user", content: source },
    ],
    stream: true,
    completionOpts: { temperature: 0.4, maxTokens: Math.min(160, targetWords * 2) },
  });

  let raw = "";
  for await (const token of run.tokenStream) raw += token;
  let summary = stripPreamble(raw);
  summary = capWords(summary, targetWords);

  const useExtractive =
    looksUnusable(summary) || hasInventedNumbers(summary, source);
  const finalSummary = useExtractive ? extractiveFallback(source) : summary;

  const summaryWords = finalSummary.trim().split(/\s+/).length;

  return {
    summary: finalSummary,
    originalWords,
    summaryWords,
    fallbackUsed: useExtractive,
  };
}
