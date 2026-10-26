import { api } from "../../../shared/api/http/index.js";
import { useEffect, useState } from "react";
import { Link, Check, Sparkles } from "lucide-react";

export function ImageActions({ src, onAttach }: { src: string; onAttach?: () => void }) {
  const [copied,setCopied]=useState(false);
  const [error,setError]=useState("");
  const [source,setSource]=useState<{src:string;url:string}|null>(null);
  useEffect(()=>{
    setCopied(false);setError("");setSource(null);
    const controller=new AbortController();
    try {
      const url=new URL(src,window.location.href);
      if(url.origin===window.location.origin) {
        if(/^\/api\/ticket-cards\/[^/]+\/attachments\/[^/]+$/.test(url.pathname)) {
          api(url.pathname.slice(4)+"/source","GET",undefined,controller.signal)
            .then(result=>{if(!controller.signal.aborted)setSource({src,url:result.url});})
            .catch(()=>{});
        } else if(url.pathname==="/api/pr/image") {
          const original=url.searchParams.get("original") || url.searchParams.get("source");
          if(original) {
            const external=new URL(original);
            if(["http:","https:"].includes(external.protocol) && external.origin!==window.location.origin)
              setSource({src,url:external.href});
          }
        }
      } else if(["http:","https:"].includes(url.protocol)) setSource({src,url:url.href});
    } catch {}
    return ()=>controller.abort();
  },[src]);
  const copyUrl=source?.src===src?source.url:"";
  return <span className="image-actions" onClick={event=>event.stopPropagation()}>
    <button type="button" aria-label="Скопировать ссылку на изображение" disabled={!copyUrl} title={!copyUrl?"Внешняя ссылка недоступна: изображение локальное или источник не загружен":copied?"Ссылка скопирована":"Скопировать исходную ссылку на изображение"}
      onClick={async ()=>{
        try { await navigator.clipboard.writeText(copyUrl); setCopied(true); setError(""); }
        catch { setError("Не удалось скопировать ссылку."); }
      }}>{copied?<Check size={14}/>:<Link size={14}/>}</button>
    <button type="button" aria-label="Прикрепить изображение к чату" title="Прикрепить изображение к текущему чату"
      onClick={()=>{
        window.dispatchEvent(new CustomEvent("orbit:attach-image",{detail:{src}}));
        onAttach?.();
      }}><Sparkles size={14}/></button>
    {error && <span role="alert" className="image-action-error">{error}</span>}
  </span>;
}
