import test from "node:test";
import assert from "node:assert/strict";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { rehypeReviewFormat, reviewText } from "../src/features/render-content/index.js";
import type { Root } from "hast";

test("optional review cards preserve prose, nested quotes and code; severity gets a badge", async () => {
  const pipeline = unified().use(remarkParse).use(remarkRehype).use(rehypeReviewFormat);
  const markdown = "Объяснение перед замечанием.\n\n> ### Проблема: потеря данных\n>\n> **Критичность:** высокая — записи пропадают.\n>\n> **Проблема:** описание.\n>\n> > Требование тикета\n>\n> **Предлагаемое решение:** сохранить.\n>\n> ```ts\n> save();\n> ```\n\nТекст после замечания.";
  const tree = await pipeline.run(pipeline.parse(markdown)) as Root;
  const elements = tree.children.filter((node: any) => node.type === "element") as any[];
  assert.deepEqual(elements.map(node => node.tagName), ["p", "section", "p"]);
  assert.deepEqual(elements[1].properties.className, ["review-finding"]);
  const serialized = JSON.stringify(tree);
  assert.match(serialized, /is-high/);
  assert.match(serialized, /blockquote/);
  assert.match(serialized, /language-ts/);
  assert.match(reviewText(tree), /Текст после замечания/);
});

test("ordinary ticket blockquotes stay quotes and inline severity works", async () => {
  const pipeline = unified().use(remarkParse).use(remarkRehype).use(rehypeReviewFormat);
  const tree = await pipeline.run(pipeline.parse("> Требование без заголовка\n\n**Критичность: очень низкая**"));
  const serialized = JSON.stringify(tree);
  assert.match(serialized, /blockquote/);
  assert.doesNotMatch(serialized, /review-finding/);
  assert.match(serialized, /is-minimal/);
});

test("ordinary finding headings and unbolded labels render cards without swallowing the conclusion", async () => {
  const pipeline = unified().use(remarkParse).use(remarkRehype).use(rehypeReviewFormat);
  const markdown = "Вступление.\n\n### Проблема: потеря данных\n\nКритичность: высокая\n\nПроблема: теряются записи.\n\nРешение: сохранить.\n\n```ts\nsave();\n```\n\n[Источник](https://example.test/code)\n\n### Улучшение: понятное имя\n\n**Критичность: очень низкая**\n\nОписание.\n\n## Итог\n\nСвободный текст.";
  const tree = await pipeline.run(pipeline.parse(markdown)) as Root;
  const elements = tree.children.filter(node => node.type === "element") as any[];
  assert.deepEqual(elements.map(node => node.tagName), ["p", "section", "section", "h2", "p"]);
  assert.match(JSON.stringify(elements[1]), /is-high/);
  assert.match(JSON.stringify(elements[1]), /language-ts/);
  assert.match(JSON.stringify(elements[1]), /https:\/\/example.test\/code/);
  assert.match(JSON.stringify(elements[2]), /is-minimal/);
  assert.doesNotMatch(reviewText(elements[2]), /Свободный текст/);
});

test("recommended prompt example renders severity, problem and solution labels and a fenced snippet", async () => {
  const { REVIEW_POLICY } = await import("../server/review-questions.js");
  const { reviewLabelKind } = await import("../src/features/render-content/index.js");
  const example = REVIEW_POLICY.slice(REVIEW_POLICY.indexOf("### Проблема: короткое название", REVIEW_POLICY.indexOf("Recommended Russian Markdown example")), REVIEW_POLICY.indexOf("Use actual verified values"));
  const pipeline = unified().use(remarkParse).use(remarkRehype).use(rehypeReviewFormat);
  const tree = await pipeline.run(pipeline.parse(example)) as Root;
  const serialized = JSON.stringify(tree);
  assert.match(serialized, /review-finding/);
  assert.match(serialized, /is-high/);
  assert.match(serialized, /language-ts/);
  assert.equal(reviewLabelKind("Критичность: высокая"), "severity");
  assert.equal(reviewLabelKind("Проблема:"), "problem");
  assert.equal(reviewLabelKind("Предлагаемое решение:"), "solution");
  assert.match(REVIEW_POLICY, /Markdown even when Git\/code tools are enabled/);
});

test("review prompt avoids nested quotation markup and a ticket quote renders only once", async () => {
  const { REVIEW_POLICY } = await import("../server/review-questions.js");
  assert.match(REVIEW_POLICY, /Never nest blockquotes/);
  assert.doesNotMatch(REVIEW_POLICY, /nested ticket quotes use >>|Prefix every line of that card/);
  const pipeline = unified().use(remarkParse).use(remarkRehype).use(rehypeReviewFormat);
  const markdown = "### Проблема: нарушено требование\n\n**Критичность: высокая**\n\n**Проблема:** данные не сохраняются.\n\n> Сохранять изменения автоматически.\n>\n> [Показать в тикете](https://example.test/ticket)\n\n**Предлагаемое решение:** сохранить изменения.\n\n### Улучшение: название\n\nОписание.";
  const tree = await pipeline.run(pipeline.parse(markdown)) as Root;
  let quotes = 0;
  const visit = (node: any, insideQuote = false) => {
    if (node.tagName === "blockquote") {
      assert.equal(insideQuote, false, "citation must not be nested in another quote");
      quotes++;
      insideQuote = true;
    }
    for (const child of node.children || []) visit(child, insideQuote);
  };
  visit(tree);
  assert.equal(quotes, 1);
  assert.equal(reviewText(tree).split("Сохранять изменения автоматически.").length - 1, 1);
  assert.match(JSON.stringify(tree), /https:\/\/example.test\/ticket/);
  assert.equal(tree.children.filter((n: any) => n.tagName === "section").length, 2);
});
