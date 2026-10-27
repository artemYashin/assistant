import { useChatToggleShortcut as useAppShortcut } from "../../../features/voice-input/index.js";
import { CreateTicketForm } from "../../../features/create-ticket/index.js";
import { useCallback, useRef, useState } from "react";
import { Plus } from "lucide-react";

export function CreateTicket({ settings }: { settings: any }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const source = `${(settings?.azureUrl || "").replace(/\/$/, "")}|${settings?.azureProject || ""}`;
  const openCreate = useCallback(() => {
    if (!settings?.azureUrl || !settings?.azureProject) return;
    setOpen(true);
    dialog.current?.showModal();
  }, [settings?.azureUrl, settings?.azureProject]);
  useAppShortcut(
    settings?.ticketCreateKey ?? "KeyY",
    settings?.ticketCreatePress ?? "single",
    openCreate,
  );
  return (
    <>
      <button
        type="button"
        className="primary create-ticket-trigger"
        disabled={!settings?.azureUrl || !settings?.azureProject}
        onClick={openCreate}
      >
        <Plus size={17} />
        Создать тикет
      </button>
      <dialog
        ref={dialog}
        className="create-ticket-dialog"
        aria-label="Создать тикет в Azure"
        onClose={() => {
          if (!dialog.current?.open) setOpen(false);
        }}
      >
        {open && (
          <CreateTicketForm
            key={source}
            source={source}
            project={settings.azureProject}
            colors={settings.typeColors || {}}
            onClose={() => dialog.current?.close()}
            dialog={dialog.current!}
          />
        )}
      </dialog>
    </>
  );
}
