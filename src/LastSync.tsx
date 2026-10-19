export function LastSync({
  at,
  label = "Последняя успешная синхронизация",
}: {
  at?: string | null;
  label?: string;
}) {
  const valid = at && Number.isFinite(Date.parse(at));
  return (
    <p className="last-sync">
      <span>{label}: </span>
      {valid ? (
        <time dateTime={at} title={new Date(at).toString()}>
          {new Date(at).toLocaleString("ru-RU")}
        </time>
      ) : (
        <span>ещё не выполнялась</span>
      )}
    </p>
  );
}
