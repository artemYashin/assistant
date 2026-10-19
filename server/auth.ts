import { PublicClientApplication, type ICachePlugin } from "@azure/msal-node";
import { Store, AppError } from "./store.js";
import { requestJson } from "./http.js";

import { githubLogin } from "./github-login.js";

type Login = {
  status: string;
  userCode?: string;
  verificationUri?: string;
  error?: string;
  expiresAt?: number;
};
export class IntegrationsAuth {
  private github?: {
    deviceCode: string;
    clientId: string;
    interval: number;
    next: number;
    expires: number;
    display: Login;
  };
  private microsoft: Login = { status: "idle" };
  private msalInstance?: PublicClientApplication;
  private msalKey = "";
  private cliLogin?: Login;
  constructor(
    private store: Store,
    private loginWithCli = githubLogin,
  ) {}
  private microsoftKey() {
    const s = this.store.settings();
    return `${s.microsoftTenantId}|${s.microsoftClientId}`;
  }
  async startGitHub() {
    if (this.cliLogin?.status === "pending") return this.cliLogin;
    if (!this.store.settings().githubClientId) {
      const flow: Login = { status: "pending", expiresAt: Date.now() + 600000 };
      this.cliLogin = flow;
      void this.loginWithCli((code) => {
        flow.userCode = code;
        flow.verificationUri = "https://github.com/login/device";
      })
        .then((token) => {
          if (this.store.settings().githubClientId)
            throw new Error("Настройки входа изменились. Начните вход снова.");
          this.store.setSecret("github.token", token);
          flow.status = "connected";
          this.store.audit("github.connected", "GitHub CLI device flow");
        })
        .catch((error) => {
          flow.status = "error";
          flow.error =
            error instanceof Error ? error.message : "Ошибка входа GitHub";
        });
      return flow;
    }
    this.cliLogin = undefined;
    if (this.github && Date.now() < this.github.expires)
      return this.github.display;
    const clientId = this.store.settings().githubClientId;
    if (!clientId)
      throw new AppError(
        400,
        "Сначала сохраните Client ID GitHub OAuth App с включённым Device Flow",
      );
    const r = await requestJson(
      "https://github.com/login/device/code",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ client_id: clientId, scope: "read:user" }),
      },
      "GitHub",
    );
    if (!r.device_code)
      throw new AppError(
        400,
        "GitHub не выдал код. Проверьте Client ID и включите Device Flow в OAuth App.",
      );
    const expires = Date.now() + r.expires_in * 1000;
    const display: Login = {
      status: "pending",
      userCode: r.user_code,
      verificationUri: r.verification_uri,
      expiresAt: expires,
    };
    this.github = {
      deviceCode: r.device_code,
      clientId,
      interval: r.interval || 5,
      next: 0,
      expires,
      display,
    };
    return display;
  }
  async pollGitHub() {
    if (this.cliLogin) return this.cliLogin;
    const flow = this.github;
    if (!flow)
      return {
        status: this.store.secret("github.token") ? "connected" : "idle",
      };
    if (Date.now() > flow.expires) {
      this.github = undefined;
      return { status: "expired" };
    }
    if (Date.now() < flow.next) return flow.display;
    flow.next = Date.now() + flow.interval * 1000;
    const r = await requestJson(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: flow.clientId,
          device_code: flow.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      },
      "GitHub",
    );
    if (r.error === "authorization_pending") return flow.display;
    if (r.error === "slow_down") {
      flow.interval += 5;
      flow.next = Date.now() + flow.interval * 1000;
      return flow.display;
    }
    if (!r.access_token) {
      this.github = undefined;
      return {
        status: "error",
        error: "Вход GitHub не завершён. Попробуйте снова.",
      };
    }
    this.store.setSecret("github.token", r.access_token);
    this.github = undefined;
    this.store.audit("github.connected", "OAuth device flow");
    return { status: "connected" };
  }
  private msal() {
    const s = this.store.settings();
    if (!s.microsoftClientId || !s.microsoftTenantId)
      throw new AppError(
        400,
        "Сохраните Tenant ID и Client ID Microsoft Entra",
      );
    const key = `${s.microsoftTenantId}|${s.microsoftClientId}`;
    if (this.msalInstance && key === this.msalKey) return this.msalInstance;
    const cachePlugin: ICachePlugin = {
      beforeCacheAccess: async (ctx) => {
        const cache = this.store.secret(`msal:${key}`);
        if (cache) ctx.tokenCache.deserialize(cache);
      },
      afterCacheAccess: async (ctx) => {
        if (ctx.cacheHasChanged)
          this.store.setSecret(`msal:${key}`, ctx.tokenCache.serialize());
      },
    };
    this.msalKey = key;
    this.msalInstance = new PublicClientApplication({
      auth: {
        clientId: s.microsoftClientId,
        authority: `https://login.microsoftonline.com/${encodeURIComponent(s.microsoftTenantId)}`,
      },
      cache: { cachePlugin },
    });
    return this.msalInstance;
  }
  async startMicrosoft(): Promise<Login> {
    if (this.microsoft.status === "pending") return this.microsoft;
    const client = this.msal();
    const key = this.msalKey;
    return new Promise((resolve, reject) => {
      let displayed = false;
      client
        .acquireTokenByDeviceCode({
          scopes: [
            "https://graph.microsoft.com/Chat.Read",
            "https://graph.microsoft.com/ChatMessage.Send",
            "https://graph.microsoft.com/User.Read",
          ],
          deviceCodeCallback: (code) => {
            displayed = true;
            this.microsoft = {
              status: "pending",
              userCode: code.userCode,
              verificationUri: code.verificationUri,
              expiresAt: Date.now() + code.expiresIn * 1000,
            };
            resolve(this.microsoft);
          },
        })
        .then((result) => {
          if (!result?.account || key !== this.microsoftKey())
            throw new Error("Account missing or connection settings changed");
          const accountKey = `microsoft.account:${key}`;
          const previous = this.store.get<string | null>(accountKey, null);
          if (previous && previous !== result.account.homeAccountId) {
            if (
              this.store.db
                .prepare("SELECT 1 FROM approvals WHERE status='sending'")
                .get()
            )
              throw new Error("Cannot switch accounts during delivery");
            this.store.db.transaction(() => {
              this.store.db.exec(
                "UPDATE approvals SET status='expired' WHERE status='pending'; DELETE FROM chats; DELETE FROM messages; DELETE FROM suggestions;",
              );
              this.store.audit(
                "teams.account_changed",
                "Старые черновики аннулированы; выберите чаты заново.",
              );
            })();
          }
          this.store.set(accountKey, result.account.homeAccountId);
          this.microsoft = { status: "connected" };
          this.store.set("microsoft.connected", true);
          this.store.audit(
            "teams.connected",
            result.account?.username || "Microsoft",
          );
        })
        .catch(() => {
          this.microsoft = {
            status: "error",
            error:
              "Вход Microsoft не завершён. Проверьте настройки Entra и политику Device Code Flow.",
          };
          if (!displayed) reject(new AppError(400, this.microsoft.error!));
        });
    });
  }
  microsoftStatus() {
    return this.microsoft.status === "idle" &&
      this.store.get("microsoft.connected", false)
      ? { status: "connected" }
      : this.microsoft;
  }
  async graphToken() {
    const client = this.msal();
    const selectedId = this.store.get<string | null>(
      `microsoft.account:${this.msalKey}`,
      null,
    );
    const accounts = await client.getTokenCache().getAllAccounts();
    const account = accounts.find(
      (candidate) => candidate.homeAccountId === selectedId,
    );
    if (!account || !this.store.get("microsoft.connected", false))
      throw new AppError(401, "Подключите Microsoft Teams в настройках");
    try {
      const result = await client.acquireTokenSilent({
        account,
        scopes: [
          "https://graph.microsoft.com/Chat.Read",
          "https://graph.microsoft.com/ChatMessage.Send",
          "https://graph.microsoft.com/User.Read",
        ],
      });
      return result.accessToken;
    } catch {
      throw new AppError(
        401,
        "Сессия Microsoft истекла или требуется согласие. Подключите Teams заново.",
      );
    }
  }
}
