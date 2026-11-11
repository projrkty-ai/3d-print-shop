import { useEffect, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** Id of the dialog's heading. */
  labelledBy: string;
  onClose: () => void;
  /** False while something is being saved: Escape and clicks outside are ignored. */
  canClose?: boolean;
  /** Focused when the dialog opens (usually its Close button). */
  initialFocus: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}

/**
 * A modal dialog over the page: rendered into document.body (so sticky page parts cannot cover it),
 * closed with Escape or a click on the backdrop, with the page behind it not scrolling.
 */
export function Dialog({ labelledBy, onClose, canClose = true, initialFocus, className = '', children }: Props) {
  // Focus and page scroll change only while the dialog is open, not whenever `canClose` changes.
  useEffect(() => {
    initialFocus.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [initialFocus]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && canClose && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, canClose]);

  return createPortal(
    <div className="dialog-backdrop" onClick={(event) => event.target === event.currentTarget && canClose && onClose()}>
      <section className={`dialog card ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        {children}
      </section>
    </div>,
    document.body,
  );
}
