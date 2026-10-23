import { Store } from "./store.js";

import { githubLogin } from "./github-login.js";

type Login = {
  status: string;
  userCode?: string;
  verificationUri?: string;
  error?: string;
  expiresAt?: number;
};
export class IntegrationsAuth {
  private cliLogin?: Login;
  constructor(
    private store: Store,
    private loginWithCli = githubLogin,
  ) {}
  async startGitHub() {
    if (this.cliLogin?.status === "pending") return this.cliLogin;
    const flow: Login = { status: "pending", expiresAt: Date.now() + 600000 };
    this.cliLogin = flow;
    void this.loginWithCli((code) => {
      flow.userCode = code;
      flow.verificationUri = "https://github.com/login/device";
    }).then((token) => {
      this.store.setSecret("github.token", token);
      flow.status = "connected";
      this.store.audit("github.connected", "GitHub CLI device flow");
    }).catch((error) => {
      flow.status = "error";
      flow.error = error instanceof Error ? error.message : "Ошибка входа GitHub";
    });
    return flow;
  }
  async pollGitHub() {
    return this.cliLogin || { status: this.store.secret("github.token") ? "connected" : "idle" };
  }
}
