import { spawn, execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export function deviceCode(output: string) {
  return /(?:one-time code|code):\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(output)?.[1];
}
// Use GitHub CLI's own OAuth app, not a copied third-party client ID.
export async function githubLogin(
  onCode: (code: string) => void,
  executable = "gh",
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "orbit-github-"));
  const env = {
    ...process.env,
    GH_CONFIG_DIR: dir,
    GH_BROWSER: "true",
    BROWSER: "true",
    GH_PROMPT_DISABLED: "1",
    NO_COLOR: "1",
    LC_ALL: "C",
  };
  for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"])
    delete (env as any)[key];
  try {
    let help: string;
    try {
      help = (
        await promisify(execFile)(executable, ["auth", "login", "--help"], {
          env,
          timeout: 10000,
        })
      ).stdout;
    } catch {
      throw new Error(
        "Не удалось запустить GitHub CLI. Пересоберите Docker-образ или установите gh.",
      );
    }
    const args = ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"];
    if (help.includes("--insecure-storage")) args.push("--insecure-storage");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, args, {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let tail = "",
        reported = "";
      let timedOut = false;
      const timer = setTimeout(
        () => {
          timedOut = true;
          child.kill("SIGKILL");
        },
        10 * 60 * 1000,
      );
      const output = (chunk: Buffer) => {
        tail = (tail + chunk.toString()).slice(-8192);
        const code = deviceCode(tail);
        if (code && code !== reported) {
          reported = code;
          onCode(code);
        }
      };
      child.stdout.on("data", output);
      child.stderr.on("data", output);
      child.once("error", () => {
        clearTimeout(timer);
        reject(
          new Error(
            "Не удалось запустить GitHub CLI. Пересоберите Docker-образ или установите gh для локального запуска.",
          ),
        );
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (timedOut) reject(new Error("Время входа истекло. Начните вход снова."));
        else if (code === 0) resolve();
        else
          reject(
            new Error(
              "Вход GitHub не завершён. Повторите вход и проверьте доступ вашей организации.",
            ),
          );
      });
    });
    let stdout: string;
    try {
      ({ stdout } = await promisify(execFile)(
        executable,
        ["auth", "token", "--hostname", "github.com"],
        { env, timeout: 15000, maxBuffer: 65536 },
      ));
    } catch {
      throw new Error("Не удалось получить токен GitHub CLI. Повторите вход.");
    }
    const token = stdout.trim();
    if (!token) throw new Error("GitHub CLI не вернул токен.");
    return token;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
