/** Popovers share the browser top layer with modal dialogs; z-index alone cannot reorder it.
 * Keep the voice host inside the top modal (so it is not inert), then promote its popover.
 */
export function keepVoiceOverlayOnTop(host: HTMLElement, overlay: HTMLElement) {
  const modals = [...document.querySelectorAll<HTMLDialogElement>("dialog:modal")];
  const focusedModal = document.activeElement?.closest<HTMLDialogElement>("dialog:modal");
  if (focusedModal) {
    const index = modals.indexOf(focusedModal);
    if (index >= 0) modals.splice(index, 1);
    modals.push(focusedModal);
  }
  let disposed = false;
  const promote = () => {
    if (disposed) return;
    const active = modals.filter((dialog) => dialog.isConnected && dialog.matches(":modal"));
    const parent = active.at(-1) || document.body;
    const focused = overlay.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;
    overlay.hidePopover?.();
    if (host.parentElement !== parent) parent.append(host);
    overlay.showPopover?.();
    focused?.focus({ preventScroll: true });
  };
  const observer = new MutationObserver((records) => {
    let changed = false;
    const track = (dialog: HTMLDialogElement) => {
      const index = modals.indexOf(dialog);
      if (index >= 0) modals.splice(index, 1);
      if (dialog.isConnected && dialog.matches(":modal")) modals.push(dialog);
      changed = true;
    };
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof HTMLDialogElement)
        track(record.target);
      for (const node of [...record.addedNodes, ...record.removedNodes]) {
        if (!(node instanceof Element) || node === host) continue;
        if (node instanceof HTMLDialogElement) track(node);
        node.querySelectorAll<HTMLDialogElement>("dialog").forEach(track);
      }
    }
    if (changed) promote();
  });
  const onToggle = (event: Event) => {
    if (event.target === overlay || !(event.target instanceof HTMLElement)) return;
    if (event.target.matches(":popover-open") && !overlay.contains(event.target)) promote();
  };
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  document.addEventListener("toggle", onToggle, true);
  promote();
  overlay.querySelector<HTMLElement>(".voice-shortcut-card")?.focus({ preventScroll: true });
  return () => {
    disposed = true;
    observer.disconnect();
    document.removeEventListener("toggle", onToggle, true);
    if (overlay.isConnected) {
      overlay.hidePopover?.();
      document.body.append(host);
    }
  };
}
