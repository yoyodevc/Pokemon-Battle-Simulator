import { useEffect, useRef, type ReactNode } from 'react';

export default function Modal({ label, close, children }: { label: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="lg-modal" aria-label={label} onCancel={close} onClose={close}>{children}</dialog>;
}
