import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { RepositoryFileIcon } from "./RepositoryFileKind.js";
import { diffFileSize, splitDiff } from "./pr-diff.js";

type Node = { name: string; path: string; children: Map<string, Node>; index?: number };
export function buildDiffTree(files: ReturnType<typeof splitDiff>) {
  const root: Node = { name: "", path: "", children: new Map() };
  files.forEach((file, index) => {
    const parts = (file.after === "/dev/null" ? file.before : file.after || file.before).split("/").filter(Boolean);
    let node = root;
    parts.forEach(name => {
      if (!node.children.has(name)) node.children.set(name, { name, path: `${node.path}/${name}`, children: new Map() });
      node = node.children.get(name)!;
    });
    node.index = index;
  });
  return root;
}
export function DiffFileTree({ files, selected, onSelect, sizes }: {
  files: ReturnType<typeof splitDiff>; selected: number; onSelect: (index: number) => void;
  sizes?: { path: string; sizeBytes?: number }[];
}) {
  const tooltipId = useId();
  const [hint, setHint] = useState<{ text: string; left: number; top: number } | null>(null);
  const showHint = (element: HTMLElement, text: string) => {
    const rect = element.getBoundingClientRect();
    setHint({ text, left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)), top: Math.min(rect.bottom + 5, window.innerHeight - 90) });
  };
  const tree = useMemo(() => buildDiffTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  useEffect(() => { setCollapsed(new Set()); }, [tree]);
  useEffect(() => {
    const file = files[selected];
    if (!file) return;
    const path = file.after === "/dev/null" ? file.before : file.after;
    setCollapsed(previous => new Set([...previous].filter(folder => !(`/${path.replace(/^\//, "")}`).startsWith(folder + "/"))));
  }, [selected, files]);
  function render(node: Node, depth: number): React.ReactNode {
    return [...node.children.values()].sort((a, b) => Number(b.children.size > 0) - Number(a.children.size > 0) || a.name.localeCompare(b.name)).map(child => {
      const directory = child.children.size > 0;
      const file = child.index === undefined ? undefined : files[child.index];
      const status = !file ? "" : file.before === "/dev/null" ? "added" : file.after === "/dev/null" ? "deleted" : file.before !== file.after ? "renamed" : "modified";
      const label = { "": "", added: "Добавлен", deleted: "Удалён", modified: "Изменён", renamed: "Переименован" }[status] || "";
      const open = !collapsed.has(child.path);
      const size = sizes?.find(item => item.path === (file?.after === "/dev/null" ? file.before : file?.after))?.sizeBytes;
      return <div key={child.path}>
        <button type="button" className={`diff-tree-row is-${status || "folder"}`}
          aria-expanded={directory ? open : undefined} aria-pressed={directory ? undefined : child.index === selected}
          aria-describedby={hint ? tooltipId : undefined}
          onMouseEnter={event => showHint(event.currentTarget, file && status === "renamed" ? `${file.before} → ${file.after}` : child.path)}
          onFocus={event => showHint(event.currentTarget, file && status === "renamed" ? `${file.before} → ${file.after}` : child.path)}
          onMouseLeave={() => setHint(null)} onBlur={() => setHint(null)}
          onClick={() => directory ? setCollapsed(previous => { const next = new Set(previous); if (next.has(child.path)) next.delete(child.path); else next.add(child.path); return next; }) : onSelect(child.index!)}>
          <span className="diff-tree-status" title={label} aria-label={label || undefined}>{status === "added" ? "+" : status === "deleted" ? "−" : status === "renamed" ? "R" : status === "modified" ? "M" : ""}</span>
          <span className="diff-tree-toggle" style={{ marginLeft: depth * 14 }}>{directory && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}</span>
          <RepositoryFileIcon name={child.name} type={directory ? "directory" : "file"} size={15} />
          <span className="diff-tree-name">{child.name}</span>
          {file && <span className="diff-tree-counts"><span className="pr-diff-file-size">{diffFileSize(size)}</span><span className="pr-diff-added">+{file.added}</span><span className="pr-diff-removed">−{file.removed}</span></span>}
        </button>
        {directory && open && render(child, depth + 1)}
      </div>;
    });
  }
  return <nav className="pr-diff-files diff-file-tree" aria-label="Файлы изменений" onScroll={() => setHint(null)}>{render(tree, 0)}{hint && <div role="tooltip" id={tooltipId} className="diff-file-tooltip" style={{ left: hint.left, top: hint.top }}>{hint.text}</div>}</nav>;
}
