import { highlightLines } from "../lib/diff-highlight.js";
self.onmessage = (event: MessageEvent<{ code: string; language: string }[]>) => {
  self.postMessage(event.data.map(({ code, language }) => {
    try { return language === "plaintext" ? [] : highlightLines(code, language); }
    catch { return []; }
  }));
};
