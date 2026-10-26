import { TriangleAlert } from "lucide-react";

const permissions = [
  ["Work Items · Read", "Импорт и обновление тикетов, чтение описаний, комментариев и вложений, связанных с PR тикетов."],
  ["Work Items · Read & write", "Смена статуса и исполнителя тикета в Azure, в том числе при слиянии PR. Включает чтение."],
  ["Code · Read", "Синхронизация PR, просмотр diff, коммитов и обсуждений, загрузка Git-репозитория и поиск по коду для ассистента и ревью."],
  ["Code · Read & write", "Создание и слияние PR, Abandon, перевод в Draft и обратно, отправка комментариев к строкам кода. Включает чтение."],
  ["Build · Read", "Просмотр этапов CI и логов выбранного шага. Логи загружаются только при открытии; запуск и изменение пайплайнов не нужны."],
  ["Graph · Read", "Поиск пользователей по части имени для выбора исполнителя и списков Required / Optional ревьюеров."],
  ["Identity · Read", "Поиск и сопоставление пользователей Azure: получение идентификатора для назначения исполнителя и ревьюеров."],
];

export function AzurePatPermissions() {
  return <aside className="azure-pat-permissions" aria-label="Необходимые права PAT">
    <div className="azure-pat-permissions-heading"><TriangleAlert size={18} aria-hidden="true" /><strong>Какие права выбрать для PAT</strong></div>
    <p>В Azure выберите Custom defined и отметьте права для нужных функций. Если раздел не виден, откройте Show all scopes.</p>
    <dl>{permissions.map(([name, description]) => <div key={name}><dt>{name}</dt><dd>{description}</dd></div>)}</dl>
    <p>Для всех перечисленных функций: Work Items и Code — Read &amp; write; Build, Identity и Graph — Read. Full access не требуется. Сам пользователь также должен иметь доступ к проекту, репозиторию и сборкам; обход политик слияния требует отдельного разрешения в Azure.</p>
    <p>Локальные теги, заметки и память не требуют прав на запись в Azure.</p>
    <a href="https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops#available-scopes" target="_blank" rel="noreferrer">Справочник прав Azure DevOps ↗</a>
  </aside>;
}
