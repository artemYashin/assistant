import { AppError, Store } from "./store.js";
import { azureBase, requestJson } from "./http.js";
import type { Connectors } from "./connectors.js";
import type { PullRequests } from "./pull-requests.js";

export type AzurePrLink = { projectId: string; repo: string; number: number };
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function azurePrLinks(relations: any[]): AzurePrLink[] {
  const result = new Map<string, AzurePrLink>();
  for (const relation of relations || []) {
    if (relation?.rel !== "ArtifactLink" || typeof relation.url !== "string") continue;
    try {
      const match = /^vstfs:\/\/\/Git\/PullRequestId\/([^?#]+)$/i.exec(relation.url);
      if (!match) continue;
      const [projectId, repo, id, extra] = decodeURIComponent(match[1]).split("/");
      const number = Number(id);
      if (
        extra !== undefined ||
        !guid.test(projectId) ||
        !guid.test(repo) ||
        !/^[1-9]\d*$/.test(id) ||
        !Number.isSafeInteger(number)
      )
        continue;
      const link = { projectId: projectId.toLowerCase(), repo: repo.toLowerCase(), number };
      result.set(`${link.repo}:${number}`, link);
    } catch {
      /* Ignore malformed artifact URLs, never request their origin. */
    }
  }
  return [...result.values()];
}
export class TicketPullRequests {
  constructor(
    private store: Store,
    private connectors: Connectors,
    private prs: PullRequests,
  ) {}
  private connection(ref: string) {
    const card = this.connectors.ticketCard(ref);
    const settings = this.store.settings();
    const source = this.store.source(settings);
    const pat = this.store.secret("azure.pat");
    if (card.source !== source)
      throw new AppError(409, "Подключение Azure изменилось: загрузите тикет заново");
    const assertCurrent = () => {
      if (source !== this.store.source() || pat !== this.store.secret("azure.pat"))
        throw new AppError(409, "Подключение Azure изменилось: загрузите тикет заново");
    };
    const get = async (project: string, path: string) => {
      if (!pat) throw new AppError(400, "Настройте PAT Azure DevOps");
      const data = await requestJson(
        `${azureBase(settings.azureUrl)}/${encodeURIComponent(project)}/_apis/${path}${path.includes("?") ? "&" : "?"}api-version=${encodeURIComponent(settings.azureVersion)}`,
        {
          headers: { Authorization: `Basic ${Buffer.from(":" + pat).toString("base64")}` },
          redirect: "error",
          signal: AbortSignal.timeout(20000),
        },
        "Azure DevOps",
      );
      assertCurrent();
      return data;
    };
    return { card, settings, get, assertCurrent };
  }
  private async links(connection: ReturnType<TicketPullRequests["connection"]>) {
    if (Array.isArray(connection.card.azurePullRequests))
      return azurePrLinks(
        connection.card.azurePullRequests.map((link: AzurePrLink) => ({
          rel: "ArtifactLink",
          url: `vstfs:///Git/PullRequestId/${link.projectId}/${link.repo}/${link.number}`,
        })),
      );
    // Backward-compatible read of cards saved before PR relations were retained.
    const item = await connection.get(
      connection.settings.azureProject,
      `wit/workitems/${connection.card.id}?$expand=relations`,
    );
    if (item.id !== connection.card.id) throw new AppError(502, "Azure вернул другой тикет");
    return azurePrLinks(item.relations || []);
  }
  private async read(connection: ReturnType<TicketPullRequests["connection"]>, link: AzurePrLink) {
    const detail = await connection.get(
      link.projectId,
      `git/repositories/${link.repo}/pullrequests/${link.number}`,
    );
    if (
      detail.pullRequestId !== link.number ||
      detail.repository?.id?.toLowerCase() !== link.repo ||
      detail.repository?.project?.id?.toLowerCase() !== link.projectId
    )
      throw new AppError(502, "Azure вернул другой pull request");
    return detail;
  }
  async list(ref: string) {
    const connection = this.connection(ref);
    const locals = this.prs.linkedToTicket(connection.card.id, connection.card.source);
    const items = new Map<string, any>(
      locals.map((pr: any) => [
        `${pr.repo.toLowerCase()}:${pr.number}`,
        {
          ...pr,
          origin: "Orbit",
          status: "active",
          href: `/pull-requests?${new URLSearchParams({ monitor: pr.monitor, repo: pr.repo, number: String(pr.number) })}`,
        },
      ]),
    );
    let links: AzurePrLink[] = [];
    let warning = "";
    try {
      links = await this.links(connection);
    } catch (error: any) {
      connection.assertCurrent();
      warning = error.message;
    }
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, links.length) }, async () => {
        while (index < links.length) {
          const link = links[index++];
          const key = `${link.repo}:${link.number}`;
          let local = items.get(key);
          if (!local) {
            for (const monitor of this.prs
              .monitors()
              .filter((m) => azureBase(m.source) === azureBase(connection.settings.azureUrl))) {
              const saved = this.store.db
                .prepare(
                  "SELECT title,author,in_scope FROM pull_requests WHERE monitor=? AND lower(repo)=? AND number=?",
                )
                .get(monitor.id, link.repo, link.number) as
                { title: string; author: string; in_scope: number } | undefined;
              if (saved?.in_scope) {
                local = {
                  ...saved,
                  status: "active",
                  href: `/pull-requests?${new URLSearchParams({ monitor: monitor.id, repo: link.repo, number: String(link.number) })}`,
                };
                break;
              }
            }
          }
          let detail: any;
          let error = "";
          try {
            detail = await this.read(connection, link);
          } catch (e: any) {
            error = e.message;
          }
          const status = detail?.status || local?.status || "unknown";
          const href =
            local && status === "active"
              ? local.href
              : `/pull-requests?${new URLSearchParams({
                  ...(status === "completed" || status === "abandoned" ? { tab: "completed" } : {}),
                  linkedCard: ref,
                  projectId: link.projectId,
                  repo: link.repo,
                  number: String(link.number),
                })}`;
          items.set(key, {
            ...local,
            ...link,
            title: detail?.title || local?.title || `PR #${link.number}`,
            author: detail?.createdBy?.displayName || local?.author || "",
            status,
            draft: detail?.isDraft ?? local?.draft,
            origin: local ? "Azure и Orbit" : "Azure",
            href,
            error,
          });
        }
      }),
    );
    connection.assertCurrent();
    return { items: [...items.values()], warning };
  }
  async detail(ref: string, link: AzurePrLink, preview = false): Promise<any> {
    const connection = this.connection(ref);
    const links = await this.links(connection);
    if (
      !links.some(
        (item) =>
          item.projectId === link.projectId &&
          item.repo === link.repo &&
          item.number === link.number,
      )
    )
      throw new AppError(404, "Связанный PR не найден в тикете");
    const detail = await this.read(connection, link);
    if (preview)
      return {
        ...(await this.prs.previewDetail(detail)),
        ticket: {
          id: connection.card.id,
          source: connection.card.source,
          title: connection.card.fields?.["System.Title"] || "",
        },
      };
    return {
      ...link,
      title: detail.title || "",
      description: detail.description || "",
      author: detail.createdBy?.displayName || "",
      status: detail.status,
      draft: !!detail.isDraft,
      repository: detail.repository.name,
      project: detail.repository.project.name,
      createdAt: detail.creationDate,
      closedAt: detail.closedDate,
      sourceBranch: detail.sourceRefName,
      targetBranch: detail.targetRefName,
      reviewers: (detail.reviewers || []).map((r: any) => ({ name: r.displayName, vote: r.vote })),
      ticket: {
        id: connection.card.id,
        source: connection.card.source,
        title: connection.card.fields?.["System.Title"] || "",
      },
    };
  }
}
