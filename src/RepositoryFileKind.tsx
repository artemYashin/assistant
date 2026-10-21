import { File, FileArchive, FileCode2, FileImage, FileJson2, FileText, Folder, Link2, Settings2 } from "lucide-react";

export function repositoryFileKind(name: string, type = "file") {
  if (type === "directory") return { Icon: Folder, tone: "folder", label: "Папка" };
  if (type === "symlink") return { Icon: Link2, tone: "config", label: "Ссылка" };
  if (type === "submodule") return { Icon: Folder, tone: "config", label: "Подмодуль" };
  const extension = name.split(".").pop()?.toLowerCase() || "";
  const label = extension.toUpperCase();
  if (["ts", "tsx"].includes(extension)) return { Icon: FileCode2, tone: "typescript", label };
  if (["js", "jsx", "mjs", "cjs"].includes(extension)) return { Icon: FileCode2, tone: "javascript", label };
  if (["json", "jsonc"].includes(extension)) return { Icon: FileJson2, tone: "data", label };
  if (["css", "scss", "sass", "less", "html", "svg", "vue", "svelte"].includes(extension)) return { Icon: FileCode2, tone: "style", label };
  if (["png", "jpg", "jpeg", "gif", "webp", "ico", "avif"].includes(extension)) return { Icon: FileImage, tone: "image", label };
  if (["zip", "gz", "tar", "7z", "rar"].includes(extension)) return { Icon: FileArchive, tone: "archive", label };
  if (["md", "txt", "rst", "csv", "pdf"].includes(extension)) return { Icon: FileText, tone: "text", label };
  if (["yml", "yaml", "toml", "ini", "xml", "config", "lock", "env"].includes(extension) || /^(dockerfile|\.gitignore|\.npmrc)/i.test(name)) return { Icon: Settings2, tone: "config", label: "Настройки" };
  if (["py", "go", "rs", "cs", "java", "sh", "sql", "rb", "php", "cpp", "c", "h"].includes(extension)) return { Icon: FileCode2, tone: "code", label };
  return { Icon: File, tone: "text", label: name.includes(".") ? label : "Файл" };
}
export function RepositoryFileIcon({ name, type, size = 16 }: { name: string; type?: string; size?: number }) {
  const { Icon, tone } = repositoryFileKind(name, type);
  return <Icon size={size} className={`repository-kind-icon repository-kind-${tone}`} aria-hidden="true" />;
}
export function repositoryFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`;
  return `${(size / 1024 ** 2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
}
