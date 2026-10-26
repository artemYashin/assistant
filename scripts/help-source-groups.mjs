import ts from "typescript";

// Reassemble split declarations in their original order for stable generated help
// IDs; keep each actual file/line for source links. This is only a docs view.
export function groupHelpSources(sources, groups) {
  const grouped = new Set(groups.flatMap((group) => group.declarations.map((item) => item.path)));
  const result = [...sources]
    .filter(([path]) => !grouped.has(path))
    .map(([path, source]) => ({ path, source }));
  for (const group of groups) {
    const parsed = new Map();
    for (const path of new Set(group.declarations.map((item) => item.path))) {
      if (!sources.has(path)) throw new Error(`Missing help source: ${path}`);
      parsed.set(path, ts.createSourceFile(path, sources.get(path), ts.ScriptTarget.Latest, true));
    }
    const used = new Set(),
      parts = [],
      locations = [];
    const append = (path, file, node) => {
      if (used.has(node)) throw new Error(`Duplicate help declaration: ${path}`);
      used.add(node);
      const text = node.getText(file),
        line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
      parts.push(text);
      for (let offset = 0; offset < text.split("\n").length; offset++)
        locations.push(`${path}:${line + offset}`);
    };
    for (const item of group.declarations) {
      const file = parsed.get(item.path);
      const node = file.statements.find(
        (node) =>
          (node.name?.getText(file) ||
            node.declarationList?.declarations[0]?.name.getText(file)) === item.name,
      );
      if (!node) throw new Error(`Missing help declaration: ${item.path}#${item.name}`);
      append(item.path, file, node);
    }
    // Include new declarations too; the manifest must not hide new controls/errors.
    for (const [path, file] of parsed)
      for (const node of file.statements) {
        if (!used.has(node)) append(path, file, node);
      }
    result.push({ path: group.path, source: parts.join("\n"), locations });
  }
  return result;
}
