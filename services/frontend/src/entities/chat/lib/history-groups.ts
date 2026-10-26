export function groupChatHistory<T extends { updated_at: string }>(
  sessions: T[],
  now = new Date(),
) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const week = new Date(today);
  week.setDate(week.getDate() - 7);
  const groups = ["Сегодня", "Вчера", "Последняя неделя", "Ранее"].map((label) => ({
    label,
    sessions: [] as T[],
  }));
  for (const session of [...sessions].sort(
    (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
  )) {
    const date = Date.parse(session.updated_at);
    const index = date >= +today ? 0 : date >= +yesterday ? 1 : date >= +week ? 2 : 3;
    groups[index].sessions.push(session);
  }
  return groups.filter((group) => group.sessions.length);
}
