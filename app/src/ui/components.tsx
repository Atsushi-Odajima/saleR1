import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import iconsSvg from './icons.svg?raw';
import { cpLength } from '../domain/text';
import { useSaveState } from '../app/saveStatus';

let spriteInjected = false;
function injectSprite() {
  if (spriteInjected || typeof document === 'undefined') return;
  spriteInjected = true;
  const div = document.createElement('div');
  div.setAttribute('aria-hidden', 'true');
  div.style.display = 'none';
  div.innerHTML = iconsSvg.replace(/<symbol id="/g, '<symbol id="i-');
  document.body.prepend(div);
}

export type IconName = 'import' | 'quote' | 'link' | 'report' | 'check' | 'warning' | 'close' | 'arrow' | 'backup' | 'search' | 'more' | 'up' | 'down' | 'trash';

export function Icon({ name, size = 20, label }: { name: IconName; size?: 16 | 20 | 24; label?: string }) {
  injectSprite();
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label} focusable="false">
      <use href={`#i-${name}`} />
    </svg>
  );
}

export function Notice({ kind, children, title }: { kind: 'warning' | 'error' | 'success' | 'info'; children: ReactNode; title?: string }) {
  const icon: IconName = kind === 'success' ? 'check' : kind === 'info' ? 'quote' : 'warning';
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <Icon name={icon} />
      <div>
        {title && <p><strong>{title}</strong></p>}
        {children}
      </div>
    </div>
  );
}

export function SaveStatusView() {
  const s = useSaveState();
  let text = '';
  let cls = '';
  let icon: IconName | null = null;
  if (s.kind === 'editing') text = '編集中';
  else if (s.kind === 'saving') text = '保存中…';
  else if (s.kind === 'saved') {
    text = 'この端末に保存済み';
    cls = 'saved';
    icon = 'check';
  } else if (s.kind === 'error') {
    text = '未保存';
    cls = 'error';
    icon = 'warning';
  }
  return (
    <span className={`save-status ${cls}`} role="status" aria-live="polite">
      {icon && <Icon name={icon} size={16} />}
      <span>{text}</span>
    </span>
  );
}

/** Accessible modal: focus moves in, Tab is trapped, Esc closes, focus returns to the opener. */
export function Dialog({ title, onClose, children, actions, wide, busy, describedBy }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean; busy?: boolean; describedBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const opener = useRef<Element | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useLayoutEffect(() => {
    opener.current = document.activeElement;
    const el = ref.current!;
    const first = el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])');
    (first ?? el).focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      const o = opener.current as HTMLElement | null;
      if (o && typeof o.focus === 'function' && document.contains(o)) o.focus();
    };
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !busy) {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(ref.current!.querySelectorAll<HTMLElement>('input:not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled]),[href],[tabindex]:not([tabindex="-1"])')).filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCloseRef.current()}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy} aria-busy={busy || undefined} ref={ref} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="btn btn-quiet btn-icon" onClick={() => onCloseRef.current()} aria-label="閉じる" disabled={busy}>
            <Icon name="close" />
          </button>
        </div>
        {children}
        {actions && <div className="dialog-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

interface FieldBase {
  label: string;
  hint?: string;
  error?: string | undefined;
  max?: number;
  required?: boolean;
}

export function TextField({ label, hint, error, max, value, onChange, onBlur, disabled, type = 'text', required, autoComplete, inputMode, id: idProp, autoFocus }: FieldBase & { value: string; onChange: (v: string) => void; onBlur?: () => void; disabled?: boolean; type?: string; autoComplete?: string; inputMode?: 'text' | 'numeric'; id?: string; autoFocus?: boolean }) {
  const gen = useId();
  const id = idProp ?? gen;
  const n = cpLength(value);
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span className="muted">（必須）</span>}
      </label>
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
      <input
        id={id}
        className="input"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined}
        autoComplete={autoComplete ?? 'off'}
        inputMode={inputMode}
        data-autofocus={autoFocus || undefined}
        spellCheck={false}
      />
      {max !== undefined && <div className="counter" aria-hidden="true">{n} / {max}</div>}
      {error && (
        <p className="field-error" id={`${id}-err`}>
          <Icon name="warning" size={16} />
          {error}
        </p>
      )}
    </div>
  );
}

export function TextArea({ label, hint, error, max, value, onChange, onBlur, disabled, long, required, autoFocus }: FieldBase & { value: string; onChange: (v: string) => void; onBlur?: () => void; disabled?: boolean; long?: boolean; autoFocus?: boolean }) {
  const id = useId();
  const n = cpLength(value);
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span className="muted">（必須）</span>}
      </label>
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
      <textarea
        id={id}
        className={`textarea${long ? ' long' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hint ? `${id}-hint` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined}
        data-autofocus={autoFocus || undefined}
      />
      {max !== undefined && <div className="counter" aria-hidden="true">{n} / {max}</div>}
      {error && (
        <p className="field-error" id={`${id}-err`}>
          <Icon name="warning" size={16} />
          {error}
        </p>
      )}
    </div>
  );
}

export function lengthError(v: string, min: number, max: number, label: string): string | undefined {
  const n = cpLength(v);
  if (min > 0 && v.trim() === '') return `${label}を入力してください`;
  if (n > max) return `${label}は${max}文字までです（現在${n}文字）`;
  return undefined;
}

/** Prevents double submission and exposes busy state (spinner text only after 400 ms). */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const running = useRef(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    const t = setTimeout(() => setSlow(true), 400);
    try {
      return await fn();
    } finally {
      clearTimeout(t);
      running.current = false;
      setBusy(false);
      setSlow(false);
    }
  }, []);
  return { busy, slow, run };
}

export function DisabledReason({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p className="disabled-reason" id={id}>
      {children}
    </p>
  );
}

export function useDocumentTitle(t: string) {
  useEffect(() => {
    document.title = t ? `${t} | Koeito` : 'Koeito';
  }, [t]);
}

export function LiveRegion({ message }: { message: string }) {
  return (
    <div className="visually-hidden" role="status" aria-live="polite">
      {message}
    </div>
  );
}
