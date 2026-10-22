import { useEffect, useState } from "react";
import { Link, Check, Sparkles } from "lucide-react";

export function ImageActions({ src, onAttach }: { src: string; onAttach?: () => void }) {
  const [copied,setCopied]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{setCopied(false);setError("");},[src]);
  return <span className="image-actions" onClick={event=>event.stopPropagation()}>
    <button type="button" aria-label="Скопировать ссылку на изображение" title={copied?"Ссылка скопирована":"Скопировать ссылку на изображение"}
      onClick={async ()=>{
        try { await navigator.clipboard.writeText(new URL(src,window.location.href).href); setCopied(true); setError(""); }
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
