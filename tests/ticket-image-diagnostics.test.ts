import test from "node:test";
import assert from "node:assert/strict";
import { ticketImagePreview } from "../services/frontend/src/features/render-content/lib/ticket-image-preview.js";

const id = "11111111-1111-1111-1111-111111111111";
const base = "https://dev.azure.com/private-org";
const source = `${base}/secret-project/_apis/wit/attachments/${id}?fileName=secret.png&token=secret-token`;
const card = { base, attachments: [{ id, image: true }] };

test("ticket image resolution preserves valid attachment and inline proxy previews", () => {
  assert.equal(
    ticketImagePreview(source, card, "ticket-ref").preview,
    `/api/ticket-cards/ticket-ref/attachments/${id}`,
  );
  const inline = `inline-${"a".repeat(64)}`;
  assert.equal(
    ticketImagePreview(
      `https://orbit.invalid/ticket-inline-image/${inline}`,
      { base, attachments: [{ id: inline, inline: true, image: true }] },
      "ref",
    ).preview,
    `/api/ticket-cards/ref/attachments/${inline}`,
  );
});

test("pre-request rejection reasons distinguish address and metadata failures", () => {
  const cases = [
    ["", card, "empty_source"],
    ["https://[invalid", card, "invalid_url"],
    ["blob:https://dev.azure.com/secret", card, "temporary_blob"],
    ["data:image/png;base64,privatebytes", card, "unprocessed_inline"],
    [
      `https://orbit.invalid/ticket-inline-image/inline-${"a".repeat(64)}`,
      card,
      "missing_inline_metadata",
    ],
    [source.replace("dev.azure.com", "other.example"), card, "different_origin"],
    [source.replace("private-org", "other-org"), card, "different_collection"],
    [`${base}/some-image.png`, card, "unsupported_path"],
    [source, { base, attachments: [] }, "missing_attachment"],
    [source, { base, attachments: [{ id, image: false }] }, "not_image"],
  ] as const;
  for (const [url, fixture, reason] of cases) {
    const result = ticketImagePreview(
      url,
      { ...fixture, attachments: [...fixture.attachments] },
      "private-ticket",
    );
    assert.equal(result.preview, null);
    assert.equal(result.diagnostic?.reason, reason);
    assert.equal(result.diagnostic?.stage, "before_request");
    const report = JSON.stringify(result.diagnostic);
    for (const secret of [
      "private-org",
      "secret-project",
      "secret.png",
      "secret-token",
      "privatebytes",
      "private-ticket",
      id,
      "dev.azure.com",
    ])
      assert.ok(!report.includes(secret), `Diagnostic leaked ${secret}`);
  }
});

test("legacy missing attachment metadata remains readable and reports its absence", () => {
  assert.equal(
    ticketImagePreview(source, { base }, "ref").diagnostic?.reason,
    "missing_attachment",
  );
  assert.equal(ticketImagePreview(source, card, "ref").diagnostic, undefined);
  assert.equal(
    ticketImagePreview(
      source.toUpperCase().replace("HTTPS://DEV.AZURE.COM/PRIVATE-ORG", base),
      card,
      "ref",
    ).preview,
    `/api/ticket-cards/ref/attachments/${id}`,
  );
});
