export type ChatMessageContext = {
  kind: "analyze_ticket" | "viewed_ticket" | "refine_memory" | "file";
  number?: number;
  mime?: string;
  id: string | number;
  title?: string;
  source?: string;
  savedMemory?: boolean;
};

export function messageContextBadges(input: {
  files?: { id: string; name: string; mime: string }[];
  analysis?: { id: number; title?: string; source: string } | null;
  viewed?: { id: number; source: string } | null;
  proposal?: {
    id: string;
    summary?: string;
    target_memory_id?: string | null;
  } | null;
}): ChatMessageContext[] {
  const badges: ChatMessageContext[] = [];
  if (input.analysis)
    badges.push({
      kind: "analyze_ticket",
      id: input.analysis.id,
      source: input.analysis.source,
      title: input.analysis.title?.slice(0, 300),
    });
  if (input.proposal)
    badges.push({
      kind: "refine_memory",
      id: input.proposal.id,
      title: input.proposal.summary?.slice(0, 300),
      savedMemory: !!input.proposal.target_memory_id,
    });
  if (
    input.viewed &&
    !(
      input.analysis?.id === input.viewed.id &&
      input.analysis.source === input.viewed.source
    )
  )
    badges.push({
      kind: "viewed_ticket",
      id: input.viewed.id,
      source: input.viewed.source,
    });
  input.files?.forEach((file, index) =>
    badges.push({
      kind: "file",
      id: file.id,
      title: file.name,
      mime: file.mime,
      number: index + 1,
    }),
  );
  return badges;
}
