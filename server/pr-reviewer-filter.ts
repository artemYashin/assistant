import { z } from "zod";
const person = z
  .object({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(300),
    email: z.string().max(300).default(""),
  })
  .strict();
export const reviewerFilterSchema = z
  .object({
    required: z.array(person).max(50),
    optional: z.array(person).max(50),
    createdBy: z.array(person).max(50).optional(),
  })
  .strict();
export type ReviewerFilter = z.infer<typeof reviewerFilterSchema>;
export function reviewerFilter(
  raw?: string | null,
): ReviewerFilter & { createdBy: NonNullable<ReviewerFilter["createdBy"]> } {
  const filter = raw
    ? reviewerFilterSchema.parse(JSON.parse(raw))
    : { required: [], optional: [] };
  // Legacy synthetic PAT-owner entries are no longer selectable or matched.
  return {
    required: filter.required.filter((p) => p.id !== "$self"),
    optional: filter.optional.filter((p) => p.id !== "$self"),
    createdBy: (filter.createdBy || []).filter((p) => p.id !== "$self"),
  };
}
export function matchesReviewers(
  pr: any,
  m: { mode: string; reviewer_filter?: string | null },
) {
  if (m.mode === "all") return true;
  const filter = reviewerFilter(m.reviewer_filter);
  if (
    typeof pr.createdBy?.id === "string" &&
    filter.createdBy.some(
      (p) => p.id.toLowerCase() === pr.createdBy.id.toLowerCase(),
    )
  )
    return true;
  return (pr.reviewers || []).some(
    (r: any) =>
      !r.isContainer &&
      typeof r.id === "string" &&
      (r.isRequired === true ? filter.required : filter.optional).some(
        (p) => p.id.toLowerCase() === r.id.toLowerCase(),
      ),
  );
}
