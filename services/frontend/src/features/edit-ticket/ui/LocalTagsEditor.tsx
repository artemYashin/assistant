import { useEffect, useState } from "react";
import { api } from "../../../shared/api/http/index.js";
import { TagsEditor } from "../../../shared/ui/tags-editor/index.js";
export function LocalTagsEditor({
  source,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  source: string;
  disabled: boolean;
}) {
  const [known, setKnown] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api(`/local-ticket-tags?${new URLSearchParams({ source })}`)
      .then((value) => {
        if (live) setKnown(value);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [source]);
  return (
    <TagsEditor label="Локальные теги" {...props} known={known} loading={loading} error={error} />
  );
}
