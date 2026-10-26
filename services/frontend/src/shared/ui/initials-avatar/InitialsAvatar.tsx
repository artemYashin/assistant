/** Stable initials and colour, independent of the order people are loaded in. */
export function InitialsAvatar({ name }: { name: string }) {
  const words = name.normalize("NFC").trim().split(/\s+/u).filter(Boolean);
  const initials =
    words
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join("")
      .toUpperCase() || "?";
  let hash = 0;
  for (const character of initials) hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return (
    <span
      className="initials-avatar"
      aria-hidden="true"
      style={{ backgroundColor: `hsl(${hash % 360} 42% 32%)` }}
    >
      {initials}
    </span>
  );
}
