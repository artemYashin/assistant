import { randomUUID } from "node:crypto";
import { Store, AppError, type Approval } from "./store.js";
export type SendMessage = (
  chatId: string,
  body: string,
) => Promise<{ id: string }>;
export class Approvals {
  constructor(
    private store: Store,
    private send: SendMessage,
  ) {}
  propose(chatId: string, body: string) {
    const chat = this.store.db
      .prepare("SELECT * FROM chats WHERE id=?")
      .get(chatId) as { name: string } | undefined;
    if (!chat) throw new AppError(400, "Выберите существующий чат Teams");
    if (!body.trim() || body.length > 12000)
      throw new AppError(
        400,
        "Сообщение должно содержать от 1 до 12000 символов",
      );
    const id = randomUUID();
    const now = Date.now();
    this.store.db
      .prepare(
        "INSERT INTO approvals(id,chat_id,chat_name,body,created_at,expires_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        id,
        chatId,
        chat.name,
        body.trim(),
        new Date(now).toISOString(),
        new Date(now + 86400000).toISOString(),
      );
    this.store.audit("message.proposed", id);
    return {
      id,
      status: "pending",
      message: "Черновик ожидает подтверждения в веб-интерфейсе.",
    };
  }
  list() {
    this.store.db
      .prepare(
        "UPDATE approvals SET status='expired' WHERE status='pending' AND expires_at < ?",
      )
      .run(new Date().toISOString());
    return this.store.db
      .prepare("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100")
      .all();
  }
  reject(id: string) {
    const r = this.store.db
      .prepare(
        "UPDATE approvals SET status='rejected' WHERE id=? AND status='pending'",
      )
      .run(id);
    if (!r.changes) throw new AppError(409, "Черновик уже обработан");
    this.store.audit("message.rejected", id);
  }
  async approve(id: string) {
    const row = this.store.db.transaction(() => {
      const found = this.store.db
        .prepare("SELECT * FROM approvals WHERE id=?")
        .get(id) as Approval | undefined;
      if (!found) throw new AppError(404, "Черновик не найден");
      if (found.status !== "pending")
        throw new AppError(
          409,
          "Черновик уже обработан. Повторная отправка запрещена.",
        );
      if (Date.parse(found.expires_at) <= Date.now())
        throw new AppError(
          409,
          "Срок подтверждения истёк. Создайте новый черновик.",
        );
      this.store.db
        .prepare(
          "UPDATE approvals SET status='sending' WHERE id=? AND status='pending'",
        )
        .run(id);
      this.store.audit("message.approved", id);
      return found;
    })();
    try {
      const sent = await this.send(row.chat_id, row.body);
      this.store.db
        .prepare("UPDATE approvals SET status='sent',remote_id=? WHERE id=?")
        .run(sent.id, id);
      this.store.audit("message.sent", id);
      return { status: "sent", remoteId: sent.id };
    } catch {
      // No retry: even a timeout can mean the message was delivered.
      this.store.db
        .prepare("UPDATE approvals SET status='unknown',error=? WHERE id=?")
        .run(
          "Результат отправки неизвестен. Проверьте чат Teams перед созданием нового черновика.",
          id,
        );
      this.store.audit("message.unknown", id);
      throw new AppError(
        502,
        "Не удалось подтвердить доставку. Автоповтора не будет; проверьте Teams.",
      );
    }
  }
}
