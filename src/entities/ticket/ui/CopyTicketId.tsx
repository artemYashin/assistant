import { useState } from "react";
import { Check, Copy } from "lucide-react";
export function CopyTicketId({id}:{id:number}) {
  const [copied,setCopied]=useState(false), [error,setError]=useState(false);
  return <button type="button" className="icon-button ticket-id-copy" title={error ? "Не удалось скопировать. Повторите попытку" : copied ? "Скопировано" : "Скопировать номер тикета"}
    aria-label={`Скопировать номер тикета ${id}`} onClick={async e => {e.stopPropagation(); try {await navigator.clipboard.writeText(String(id));setCopied(true);setError(false);} catch {setError(true);} }}>
    {copied ? <Check size={12}/> : <Copy size={12}/>}</button>;
}
