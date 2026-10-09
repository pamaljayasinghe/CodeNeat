import { type ReactNode, useEffect, useId, useState } from 'react';

interface ToggleProps {
  checked: boolean;
  onChange(next: boolean): void;
  label: string;
  disabled?: boolean;
  describedBy?: string;
}

/** An accessible on/off switch. */
export function Toggle({ checked, onChange, label, disabled, describedBy }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className={`switch${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
      <span className="switch-text" aria-hidden="true">
        {checked ? 'On' : 'Off'}
      </span>
    </button>
  );
}

interface Choice {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface RadioGroupProps {
  value: string;
  choices: Choice[];
  onChange(next: string): void;
  label: string;
  disabled?: boolean;
}

export function RadioGroup({ value, choices, onChange, label, disabled }: RadioGroupProps) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="radio-group">
      {choices.map((choice) => {
        const off = disabled || choice.disabled;
        return (
          <label
            key={choice.value}
            className={`radio${value === choice.value ? ' is-selected' : ''}${off ? ' is-disabled' : ''}`}
            title={choice.disabled ? choice.disabledReason : choice.description}
          >
            <input
              type="radio"
              name={name}
              value={choice.value}
              checked={value === choice.value}
              disabled={off}
              onChange={() => onChange(choice.value)}
            />
            <span>{choice.label}</span>
          </label>
        );
      })}
    </div>
  );
}

interface SelectProps {
  value: string;
  choices: Choice[];
  onChange(next: string): void;
  label: string;
  disabled?: boolean;
  groups?: { label: string; choices: Choice[] }[];
  className?: string;
}

export function Select({ value, choices, onChange, label, disabled, groups, className }: SelectProps) {
  const option = (choice: Choice) => (
    <option key={choice.value} value={choice.value} disabled={choice.disabled}>
      {choice.label}
      {choice.disabled && choice.disabledReason ? ` — ${choice.disabledReason}` : ''}
    </option>
  );
  return (
    <select
      className={`select${className ? ` ${className}` : ''}`}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {choices.map(option)}
      {groups?.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.choices.map(option)}
        </optgroup>
      ))}
    </select>
  );
}

interface NumberFieldProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  presets?: number[];
  slider?: boolean;
  label: string;
  disabled?: boolean;
  onChange(next: number): void;
}

/** Numeric input with optional slider and quick-pick presets. Invalid text is flagged, never applied. */
export function NumberField({ value, min, max, step = 1, unit, presets, slider, label, disabled, onChange }: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  const errorId = useId();
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const parsed = Number(text);
  const valid = text.trim() !== '' && Number.isInteger(parsed) && parsed >= min && parsed <= max;
  const error = valid ? undefined : `Enter a whole number from ${min} to ${max}.`;

  const commit = (raw: string): void => {
    setText(raw);
    const next = Number(raw);
    if (raw.trim() !== '' && Number.isInteger(next) && next >= min && next <= max && next !== value) {
      onChange(next);
    }
  };

  const visiblePresets = presets?.filter((preset) => preset >= min && preset <= max) ?? [];
  const isCustom = visiblePresets.length > 0 && !visiblePresets.includes(value);

  return (
    <div className="number-field">
      {visiblePresets.length > 0 && (
        <div className="presets" role="group" aria-label={`${label} presets`}>
          {visiblePresets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={`chip${preset === value ? ' is-selected' : ''}`}
              aria-pressed={preset === value}
              disabled={disabled}
              onClick={() => commit(String(preset))}
            >
              {preset}
            </button>
          ))}
          <span className={`chip chip-static${isCustom ? ' is-selected' : ''}`}>Custom</span>
        </div>
      )}
      <div className="number-row">
        {slider && (
          <input
            type="range"
            className="slider"
            aria-label={`${label} slider`}
            min={min}
            max={max}
            step={step}
            value={valid ? parsed : value}
            disabled={disabled}
            onChange={(event) => commit(event.target.value)}
          />
        )}
        <input
          type="number"
          className={`number-input${error && !disabled ? ' has-error' : ''}`}
          aria-label={label}
          aria-invalid={!!error && !disabled}
          aria-describedby={error && !disabled ? errorId : undefined}
          min={min}
          max={max}
          step={step}
          value={text}
          disabled={disabled}
          onChange={(event) => commit(event.target.value)}
          onBlur={() => {
            if (!valid) {
              setText(String(value));
            }
          }}
        />
        {unit && <span className="unit">{unit}</span>}
      </div>
      {error && !disabled && (
        <p className="field-error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

interface TooltipProps {
  text: string;
  label?: string;
}

/** A small "i" button whose explanation appears on hover and on keyboard focus. */
export function Tooltip({ text, label = 'More information' }: TooltipProps) {
  const id = useId();
  return (
    <span className="tooltip">
      <button type="button" className="tooltip-trigger" aria-label={label} aria-describedby={id}>
        i
      </button>
      <span className="tooltip-bubble" role="tooltip" id={id}>
        {text}
      </span>
    </span>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick(): void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  title?: string;
  small?: boolean;
  ariaLabel?: string;
}

export function Button({ children, onClick, kind = 'secondary', disabled, title, small, ariaLabel }: ButtonProps) {
  return (
    <button
      type="button"
      className={`button button-${kind}${small ? ' button-small' : ''}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'info'; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Banner({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'error' }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === 'error' ? 'alert' : 'note'}>
      {children}
    </div>
  );
}

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-header">
          {title && <h3>{title}</h3>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/** A labelled row for settings that are not part of the style catalog. */
export function SettingRow({ label, description, children, htmlFor }: { label: string; description?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="option-row">
      <div className="option-text">
        <label className="option-label" htmlFor={htmlFor}>
          {label}
        </label>
        {description && <p className="option-description">{description}</p>}
      </div>
      <div className="option-control">{children}</div>
    </div>
  );
}

/** Copies a command string through the extension host and briefly confirms it. */
export function CodeLine({ text, onCopy }: { text: string; onCopy(text: string): void }) {
  return (
    <div className="code-line">
      <code>{text}</code>
      <Button small kind="ghost" onClick={() => onCopy(text)} ariaLabel={`Copy command: ${text}`}>
        Copy
      </Button>
    </div>
  );
}
