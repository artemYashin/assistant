export type BindingEvent = { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean };
export const modifierCode = (code: string) => /^(Control|Shift|Alt|Meta)(Left|Right)$/.test(code);
export function voiceBinding(event: BindingEvent) {
  const parts: string[] = [];
  if (event.ctrlKey && !event.code.startsWith("Control")) parts.push("Ctrl");
  if (event.altKey && !event.code.startsWith("Alt")) parts.push("Alt");
  if (event.shiftKey && !event.code.startsWith("Shift")) parts.push("Shift");
  if (event.metaKey && !event.code.startsWith("Meta")) parts.push("Meta");
  return [...parts, event.code].join("+");
}
export const voiceBindingPattern = /^(?:$|(?:Ctrl\+)?(?:Alt\+)?(?:Shift\+)?(?:Meta\+)?[A-Za-z][A-Za-z0-9]{0,39})$/;
export function voiceBindingLabel(value: string) {
  return value.split("+").map(part => ({ Space: "Пробел", Meta: "⌘ / Win", Alt: "Alt / Option", ControlLeft: "Ctrl (лев.)", ControlRight: "Ctrl (прав.)", MetaLeft: "⌘ / Win (лев.)", MetaRight: "⌘ / Win (прав.)", AltLeft: "Alt / Option (лев.)", AltRight: "Alt / Option (прав.)", ShiftLeft: "Shift (лев.)", ShiftRight: "Shift (прав.)" }[part] || part.replace(/^(Key|Digit)/, ""))).join(" + ");
}
