import type { ButtonHTMLAttributes } from "react";
import { Save } from "lucide-react";

export function ContextSaveButton({ busy, disabled, type = "button", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return <button {...props} type={type} className="primary context-save-button" disabled={busy || disabled}>
    <Save size={15} aria-hidden="true" />{busy ? "Сохраняю…" : "Сохранить"}
  </button>;
}
