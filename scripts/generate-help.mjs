import ts from "typescript";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const generated = join(root, "docs/help/generated");
mkdirSync(generated, { recursive: true });
const outputs = new Map();
const coverage = {};
const scan = dir => readdirSync(join(root, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? scan(dir + "/" + e.name) : [dir + "/" + e.name]);
const paths = ["server", "src", "code-browser", "voice"].flatMap(scan)
  .filter(p => /\.(tsx?|mjs|py)$/.test(p) && !/\.test\.|\/test_|__pycache__/.test(p)).sort();
const norm = text => text.replace(/\s+/g, " ").trim();
const errorWords = /ошиб|не удалось|некоррект|недоступ|не найден|не найдена|не найдено|превыш|ист[её]к|остановлен|отмен[её]н|заблокир|недостаточ|не подключ|не настро|повторите|проверьте|лимит|тайм.?аут|error|failed|timeout|not found|invalid|unavailable|denied/i;
function strings(node) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map(s => "{…}" + s.literal.text).join("");
  if (ts.isConditionalExpression(node)) return strings(node.whenTrue) + " / " + strings(node.whenFalse);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return strings(node.left) + strings(node.right);
  if (ts.isJsxExpression(node)) return node.expression ? strings(node.expression) : "";
  if (ts.isJsxText(node)) return norm(node.text);
  if (ts.isJsxElement(node)) return node.children.map(strings).filter(Boolean).join(" ");
  return "";
}
for (const path of paths) {
  const source = readFileSync(join(root, path), "utf8");
  coverage[path] = createHash("sha256").update(source).digest("hex");
  const errors = new Map(), controls = new Map();
  if (path.endsWith(".py")) {
    source.split("\n").forEach((line, index) => {
      if (/raise HTTPException|raise RecognitionFailure/.test(line)) errors.set(line.trim(), index + 1);
    });
  } else {
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const record = (map, text, node) => { text = norm(text); if (text && !map.has(text)) map.set(text, file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1); };
    const visit = node => {
      if ((ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) && strings(node).length >= 10 && strings(node).length <= 1500 && !/^([.][.]?\/|SELECT |INSERT |UPDATE |CREATE |DELETE |ALTER )/i.test(strings(node)) && !(ts.isPropertyAssignment(node.parent) && node.parent.name.getText(file) === "description") && errorWords.test(strings(node)))
        record(errors, strings(node), node);
      if (ts.isNewExpression(node) && /Error$/.test(node.expression.getText(file))) {
        for (const arg of node.arguments || []) { const value = strings(arg); if (value) record(errors, value, node); }
      }
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        const opening = ts.isJsxElement(node) ? node.openingElement : node;
        const tag = opening.tagName.getText(file);
        if (/^(button|input|NumberInput|textarea|select|summary|label|option|a|Link|NavLink|Field|SingleSelect|MultiSelect|ConfirmButton|PrInfoPopup|TicketCopyButton|ModelOverride|VoiceBinding|ContextSaveButton)$/.test(tag)) {
          const attrs = opening.attributes.properties.filter(ts.isJsxAttribute)
            .filter(a => /^(aria-label|label|title|placeholder|message|confirmLabel|hint)$/.test(a.name.getText(file)))
            .map(a => a.initializer ? strings(a.initializer) : "").filter(Boolean);
          const children = ts.isJsxElement(node) ? node.children.map(strings).filter(Boolean) : [];
          if (attrs.length || children.length) record(controls, [...new Set([...attrs, ...children])].join(" · "), node);
        }
      }
      if (ts.isPropertyAssignment(node) && node.name.getText(file) === "label") record(controls, strings(node.initializer), node);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  const slug = path.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  for (const [kind, entries] of [["errors", errors], ["controls", controls]]) {
    if (!entries.size || (kind === "controls" && !path.startsWith("src/"))) continue;
    const list = [...entries].sort((a, b) => a[1] - b[1]);
    for (let start = 0; start < list.length; start += 20) {
      const part = Math.floor(start / 20) + 1;
      const id = kind + "-" + slug + "-" + part;
      const title = (kind === "errors" ? "Сообщения и ограничения" : "Элементы интерфейса") + ": " + path.split("/").pop() + " · " + part;
      const summary = kind === "errors" ? "Точные сообщения и шаблоны из кода. Причину определяйте по операции и статье «Ошибки: диагностика»." : "Указатель подписей кнопок, полей и подсказок. Условия видимости и процессы описаны в тематических статьях.";
      const meta = { id, title, summary, keywords: [kind === "errors" ? "ошибка" : "кнопка", path.split("/").pop()] };
      const body = list.slice(start, start + 20).map(([text, line]) => "### " + (kind === "errors" ? "Сообщение" : "Элемент") + "\n\n" + text + "\n\nИсточник: " + path + ":" + line + ".").join("\n\n");
      outputs.set(id + ".md", "<!-- orbit-help " + JSON.stringify(meta) + " -->\n# " + title + "\n\n" + summary + "\n\nАвтоматический указатель, не инструкция к выполнению. {…} обозначает динамическое значение. Наличие текста в коде не доказывает причину ошибки и не означает, что элемент всегда виден. Подробности: статья errors-troubleshooting; для действий — тематическая статья.\n\n" + body + "\n");
    }
  }
}
const stale = readdirSync(generated).filter(name => name.endsWith(".md") && !outputs.has(name));
let mismatch = false;
for (const [name, text] of outputs) {
  let previous; try { previous = readFileSync(join(generated, name), "utf8"); } catch {}
  if (previous !== text) { mismatch = true; if (!check) writeFileSync(join(generated, name), text); }
}
if (stale.length) mismatch = true;
if (!check) stale.forEach(name => unlinkSync(join(generated, name)));
const coveragePath = join(root, "docs/help/coverage.json");
const coverageText = JSON.stringify({ note: "Source fingerprints for help maintenance. Regeneration does not replace review of authored articles.", files: coverage }, null, 2) + "\n";
let oldCoverage; try { oldCoverage = readFileSync(coveragePath, "utf8"); } catch {}
if (oldCoverage !== coverageText) { mismatch = true; if (!check) writeFileSync(coveragePath, coverageText); }
console.log(outputs.size + " generated help articles; " + paths.length + " source files covered.");
if (check && mismatch) { console.error("Help inventory is stale. Review authored articles, then run npm run docs:generate."); process.exitCode = 1; }
