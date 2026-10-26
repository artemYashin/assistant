import { StickyNote } from "lucide-react";
import { CalendarDays } from "lucide-react";
import { Activity, BookOpen, Code2, GitPullRequest, Inbox, LayoutDashboard, ShieldCheck, Ticket, Users } from "lucide-react";

export const navigation = [
  { id: "overview", label: "Обзор", icon: LayoutDashboard },
  { id: "calendar", label: "Календарь", icon: CalendarDays },
  { id: "inbox", label: "Входящие", icon: Inbox },
  { id: "tickets", label: "Тикеты", icon: Ticket },
  { id: "developers", label: "Разработчики", icon: Users },
  { id: "pullrequests", label: "Pull requests", icon: GitPullRequest },
  { id: "code", label: "Код репозитория", icon: Code2 },
  { id: "approvals", label: "Подтверждения", icon: ShieldCheck },
  { id: "memory", label: "Память", icon: BookOpen },
  { id: "notes", label: "Заметки", icon: StickyNote },
  { id: "usage", label: "Использование LLM", icon: Activity },
] as const;
