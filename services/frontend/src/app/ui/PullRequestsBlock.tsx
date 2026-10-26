import { CompletedPullRequests, LinkedPullRequest } from "../../pages/pull-requests/index.js";
import { ReviewQuestionInbox } from "../../widgets/review-questions/index.js";
import { Link, useSearchParams } from "react-router-dom";
import { GitPullRequest, GitMerge, Inbox } from "lucide-react";
import { PullRequestsPage } from "../../pages/pull-requests/index.js";
import { Empty } from "../../shared/ui/empty/index.js";
import { PageHeading } from "../../shared/ui/page-heading/index.js";
import type { WorkspaceState } from "../model/useWorkspace.js";

type Props = Pick<
  WorkspaceState,
  "settings" | "page" | "context" | "setRefresh" | "inboxTab" | "completedTab" | "reviewQuestions"
>;

export function PullRequestsBlock({
  settings,
  page,
  context,
  setRefresh,
  inboxTab,
  completedTab,
  reviewQuestions,
}: Props) {
  const [params] = useSearchParams();
  const linked = !!params.get("linkedCard");
  return (
    <>
      {page === "pullrequests" && (
        <nav className="pr-page-tabs" aria-label="Разделы Pull Requests">
          <Link to="/pull-requests" aria-current={!inboxTab && !completedTab ? "page" : undefined}>
            <GitPullRequest size={16} /> Активные
          </Link>
          <Link to="/pull-requests?tab=completed" aria-current={completedTab ? "page" : undefined}>
            <GitMerge size={16} /> Завершённые
          </Link>
          <Link to="/pull-requests?tab=inbox" aria-current={inboxTab ? "page" : undefined}>
            <Inbox size={16} /> Входящие
            {reviewQuestions.filter((q) => q.status === "pending").length > 0 && (
              <span className="nav-count">
                {reviewQuestions.filter((q) => q.status === "pending").length}
              </span>
            )}
          </Link>
        </nav>
      )}
      {page === "pullrequests" && linked && <LinkedPullRequest />}
      {page === "pullrequests" && !linked && completedTab && (
        <CompletedPullRequests
          settings={settings}
          key={JSON.stringify(context)}
          context={context}
        />
      )}
      {page === "pullrequests" && !linked && !inboxTab && !completedTab && (
        <PullRequestsPage context={context} settings={settings} />
      )}
      {page === "pullrequests" && !linked && inboxTab && (
        <>
          <PageHeading
            title="Не упустите важное"
            subtitle="Вопросы ревьюера и задачи, требующие вашего внимания."
          />
          <ReviewQuestionInbox items={reviewQuestions} onChange={() => setRefresh((n) => n + 1)} />
          {!reviewQuestions.length && (
            <Empty
              icon={Inbox}
              title="Входящие разобраны"
              description="Если для ревью потребуется уточнение, здесь появится полный набор вопросов."
            />
          )}
        </>
      )}
    </>
  );
}
