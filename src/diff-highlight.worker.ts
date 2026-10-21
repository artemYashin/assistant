import { highlightDiff } from "./diff-highlight.js";

self.onmessage = (event) => {
  self.postMessage(highlightDiff(event.data.file, event.data.language));
};
