import { useRef, useState } from "react";
import { SingleSelect } from "../../../shared/ui/single-select/index.js";
import { api } from "../../../shared/api/http/index.js";

export function ModelOverride({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [models, setModels] = useState<{ id: string; name?: string }[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function load() {
    if (models || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      setModels(await api("/copilot/models"));
    } catch {
      setError("Не удалось загрузить модели. Откройте список ещё раз.");
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }
  return (
    <div className="model-override">
      <SingleSelect
        label="Модель"
        value={value}
        onChange={onChange}
        disabled={disabled}
        onSearch={() => void load()}
        options={[
          { value: "", label: "Из настроек" },
          ...(value && !models?.some((m) => m.id === value) ? [{ value, label: value }] : []),
          ...(models || []).map((m) => ({
            value: m.id,
            label: m.name || m.id,
          })),
        ]}
      />
      {loading && <small role="status">Загружаю модели…</small>}
      {error && <small role="status">{error}</small>}
    </div>
  );
}
