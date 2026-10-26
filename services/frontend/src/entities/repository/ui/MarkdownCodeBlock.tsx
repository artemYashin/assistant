import type { Components } from "react-markdown";
import { ChatCodeSnippet } from "./ChatCodeSnippet.js";

export const MarkdownCodeBlock: NonNullable<Components["pre"]> = ({ node, children }) => {
  const code = node?.children.find((child) => child.type === "element" && child.tagName === "code");
  if (code?.type !== "element") return <pre>{children}</pre>;
  const text = code.children.map((child) => (child.type === "text" ? child.value : "")).join("");
  const classes = code.properties?.className;
  const language =
    (Array.isArray(classes) ? classes.map(String) : String(classes || "").split(/\s+/))
      .find((value) => value.startsWith("language-"))
      ?.slice(9) || "";
  return <ChatCodeSnippet text={text} language={language} />;
};
