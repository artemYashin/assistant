// Use the same cancel path as Escape, preserving each dialog's cleanup and
// guards against closing while a write operation is in progress.
export function installDialogBackdropDismiss(document: Document) {
  let pressed: HTMLDialogElement | null = null;
  const backdropDialog = (event: MouseEvent): HTMLDialogElement | null => {
    const target = event.target;
    if (
      !(target instanceof HTMLDialogElement) ||
      !target.matches("dialog:modal")
    )
      return null;
    const rect = target.getBoundingClientRect();
    return event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
      ? target
      : null;
  };
  const down = (event: PointerEvent) => {
    pressed =
      event.button === 0 && event.isPrimary ? backdropDialog(event) : null;
  };
  const reset = () => {
    pressed = null;
  };
  const click = (event: MouseEvent) => {
    const dialog = pressed;
    reset();
    // A drag from inside the dialog to the backdrop must not dismiss it.
    if (!dialog || event.button !== 0 || backdropDialog(event) !== dialog)
      return;
    event.preventDefault();
    event.stopPropagation();
    const cancelled = !dialog.dispatchEvent(
      new Event("cancel", { cancelable: true }),
    );
    if (!cancelled && dialog.open) dialog.close();
  };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointercancel", reset, true);
  document.addEventListener("click", click, true);
  return () => {
    document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("pointercancel", reset, true);
    document.removeEventListener("click", click, true);
    reset();
  };
}
