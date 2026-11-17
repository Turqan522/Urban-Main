"use client";
import { useEffect, useState } from "react";
import type { Language } from "../lib/i18n";
type RequestRow = {id:string;username:string;created_at:number};
export default function OperatorRequests({token,lang}:{token:string;lang:Language}) {
 const [items,setItems]=useState<RequestRow[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 async function load(){try{const r=await fetch('/api/operator/requests',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});if(!r.ok)throw new Error();const data=await r.json() as {requests:RequestRow[]};setItems(data.requests);setError('');}catch{setError(lang==='az'?'Müraciətləri yükləmək olmadı.':'Could not load requests.');}}
 useEffect(()=>{void load();},[token]);
 async function approve(id:string){setBusy(true);try{const r=await fetch('/api/operator/approve',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({id})});if(!r.ok)throw new Error();await load();}catch{setError(lang==='az'?'Təsdiqləmə alınmadı.':'Approval failed.');}finally{setBusy(false);}}
 return <section className="panel account-panel"><div className="account-header"><h2>{lang==='az'?'Operator müraciətləri':'Operator requests'}</h2><button className="btn light small" onClick={()=>void load()}>{lang==='az'?'Yenilə':'Refresh'}</button></div><p>{lang==='az'?'Yalnız tanıdığınız şəxslərə operator səlahiyyəti verin. Təsdiqdən sonra onlar öz şifrələri ilə dispetçer girişindən istifadə edə bilər.':'Approve only trusted people. They can then sign in as dispatchers with their own password.'}</p>{error&&<p role="alert" className="account-error">{error}</p>}{items.length ? items.map(item=><div className="account-header operator-request" key={item.id}><strong>{item.username}</strong><button className="btn dark small" disabled={busy} onClick={()=>void approve(item.id)}>{lang==='az'?'Təsdiqlə':'Approve'}</button></div>) : <p>{lang==='az'?'Gözləyən müraciət yoxdur.':'No pending requests.'}</p>}</section>;
}
