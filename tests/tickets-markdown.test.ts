import test from "node:test";
import assert from "node:assert/strict";
import { ticketsMarkdown } from "../src/features/export-tickets/index.js";
test("Markdown uses export columns and row order without spreadsheet formula prefixes", () => {
 assert.equal(ticketsMarkdown([{id:42,title:'First',azurePriority:0},{id:7,title:'=1+1'}], ['title','id','azurePriority']),
 '| Title | ID | Azure Priority |\n| --- | --- | --- |\n| First | 42 | 0 |\n| =1+1 | 7 |  |');
 assert.equal(ticketsMarkdown([], ['id']), '');
 assert.equal(ticketsMarkdown([{id:1}], []), '');
});
test("Markdown escapes cell delimiters, links, formatting and HTML while retaining line breaks", () => {
 const result=ticketsMarkdown([{id:1,title:'A|B\\C\r\n**bold**\n[x](url)<img>&', notes:'one\rtwo'}], ['title','notes']);
 assert.ok(result.includes('A\\|B\\\\C<br>\\*\\*bold\\*\\*<br>\\[x\\]\\(url\\)&lt;img&gt;&amp;'));
 assert.ok(result.includes('one<br>two'));
 assert.equal(result.split('\n').length,3);
});
