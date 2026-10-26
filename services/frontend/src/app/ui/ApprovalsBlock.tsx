import { ConfirmButton } from "../../shared/ui/confirm-button/index.js";
import { MemoryProposalList } from "../../widgets/memory/index.js";
import { Trash2 } from "lucide-react";
import { api } from "../../shared/api/http/index.js";
import { PageHeading } from "../../shared/ui/page-heading/index.js";
import type { WorkspaceState } from "../model/useWorkspace.js";

type Props = Pick<WorkspaceState, "page" | "memoryProposals" | "context" | "setRefresh" | "busy">;

export function ApprovalsBlock({ page, memoryProposals, context, setRefresh, busy }: Props) {
  return (
    <>
      {page === "approvals" && (
        <>
          <PageHeading
            title="Подтверждения"
            subtitle="Проверьте предложения ассистента перед сохранением в память."
          >
            <ConfirmButton
              title="Удалить все подтверждения?"
              message="Будет очищен весь список предложений памяти, включая обработанные записи всех заказчиков и проектов. Сохранённая память останется без изменений. Это действие нельзя отменить."
              confirmLabel="Удалить всё"
              disabled={!!busy || !memoryProposals.length}
              onConfirm={async () => {
                await api("/confirmations", "DELETE");
                setRefresh((n) => n + 1);
              }}
            >
              <Trash2 size={16} />
              Удалить всё
            </ConfirmButton>
          </PageHeading>
          <MemoryProposalList
            context={context}
            items={memoryProposals}
            onChange={() => setRefresh((n) => n + 1)}
          />
        </>
      )}
    </>
  );
}
