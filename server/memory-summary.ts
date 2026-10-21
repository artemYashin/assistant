import { z } from "zod";
const sentenceCount = (text: string) => [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)].filter(item => item.segment.trim()).length;
export const memorySummarySchema = z.string().trim().min(1).max(320).refine(text => !/[\r\n]/.test(text) && sentenceCount(text) <= 2, "Краткое описание: одно-два предложения в одной строке, до 320 символов");
export function legacyMemorySummary(body: string) {
  const text = body.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ").replace(/[#*`>|]/g, "").replace(/\s+/g, " ").trim();
  const sentences = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(text)].slice(0, 2).map(item => item.segment).join("").trim();
  return (sentences || "Saved memory with code example").slice(0, 320);
}
