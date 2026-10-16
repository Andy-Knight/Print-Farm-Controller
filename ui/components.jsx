import { useEffect, useState } from 'preact/hooks';

export function UiButton({
  variant = 'secondary',
  size = 'medium',
  class:className = '',
  children,
  ...props
}) {
  const legacyVariantClass = ['primary','secondary','positive','attention','danger'].includes(variant) ? variant : '';
  const classes = ['ui-button', `ui-button-${variant}`, `ui-button-${size}`, legacyVariantClass, className]
    .filter(Boolean)
    .join(' ');
  return <button type="button" class={classes} {...props}>{children}</button>;
}

export function StatusBadge({ state = '', title = '', children }) {
  const normalized = String(state || '').toLowerCase().replace(/\s+/g, '_');
  return (
    <div
      class={`badge ui-status-badge ${normalized}`}
      data-printer-state
      data-state={normalized}
      title={title}
    >
      {children}
    </div>
  );
}

export function ProgressBar({ value = 0, label = 'Progress', class:className = '' }) {
  const progress = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div
      class={`progress ui-progress${className ? ` ${className}` : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow={String(progress)}
    >
      <span data-progress-bar style={{ width:`${progress}%` }}></span>
    </div>
  );
}

export function Metric({ label, value, labelAttributes = {}, valueAttributes = {} }) {
  return (
    <div class="metric ui-metric">
      <span {...labelAttributes}>{label}</span>
      <b {...valueAttributes}>{value}</b>
    </div>
  );
}

export function ToastHost() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (event) => {
      const detail = event?.detail || {};
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const toast = {
        id,
        tone:['success','warning','error','info'].includes(detail.tone) ? detail.tone : 'info',
        title:String(detail.title || ''),
        message:String(detail.message || '')
      };
      setToasts((current) => [...current.slice(-2), toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== id));
      }, Math.max(1800, Number(detail.durationMs || 3600)));
    };
    window.addEventListener('pfc:toast', handler);
    return () => window.removeEventListener('pfc:toast', handler);
  }, []);

  return (
    <div class="ui-toast-host" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} class={`ui-toast ui-toast-${toast.tone}`} role="status">
          <span class="ui-toast-icon" aria-hidden="true"></span>
          <div>
            {toast.title && <strong>{toast.title}</strong>}
            {toast.message && <span>{toast.message}</span>}
          </div>
          <UiButton
            variant="ghost"
            size="small"
            class="ui-toast-close"
            aria-label="Dismiss notification"
            onClick={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
          >
            ×
          </UiButton>
        </div>
      ))}
    </div>
  );
}

/**
 * Controlled form primitives. Each workflow owns its draft state, rather than
 * mutating form DOM from SSE or application-level redraw handlers.
 */
export function UiTextField({ label, id, class:className = '', ...props }) {
  return (
    <label class={className}>
      {label}
      <input id={id} type="text" {...props} />
    </label>
  );
}

export function UiCheckboxField({ class:className = '', children, ...props }) {
  return (
    <label class={className}>
      <input type="checkbox" {...props} />
      <span>{children}</span>
    </label>
  );
}
