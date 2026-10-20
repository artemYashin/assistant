import { plainText } from "./connectors.js";
import { AppError } from "./store.js";

export function ticketAnalysisAttachment(card: any, source: string) {
  if (card.source !== source)
    throw new AppError(
      409,
      "Подключение Azure изменилось. Загрузите карточку тикета заново.",
    );
  const fields = card.fields || {};
  const attachment = {
    id: card.id,
    source: card.source,
    title: String(fields["System.Title"] || ""),
    url: card.url,
    loadedAt: card.loadedAt,
    type: fields["System.WorkItemType"] || "",
    state: fields["System.State"] || "",
    description: plainText(String(fields["System.Description"] || "")),
    acceptanceCriteria: plainText(
      String(fields["Microsoft.VSTS.Common.AcceptanceCriteria"] || ""),
    ),
    reproSteps: plainText(
      String(fields["Microsoft.VSTS.TCM.ReproSteps"] || ""),
    ),
    comments: (card.comments || []).map((comment: any) => ({
      author: comment.author || "",
      date: comment.date || "",
      text: comment.text || plainText(String(comment.richText || "")),
    })),
    attachments: (card.attachments || []).map((file: any) => ({
      name: file.name,
      image: !!file.image,
    })),
    warnings: card.warnings || [],
  };
  // Never silently drop criteria or comments from the requested analysis.
  if (JSON.stringify(attachment).length > 200000)
    throw new AppError(
      413,
      "Полный текст тикета превышает 200 000 символов. Для анализа такого объёма разделите задачу на части; содержимое не было отправлено модели.",
    );
  return attachment;
}
export type TicketAnalysisAttachment = ReturnType<
  typeof ticketAnalysisAttachment
>;
export function attachmentPreview(attachment: TicketAnalysisAttachment | null) {
  return attachment
    ? {
        id: attachment.id,
        source: attachment.source,
        title: attachment.title,
        loadedAt: attachment.loadedAt,
        characters: JSON.stringify(attachment).length,
        comments: attachment.comments.length,
        warnings: attachment.warnings,
      }
    : null;
}
