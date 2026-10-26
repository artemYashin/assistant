import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { highlightSnippet } from "../lib/diff-highlight.js";

export function ChatCodeSnippet({ text, language }: { text: string; language: string }) {
  const [status, setStatus] = useState("");
  const lines = useMemo(
    () => highlightSnippet(text.replace(/\n$/, ""), language),
    [text, language],
  );
  return (
    <section className="chat-code-snippet">
      <header>
        <span>{language || "Код"}</span>
        <button
          type="button"
          title="Скопировать код"
          aria-label="Скопировать код"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setStatus("Скопировано");
            } catch {
              setStatus("Не удалось скопировать");
            }
          }}
        >
          {status === "Скопировано" ? <Check size={13} /> : <Copy size={13} />}
          <span role="status">{status || "Копировать"}</span>
        </button>
      </header>
      <pre>
        <code>
          {lines.map((line, index) => (
            <span className="chat-code-line" key={index}>
              <span className="chat-code-line-number" aria-hidden="true">
                {index + 1}
              </span>
              <span>
                {line.length
                  ? line.map((token, tokenIndex) => (
                      <span className={token.className || undefined} key={tokenIndex}>
                        {token.text}
                      </span>
                    ))
                  : " "}
              </span>
              {index < lines.length - 1 ? "\n" : ""}
            </span>
          ))}
        </code>
      </pre>
    </section>
  );
}
