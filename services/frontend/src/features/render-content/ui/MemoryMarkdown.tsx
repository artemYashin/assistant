import { MarkdownCodeBlock } from "../../../entities/repository/snippet/index.js";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MemoryMarkdown({ body }: { body: string }) {
  return (
    <div className="memory-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          pre: MarkdownCodeBlock,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {body}
      </Markdown>
    </div>
  );
}
