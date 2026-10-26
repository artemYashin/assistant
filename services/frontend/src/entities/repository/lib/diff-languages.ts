export const diffLanguages = [
  ["typescript", "TypeScript"],
  ["tsx", "TypeScript / TSX"],
  ["javascript", "JavaScript"],
  ["jsx", "JavaScript / JSX"],
  ["csharp", "C#"],
  ["json", "JSON"],
  ["xml", "HTML / XML"],
  ["css", "CSS"],
  ["scss", "SCSS"],
  ["less", "Less"],
  ["python", "Python"],
  ["java", "Java"],
  ["kotlin", "Kotlin"],
  ["go", "Go"],
  ["rust", "Rust"],
  ["cpp", "C++"],
  ["c", "C"],
  ["sql", "SQL"],
  ["yaml", "YAML"],
  ["bash", "Shell / Bash"],
  ["markdown", "Markdown"],
  ["ruby", "Ruby"],
  ["php", "PHP"],
  ["swift", "Swift"],
  ["graphql", "GraphQL"],
  ["ini", "INI / TOML"],
].map(([value, label]) => ({ value, label }));

export function diffLanguage(path: string): string {
  const name = path.split("/").pop()?.toLowerCase() || "";
  const ext = name.split(".").pop() || "";
  if ([".bashrc", ".zshrc", ".bash_profile"].includes(name)) return "bash";
  const extensions: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    cs: "csharp",
    json: "json",
    html: "xml",
    htm: "xml",
    xml: "xml",
    svg: "xml",
    csproj: "xml",
    props: "xml",
    css: "css",
    scss: "scss",
    less: "less",
    py: "python",
    java: "java",
    kt: "kotlin",
    kts: "kotlin",
    go: "go",
    rs: "rust",
    cpp: "cpp",
    cc: "cpp",
    hpp: "cpp",
    c: "c",
    h: "c",
    sql: "sql",
    yaml: "yaml",
    yml: "yaml",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    md: "markdown",
    rb: "ruby",
    php: "php",
    swift: "swift",
    graphql: "graphql",
    gql: "graphql",
    ini: "ini",
    toml: "ini",
  };
  return extensions[ext] || "plaintext";
}

export const diffLanguageStorageKey = "orbit.pr-diff.language";
export function validDiffLanguage(value: unknown): string {
  return typeof value === "string" &&
    (value === "auto" || value === "plaintext" || diffLanguages.some((l) => l.value === value))
    ? value
    : "auto";
}
