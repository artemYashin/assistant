import { InitialsAvatar } from "./InitialsAvatar.js";

export function LocalAssigneeNames({
  names,
  emptyLabel = "N/A",
}: {
  names: string[];
  emptyLabel?: string;
}) {
  const label = names.join(", ");
  return (
    <span className="local-assignee-names" title={label || emptyLabel}>
      {!!names.length && (
        <span className="local-assignee-avatars" aria-hidden="true">
          {names.slice(0, 2).map((name, index) => (
            <InitialsAvatar key={`${name}:${index}`} name={name} />
          ))}
          {names.length > 2 && (
            <span className="local-assignee-more">+{names.length - 2}</span>
          )}
        </span>
      )}
      <span className="local-assignee-label">{label || emptyLabel}</span>
    </span>
  );
}
