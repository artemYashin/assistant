import { z } from "zod";
const person = z.object({ id: z.string().trim().min(1).max(200), name: z.string().trim().min(1).max(300), email: z.string().max(300).default("") }).strict();
export const reviewerFilterSchema = z.object({ required: z.array(person).max(50), optional: z.array(person).max(50) }).strict();
export type ReviewerFilter = z.infer<typeof reviewerFilterSchema>;
export function reviewerFilter(raw?: string | null): ReviewerFilter {
  return raw ? reviewerFilterSchema.parse(JSON.parse(raw)) : { required: [{ id: "$self", name: "Вы (владелец PAT)", email: "" }], optional: [] };
}
export function needsReviewerIdentity(m: { mode: string; reviewer_filter?: string | null }) {
  return m.mode !== "all" && [...reviewerFilter(m.reviewer_filter).required, ...reviewerFilter(m.reviewer_filter).optional].some(p => p.id === "$self");
}
export function matchesReviewers(pr: any, m: { mode: string; reviewer_filter?: string | null }, me = "") {
  if (m.mode === "all") return true;
  const filter = reviewerFilter(m.reviewer_filter);
  return (pr.reviewers || []).some((r: any) => !r.isContainer && typeof r.id === "string" &&
    (r.isRequired === true ? filter.required : filter.optional).some(p => {
      const id = p.id === "$self" ? me : p.id;
      return !!id && id.toLowerCase() === r.id.toLowerCase();
    }));
}
