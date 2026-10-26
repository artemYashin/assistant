import { useCallback } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FolderSearch, FileText, LoaderCircle, Search, X } from "lucide-react";
import { apiProgress } from "../../../shared/api/http/index.js";
import { diffLanguage } from "../../../entities/repository/index.js";
import type { CodeToken } from "../../../entities/repository/highlight/index.js";
import { RepositoryFileIcon } from "../../../entities/repository/index.js";

type Hit = {
  path: string;
  line?: number;
  text?: string;
  context?: { number: number; text: string }[];
};
type Results = {
  results: Hit[];
  total: number;
  more: boolean;
  coverage?: { searchedFiles: number; skippedFiles: number };
  perFileLimit?: number;
};
type Task = { query: string; mode: string; version: number };
export function RepositorySearch({
  context,
  branch,
  revision,
  disabled,
  onOpen,
}: {
  context: { client: string; project: string };
  branch: string;
  revision: string;
  disabled: boolean;
  onOpen: (path: string, line?: number) => void;
}) {
  const [query, setQuery] = useState(""),
    [mode, setMode] = useState("name");
  const [open, setOpen] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const [results, setResults] = useState<Results | null>(null),
    [active, setActive] = useState(-1);
  const [position, setPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 300,
    transform: "none",
  });
  const anchor = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const version = useRef(0),
    running = useRef(false),
    pending = useRef<Task | null>(null),
    alive = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    controller = useRef<AbortController | null>(null);
  const cache = useRef(new Map<string, Results>()),
    id = useId();
  const hits = results?.results.slice(0, 50) || [];
  const [highlighted, setHighlighted] = useState<CodeToken[][][]>([]);
  useEffect(() => {
    setHighlighted([]);
    if (!results?.results.some((hit) => hit.context)) return;
    const worker = new Worker(
      new URL(
        "../../../entities/repository/workers/repository-search-highlight.worker.ts",
        import.meta.url,
      ),
      { type: "module" },
    );
    const timer = window.setTimeout(() => worker.terminate(), 4000);
    worker.onmessage = (event) => {
      setHighlighted(event.data);
      clearTimeout(timer);
      worker.terminate();
    };
    worker.postMessage(
      results.results.slice(0, 50).map((hit) => ({
        language: diffLanguage(hit.path),
        code: hit.context?.map((line) => line.text).join("\n") || "",
      })),
    );
    return () => {
      clearTimeout(timer);
      worker.terminate();
    };
  }, [results]);
  const visible = open && !!query.trim() && !disabled;
  const invalidateVersion = useCallback(() => {
    version.current++;
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      invalidateVersion();
      pending.current = null;
      clearTimeout(timer.current);
      controller.current?.abort();
    };
  }, [invalidateVersion]);
  // At most one request in flight. Typing replaces pending work rather than
  // filling the Git worker queue with obsolete autocomplete queries.
  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (pending.current && alive.current) {
        const task = pending.current;
        pending.current = null;
        const key = JSON.stringify([task.mode, task.query]);
        try {
          let data = cache.current.get(key);
          if (!data) {
            controller.current = new AbortController();
            data = (await apiProgress(
              "/code-browser",
              {
                client: context.client,
                project: context.project,
                branch,
                revision,
                operation: "search",
                query: task.query,
                mode: task.mode,
              },
              () => {},
              controller.current.signal,
            )) as Results;
            if (!alive.current) return;
            cache.current.set(key, data);
            if (cache.current.size > 10) cache.current.delete(cache.current.keys().next().value!);
          }
          if (alive.current && task.version === version.current) {
            setResults(data);
            setLoading(false);
            setActive(-1);
          }
        } catch (e: any) {
          if (alive.current && task.version === version.current) {
            setError(e.message);
            setLoading(false);
          }
        }
      }
    } finally {
      running.current = false;
    }
  }, [context.client, context.project, branch, revision]);
  function invalidate() {
    version.current++;
    pending.current = null;
    clearTimeout(timer.current);
    setResults(null);
    setError("");
    setActive(-1);
  }
  const schedule = useCallback(
    (immediate = false) => {
      clearTimeout(timer.current);
      if (disabled || !query.trim()) {
        setLoading(false);
        return;
      }
      setLoading(true);
      const task = { query: query.trim(), mode, version: version.current };
      timer.current = setTimeout(
        () => {
          pending.current = task;
          void drain();
        },
        immediate ? 0 : 600,
      );
    },
    [disabled, query, mode, drain],
  );
  useEffect(() => {
    schedule();
    return () => clearTimeout(timer.current);
  }, [schedule]);
  useEffect(() => {
    if (disabled) {
      invalidate();
      setLoading(false);
      setOpen(false);
    }
  }, [disabled]);
  useLayoutEffect(() => {
    if (!visible) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 12;
      const height = Math.max(100, Math.min(340, below >= 160 ? below : rect.top - 12));
      const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 24);
      setPosition({
        top: below >= 160 ? rect.bottom + 5 : rect.top - 5,
        transform: below >= 160 ? "none" : "translateY(-100%)",
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        width,
        maxHeight: height,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const observer = new ResizeObserver(place);
    if (anchor.current) observer.observe(anchor.current);
    const outside = (event: Event) => {
      if (
        !anchor.current?.contains(event.target as Node) &&
        !panel.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [visible]);
  useEffect(() => {
    if (active >= 0)
      panel.current
        ?.querySelector(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  function select(hit: Hit) {
    input.current?.focus();
    setOpen(false);
    onOpen(hit.path, hit.line);
  }
  return (
    <form
      className="repository-search"
      onSubmit={(e) => {
        e.preventDefault();
        setOpen(true);
        schedule(true);
      }}
    >
      <div className="repository-search-modes" role="group" aria-label="Режим поиска">
        <button
          type="button"
          aria-pressed={mode === "name"}
          onClick={() => {
            if (mode !== "name") {
              invalidate();
              setMode("name");
            }
            setOpen(true);
            input.current?.focus();
          }}
        >
          <FolderSearch size={13} aria-hidden="true" />
          По пути
        </button>
        <button
          type="button"
          aria-pressed={mode === "content"}
          onClick={() => {
            if (mode !== "content") {
              invalidate();
              setMode("content");
            }
            setOpen(true);
            input.current?.focus();
          }}
        >
          <FileText size={13} aria-hidden="true" />
          По содержимому
        </button>
      </div>
      <div className="repository-search-input" ref={anchor}>
        <Search size={14} aria-hidden="true" />
        <input
          ref={input}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={visible ? id : undefined}
          aria-activedescendant={visible && active >= 0 ? `${id}-${active}` : undefined}
          aria-label="Поиск в репозитории"
          placeholder={mode === "name" ? "Имя файла или путь…" : "Текст в коде…"}
          maxLength={200}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            invalidate();
            setQuery(e.target.value);
            setLoading(!!e.target.value.trim());
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              if (hits.length)
                setActive((n) =>
                  e.key === "ArrowDown" ? (n + 1) % hits.length : n <= 0 ? hits.length - 1 : n - 1,
                );
            }
            if (e.key === "Enter" && visible && active >= 0 && hits[active]) {
              e.preventDefault();
              select(hits[active]);
            }
          }}
        />
        {loading && <LoaderCircle size={14} className="spin" aria-label="Поиск" />}
        {query && (
          <button
            type="button"
            className="repository-search-clear"
            aria-label="Очистить поиск"
            onClick={() => {
              invalidate();
              setQuery("");
              setLoading(false);
              setOpen(false);
              input.current?.focus();
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {visible &&
        createPortal(
          <div
            className="repository-autocomplete"
            ref={panel}
            style={position}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                input.current?.focus();
                setOpen(false);
              }
            }}
          >
            <div className="repository-search-summary" role="status">
              {loading
                ? "Ищу в локальном снимке…"
                : error ||
                  (results
                    ? results.total
                      ? `Найдено: ${results.total}`
                      : "Совпадений нет"
                    : "Введите запрос")}
            </div>
            <div id={id} role="listbox" aria-label="Результаты поиска">
              {hits.map((hit, index) => {
                const slash = hit.path.lastIndexOf("/");
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={active === index}
                    id={`${id}-${index}`}
                    data-index={index}
                    key={`${hit.path}:${hit.line || 0}`}
                    className="repository-autocomplete-hit"
                    onMouseEnter={() => setActive(index)}
                    onClick={() => select(hit)}
                  >
                    <RepositoryFileIcon name={hit.path} />
                    <span className="repository-autocomplete-hit-body">
                      <span className="repository-autocomplete-name">
                        <strong>{hit.path.slice(slash + 1)}</strong>
                        {hit.line && <small>строка {hit.line}</small>}
                      </span>
                      {slash >= 0 && (
                        <span className="repository-autocomplete-path" title={hit.path}>
                          {hit.path.slice(0, slash)}
                        </span>
                      )}
                      {hit.context ? (
                        <span className="repository-search-code">
                          {hit.context.map((row, rowIndex) => (
                            <span
                              className="repository-search-code-line"
                              data-match={row.number === hit.line}
                              key={row.number}
                            >
                              <span className="repository-search-line-number">{row.number}</span>
                              <code>
                                {highlighted[index]?.[rowIndex]?.length
                                  ? highlighted[index][rowIndex].map((token, tokenIndex) => (
                                      <span className={token.className} key={tokenIndex}>
                                        {token.text}
                                      </span>
                                    ))
                                  : row.text || " "}
                              </code>
                            </span>
                          ))}
                        </span>
                      ) : (
                        hit.text !== undefined && <code>{hit.text.trim().slice(0, 220)}</code>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {!loading && results && (results.more || results.results.length > 50) && (
              <small className="repository-search-summary">
                Показаны первые {hits.length} результатов. Уточните запрос.
              </small>
            )}
            {results?.coverage && (
              <small className="repository-search-summary">
                Проверено файлов: {results.coverage.searchedFiles}; пропущено:{" "}
                {results.coverage.skippedFiles}. До {results.perFileLimit} совпадений на файл.
              </small>
            )}
          </div>,
          document.body,
        )}
    </form>
  );
}
