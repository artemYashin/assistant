import { useEffect, useRef, useState } from "react";
import { Code2, GitCommitHorizontal } from "lucide-react";
import { api } from "../../../shared/api/http/index.js";
type Count = { value?: number; complete?: boolean; error?: string };
export function PrChangeButtons({
  pr,
  onDiff,
  onCommits,
}: {
  pr: any;
  onDiff: () => void;
  onCommits: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [counts, setCounts] = useState<{ files: Count; commits: Count } | null>(null);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    setCounts(null);
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        api(
          `/pr/counts?${new URLSearchParams({ monitor: pr.monitor, repo: pr.repo, number: String(pr.number) })}`,
          "GET",
          undefined,
          controller.signal,
        )
          .then((value) => {
            if (live) setCounts(value);
          })
          .catch((error) => {
            if (live)
              setCounts({ files: { error: error.message }, commits: { error: error.message } });
          });
      },
      { rootMargin: "100px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => {
      live = false;
      observer.disconnect();
      controller.abort();
    };
  }, [pr.monitor, pr.repo, pr.number, pr.head, pr.target, pr.synced_at]);
  const badge = (count: Count | undefined, label: string) => (
    <span
      className="pr-action-count"
      aria-label={`${label}: ${count?.value === undefined ? "не загружено" : (count.complete ? "" : "не менее ") + count.value}`}
      title={
        count?.error ||
        (count?.value === undefined
          ? "Загрузка количества…"
          : `${label}: ${count.complete ? "" : "не менее "}${count.value}`)
      }
    >
      {count?.value === undefined
        ? count?.error
          ? "—"
          : "…"
        : `${count.value}${count.complete ? "" : "+"}`}
    </span>
  );
  return (
    <>
      <button ref={ref} type="button" className="secondary pr-diff-action" onClick={onDiff}>
        <Code2 size={17} aria-hidden="true" /> View Diff {badge(counts?.files, "Изменённых файлов")}
      </button>
      <button type="button" className="secondary" onClick={onCommits}>
        <GitCommitHorizontal size={17} aria-hidden="true" /> Коммиты{" "}
        {badge(counts?.commits, "Коммитов")}
      </button>
    </>
  );
}
