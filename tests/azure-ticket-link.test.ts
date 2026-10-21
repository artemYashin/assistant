import test from "node:test";
import assert from "node:assert/strict";
import { azureTicketPath, shareTicketUrl } from "../src/azure-ticket-link.js";

test("work item links are scoped to organization and project", () => {
  const source = "https://dev.azure.com/org|My Project";
  const local = azureTicketPath("https://dev.azure.com/org/My%20Project/_workitems/edit/42", source)!;
  assert.ok(local.startsWith("/tickets?id=42&source="));
  assert.equal(shareTicketUrl(local), "https://dev.azure.com/org/My%20Project/_workitems/edit/42");
  for (const url of [
    "https://dev.azure.com/other/My%20Project/_workitems/edit/42",
    "https://dev.azure.com/org/Other/_workitems/edit/42",
    "https://dev.azure.com/org/My%20Project/_git/repo/pullrequest/42",
    "https://dev.azure.com/org/My%20Project/_workitems/edit/42extra",
  ]) assert.equal(azureTicketPath(url, source), null);
  assert.equal(shareTicketUrl("https://figma.com/file/abc"), "https://figma.com/file/abc");
});
