import { highlightLines } from "../lib/diff-highlight.js";
self.onmessage = (event: MessageEvent<{ code: string; language: string }>) => {
  try {
    self.postMessage(highlightLines(event.data.code, event.data.language));
  } catch {
    self.postMessage([]);
  }
};
