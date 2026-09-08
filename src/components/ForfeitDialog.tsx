import { useEffect, useRef } from 'react';

export default function ForfeitDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => { node?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="forfeit-dialog" aria-labelledby="forfeit-title" aria-describedby="forfeit-description" onCancel={(event) => { event.preventDefault(); onCancel(); }} onKeyDown={(event) => {
    if (event.key !== 'Tab') return;
    const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const first = buttons[0]; const last = buttons.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <div className="forfeit-card"><p className="eyebrow">FORFEIT / END MATCH</p><h2 id="forfeit-title">Give up this battle?</h2><p id="forfeit-description">The rival takes the win and the match ends immediately.</p><div className="forfeit-actions"><button className="cmd-button cmd-run" autoFocus onClick={onCancel}>Keep battling</button><button className="cmd-button cmd-danger" onClick={onConfirm}>Forfeit</button></div></div>
  </dialog>;
}
