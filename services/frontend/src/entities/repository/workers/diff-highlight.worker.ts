import { highlightDiff } from "../lib/diff-highlight.js";

self.onmessage = (event) => {
  self.postMessage(highlightDiff(event.data.file, event.data.language));
};
