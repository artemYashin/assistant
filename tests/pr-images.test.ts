import test from "node:test";
import assert from "node:assert/strict";
import {
  azureImageUrl,
  descriptionImages,
  readAzureImage,
} from "../services/backend/src/pr-images.js";
const base = "https://dev.azure.com/org";
const attachment = `${base}/Project/_apis/wit/attachments/12345678-1234-1234-1234-123456789abc`;
const resolve = (url: string) =>
  azureImageUrl(url, base, `${base}/Project/_git/repo/pullrequest/1`, "repo", 1, "7.1");
test("extracts only Markdown images including references", () => {
  assert.deepEqual(
    descriptionImages(
      "![a](https://a.test/x)\n\n![b][ref]\n\n[ref]: /image.png\n\n[link](https://other.test)\n\n`![code](https://code.test)`\n\n<img src='https://html.test'>",
    ),
    ["https://a.test/x", "/image.png"],
  );
});
test("only Azure attachment endpoints from this collection are eligible for credentials", () => {
  assert.equal(resolve(attachment + "?download=true"), attachment + "?api-version=7.1");
  assert.ok(
    resolve("/org/Project/_apis/git/repositories/repo/pullRequests/1/attachments/test.png"),
  );
  assert.ok(resolve("/org/_apis/wit/attachments/12345678-1234-1234-1234-123456789abc"));
  for (const url of [
    attachment.replace("org/", "other/"),
    attachment.replace("dev.azure.com", "evil.test"),
    attachment.replace("https:", "http:"),
    "https://user:pass@dev.azure.com/org/Project/_apis/wit/attachments/12345678-1234-1234-1234-123456789abc",
    "/org/Project/_apis/git/repositories/other/pullRequests/1/attachments/test.png",
    "/org/Project/_apis/git/repositories/repo/pullRequests/2/attachments/test.png",
    "/org/Project/_apis/wit/workitems/42",
    "data:image/png;base64,AAAA",
    "file:///etc/passwd",
    "//evil.test/image.png",
  ])
    assert.equal(resolve(url), null, url);
});
test("image download uses GET without redirects and identifies binary content", async (t) => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  t.mock.method(globalThis, "fetch", async (_url: any, init: any) => {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from(":secret").toString("base64")}`);
    return new Response(png, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  });
  assert.equal((await readAzureImage(attachment, "secret")).type, "image/png");
});
test("HTML/SVG and oversized downloads cannot be served as images", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("<svg onload='alert(1)'/>", {
        headers: { "Content-Type": "image/png" },
      }),
  );
  await assert.rejects(readAzureImage(attachment, "secret"), /PNG/);
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(new Uint8Array(20 * 1024 * 1024 + 1)),
  );
  await assert.rejects(readAzureImage(attachment, "secret"), /20 МБ/);
});
