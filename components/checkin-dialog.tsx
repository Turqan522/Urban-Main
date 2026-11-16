"use client";
import { useEffect, useRef, useState } from "react";
import { ShieldCheck, X } from "lucide-react";
import type { Shelter } from "../lib/crisis/types";
import { placeName, translate, type Language, type MessageKey } from "../lib/i18n";
export default function CheckinDialog({ shelters, initialCode, lang, busy, onClose, onCheckin }: {
    shelters: Shelter[];
    initialCode: string;
    lang: Language;
    busy: boolean;
    onClose(): void;
    onCheckin(qrCode: string): void;
}) {
    const dialog = useRef<HTMLDialogElement>(null);
    const [code, setCode] = useState(initialCode);
    const t = (key: MessageKey) => translate(lang, key);
    useEffect(() => {
        const element = dialog.current!;
        const previous = document.activeElement as HTMLElement | null;
        element.showModal();
        return () => { element.close(); previous?.focus(); };
    }, []);
    function submit(qrCode: string) { onCheckin(qrCode); onClose(); }
    return <dialog ref={dialog} className="checkin-modal" aria-labelledby="checkin-title" onCancel={onClose} onClick={e => { if (e.target === dialog.current) {
        const r = dialog.current.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
            onClose();
    } }}>
    <div className="row between"><h2 id="checkin-title">{t("checkin")}</h2><button className="icon-btn" aria-label={t("close")} onClick={onClose}><X size={18}/></button></div>
    <p>{t("qrHelp")}</p>
    <form onSubmit={e => { e.preventDefault(); submit(code); }}>
      <label>{t("qrCode")}<input autoFocus value={code} onChange={e => setCode(e.target.value)} required placeholder="QR-SHELTER-S1"/></label>
      <button className="btn dark" disabled={busy}>{t("apply")}</button>
    </form>
    <div className="checkin-options">{shelters.filter(sh => sh.open).map(sh => <button className="btn light" disabled={busy} key={sh.id} onClick={() => submit(sh.qrCode)}><ShieldCheck size={17}/><span>{placeName(lang, sh.name)}<small>{t("checkinDemo")}</small></span></button>)}</div>
  </dialog>;
}
