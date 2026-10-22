import { useEffect, useState } from "react";
import { TicketImportSettings } from "./TicketImportSettings.js";
import { ContextSaveButton } from "./ContextSaveButton.js";
import { api } from "./api.js";
export function ProjectTicketImport({context,onSaved}:{
  context:{client:string;project:string};onSaved:()=>void;
}) {
  const [form,setForm]=useState<any>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    api("/context/ticket-import?"+new URLSearchParams(context),"GET",undefined,controller.signal)
      .then(setForm).catch(error=>{if(!controller.signal.aborted)setMessage(error.message);});
    return ()=>controller.abort();
  },[context.client,context.project]);
  if(!context.client || !context.project) return <p className="muted">Выберите заказчика и проект для настройки автоматического импорта.</p>;
  return <form className="project-import-panel" onSubmit={async event=>{
    event.preventDefault();if(!form)return;
    setBusy(true);setMessage("");
    try {
      const {azureAutoImport,azureImportAssignees,azureTypes,azureStates,typeColors,statusColors}=form;
      await api("/context/ticket-import","PUT",{context,azureAutoImport,azureImportAssignees,azureTypes,azureStates,typeColors,statusColors});
      setMessage("Настройки импорта проекта сохранены.");onSaved();
    }catch(error:any){setMessage(error.message);}finally{setBusy(false);}
  }}>
    {form && <fieldset disabled={busy} className="project-import-fields">
      <TicketImportSettings form={form} set={(key,value)=>setForm((previous:any)=>({...previous,[key]:value}))}/>
      <ContextSaveButton type="submit" busy={busy}/>
    </fieldset>}
    {message && <p role="status">{message}</p>}
  </form>;
}
