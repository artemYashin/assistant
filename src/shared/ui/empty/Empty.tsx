import React from "react";
import { Inbox } from "lucide-react";

export function Empty({
  icon: Icon = Inbox,
  title,
  description,
  children,
}: {
  icon?: any;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={25} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
