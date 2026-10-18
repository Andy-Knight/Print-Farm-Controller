import { useEffect, useState } from 'preact/hooks';

export function UiButton({
  variant = 'secondary',
  size = 'medium',
  class:className = '',
  busy = false,
  children,
  ...props
}) {
  // Preserve legacy action classes and data-* attributes for delegated clicks
  // while all newly migrated workflows gain a consistent pending state.
  const legacyVariantClass = ['primary','secondary','positive','attention','danger'].includes(variant) ? variant : '';
  const classes = ['ui-button', `ui-button-${variant}`, `ui-button-${size}`, legacyVariantClass, className]
    .filter(Boolean)
    .join(' ');
  return <button type="button" class={classes} {...props}
    disabled={Boolean(props.disabled || busy)} aria-busy={busy ? 'true' : undefined}>
    {busy && <span class="ui-button-spinner" aria-hidden="true"></span>}
    {children}
  </button>;
}

/**
 * Shared Preact tab button. Page-owned selection, click handlers and ARIA
 * relationships are preserved; the same data-pfc-icon contract is used by
 * the static/no-bundle fallback. Styling lives in tab-navigation.css.
 */
export function UiTab({ icon = '', class:className = '', children, ...props }) {
  return <UiButton variant="ghost" class={className} data-pfc-icon={icon || undefined} {...props}>
    {children}
  </UiButton>;
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

/**
 * Shared noninteractive panel primitive. Use the same surface class and
 * tokens in every new Preact screen, without changing existing controllers.
 */
export function UiSurface({ as:Tag = 'div', tone = 'default', padded = false, class:className = '', children, ...props }) {
  const classes = ['ui-surface', `ui-surface-${tone}`, padded ? 'ui-surface-pad' : '', className]
    .filter(Boolean).join(' ');
  return <Tag class={classes} {...props}>{children}</Tag>;
}

export function UiSectionHeading({ title, description, actions, as:Tag = 'h2', class:className = '' }) {
  return <header class={['ui-section-heading',className].filter(Boolean).join(' ')}>
    <div><Tag>{title}</Tag>{description && <p>{description}</p>}</div>
    {actions && <div class="ui-section-actions">{actions}</div>}
  </header>;
}

export function UiEmptyState({ title, description, children, class:className = '' }) {
  return <div class={['ui-empty-state',className].filter(Boolean).join(' ')}>
    <strong>{title}</strong>
    {description && <p>{description}</p>}
    {children}
  </div>;
}

export function UiInlineMessage({ tone = 'info', children, ...props }) {
  const safeTone = ['success','warning','error','info'].includes(tone) ? tone : 'info';
  return <div class="ui-inline-message" data-tone={safeTone}
    role={safeTone === 'error' ? 'alert' : 'status'} {...props}>{children}</div>;
}

export function UiSkeleton({ width = '100%', height = '16px', class:className = '' }) {
  // Decorative placeholder only; the surrounding region owns loading text.
  return <span class={['ui-skeleton',className].filter(Boolean).join(' ')}
    style={{width,height}} aria-hidden="true"></span>;
}

export function Metric({ label, value, labelAttributes = {}, valueAttributes = {} }) {
  return (
    <UiSurface tone="muted" class="metric ui-metric">
      <span {...labelAttributes}>{label}</span>
      <b {...valueAttributes}>{value}</b>
    </UiSurface>
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
export function UiTextField({ label, id, inputRef, class:className = '', ...props }) {
  return (
    <label class={className}>
      {label}
      <input id={id} ref={inputRef} type="text" {...props} />
    </label>
  );
}

export function UiSelectField({ label, id, hint = '', error = '', options = [], class:className = '', ...props }) {
  const describedBy = (error || hint) && id ? `${id}-hint` : undefined;
  return <label class={['ui-form-field',className].filter(Boolean).join(' ')}>
    <span class="ui-form-label">{label}</span>
    <select id={id} aria-invalid={error ? 'true' : undefined}
      aria-describedby={describedBy} {...props}>
      {options.map((item) => <option key={item.value} value={item.value}
        disabled={Boolean(item.disabled)}>{item.label}</option>)}
    </select>
    {(error || hint) && <small id={describedBy} class="ui-field-hint">{error || hint}</small>}
  </label>;
}

export function UiCheckboxField({ class:className = '', children, ...props }) {
  return (
    <label class={className}>
      <input type="checkbox" {...props} />
      <span>{children}</span>
    </label>
  );
}
