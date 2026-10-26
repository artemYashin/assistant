import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(import.meta.dirname, "..");
const layers = ["app", "pages", "widgets", "features", "entities", "shared"];
export function imports(file, text) {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const result = [];
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      result.push(node.moduleSpecifier.text);
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      result.push(node.argument.literal.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      result.push(node.arguments[0].text);
    if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "URL" &&
      node.arguments?.[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      result.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}
function scope(file) {
  const parts = file.replace(/^services\/frontend\//, "").split("/");
  const layer = parts[0] === "src" && layers.includes(parts[1]) ? parts[1] : null;
  return {
    layer,
    unit:
      layer === "app"
        ? "src/app"
        : layer === "shared"
          ? parts.slice(0, 4).join("/")
          : parts.slice(0, 3).join("/"),
  };
}
export function architectureErrors(files, policy) {
  const errors = [];
  const known = new Set(Object.keys(files));
  for (const [file, source] of Object.entries(files)) {
    if (!/^services\/frontend\/src\/.*\.(tsx?|mjs)$/.test(file)) continue;
    const from = scope(file);
    if (
      !from.layer &&
      file !== "services/frontend/src/main.tsx" &&
      !policy.legacyFiles.includes(file)
    )
      errors.push(`${file}: new code must belong to an FSD layer`);
    for (const spec of imports(file, source)) {
      if (!spec.startsWith(".")) continue;
      const raw = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      const target =
        [raw, raw.replace(/\.js$/, ".ts"), raw.replace(/\.js$/, ".tsx")].find((candidate) =>
          known.has(candidate),
        ) || raw;
      const to = scope(target);
      const edge = `${file} -> ${target}`;
      if (
        file === "services/frontend/src/main.tsx" &&
        target !== "services/frontend/src/app/index.ts"
      ) {
        errors.push(`${edge}: bootstrap may only import app public API`);
        continue;
      }
      if (policy.exceptions.includes(edge)) continue;
      if (from.layer && !to.layer) {
        errors.push(
          `${edge}: migrated modules cannot depend on legacy/server code without a documented exception`,
        );
        continue;
      }
      if (from.layer && to.layer) {
        if (layers.indexOf(to.layer) < layers.indexOf(from.layer))
          errors.push(`${edge}: upward layer dependency`);
        if (
          from.layer === to.layer &&
          from.unit !== to.unit &&
          !["app", "shared"].includes(from.layer)
        )
          errors.push(`${edge}: cross-slice dependency`);
      }
      if (to.layer && from.unit !== to.unit && !target.endsWith("/index.ts"))
        errors.push(`${edge}: import the public index, not slice internals`);
    }
  }
  return errors;
}
export function readSources() {
  const files = {};
  function scan(dir) {
    for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const file = dir + "/" + entry.name;
      if (entry.isDirectory()) scan(file);
      else files[file] = readFileSync(path.join(root, file), "utf8");
    }
  }
  scan("services/frontend/src");
  scan("services/backend/src");
  return files;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const policy = JSON.parse(
    readFileSync(path.join(root, "scripts/architecture-policy.json"), "utf8"),
  );
  const errors = architectureErrors(readSources(), policy);
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log("Architecture checked: FSD layers, public APIs and explicit legacy exceptions.");
}
