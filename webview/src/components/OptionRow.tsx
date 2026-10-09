import { useId } from 'react';
import { capabilityFor, sourceLabel } from '../../../src/shared/resolve';
import type { OptionDefinition, OptionValue, ResolvedOption } from '../../../src/shared/types';
import { formatValue, type LanguageView } from '../state';
import { Badge, Button, NumberField, RadioGroup, Select, Toggle, Tooltip } from './controls';

interface OptionControlProps {
  definition: OptionDefinition;
  value: OptionValue;
  disabled?: boolean;
  /** Enum values the formatter accepts; others are shown but disabled. */
  allowedValues?: string[];
  min?: number;
  max?: number;
  formatterName?: string;
  onChange(value: OptionValue): void;
}

/** Renders the right control (switch, radio buttons, dropdown, slider or number box) for an option. */
export function OptionControl({ definition, value, disabled, allowedValues, min, max, formatterName, onChange }: OptionControlProps) {
  if (definition.type === 'boolean') {
    return <Toggle checked={value === true} label={definition.label} disabled={disabled} onChange={onChange} />;
  }
  if (definition.type === 'number') {
    return (
      <NumberField
        label={definition.label}
        value={typeof value === 'number' ? value : definition.fallback}
        min={Math.max(definition.min, min ?? definition.min)}
        max={Math.min(definition.max, max ?? definition.max)}
        step={definition.step}
        unit={definition.unit}
        presets={definition.presets}
        slider={definition.control === 'slider'}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }
  const choices = definition.choices.map((choice) => {
    const allowed = !allowedValues || allowedValues.includes(choice.value);
    return {
      ...choice,
      disabled: !allowed,
      disabledReason: allowed ? undefined : `not supported by ${formatterName ?? 'this formatter'}`,
    };
  });
  const current = typeof value === 'string' ? value : definition.fallback;
  return definition.control === 'select' ? (
    <Select label={definition.label} value={current} choices={choices} disabled={disabled} onChange={onChange} />
  ) : (
    <RadioGroup label={definition.label} value={current} choices={choices} disabled={disabled} onChange={onChange} />
  );
}

interface OptionRowProps {
  definition: OptionDefinition;
  view: LanguageView;
  resolved: ResolvedOption;
  /** Value stored in the place currently being edited, if any. */
  slot: OptionValue | undefined;
  slotLabel: string;
  onChange(value: OptionValue): void;
  onReset(): void;
}

function sourceText(resolved: ResolvedOption): string {
  const label = sourceLabel(resolved.source);
  return resolved.sourceDetail && resolved.source !== 'editorconfig' ? `${label}: ${resolved.sourceDetail}` : label;
}

/** One setting: label, explanation, control, where the value comes from, and a reset button. */
export function OptionRow({ definition, view, resolved, slot, slotLabel, onChange, onReset }: OptionRowProps) {
  const descriptionId = useId();
  const formatter = view.formatter;
  const capability = formatter ? capabilityFor(formatter, definition.id, view.language.id) : undefined;
  const isFixed = resolved.source === 'fixed';
  const disabled = !resolved.supported || !!resolved.locked;
  const overridden = !disabled && slot !== undefined && slot !== resolved.value;
  const formatterDefault = capability ? (capability.languageDefaults?.[view.language.id] ?? capability.default ?? definition.fallback) : definition.fallback;
  const defaultValue = definition.codeneatDefault ?? formatterDefault;
  const tooltip = [
    capability ? `${formatter?.displayName} option: ${capability.native}.` : undefined,
    `Default: ${formatValue(defaultValue)}${definition.codeneatDefault !== undefined ? ' (CodeNeat default)' : ' (formatter default)'}.`,
    definition.semantic ? 'This option changes code, not just layout.' : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`option-row${disabled ? ' is-unavailable' : ''}`} data-option={definition.id}>
      <div className="option-text">
        <div className="option-heading">
          <span className="option-label">{definition.label}</span>
          <Tooltip text={tooltip} label={`About ${definition.label}`} />
          {definition.semantic && <Badge tone="warn">Changes code</Badge>}
          {resolved.supported && resolved.support === 'partial' && <Badge tone="info">Partly supported</Badge>}
          {isFixed && <Badge>Fixed by formatter</Badge>}
          {!resolved.supported && !isFixed && <Badge>Not available</Badge>}
        </div>
        <p className="option-description" id={descriptionId}>
          {definition.description}
        </p>
        {definition.example && <pre className="option-example">{definition.example.replace(/\\n/g, '\n')}</pre>}
        {resolved.unavailableReason && <p className="option-reason">{resolved.unavailableReason}</p>}
        {resolved.supported && resolved.note && <p className="option-note">{resolved.note}</p>}
        {overridden && (
          <p className="option-reason">
            Your choice here ({formatValue(slot)}) is overridden by {sourceText(resolved).toLowerCase()}.
          </p>
        )}
      </div>
      <div className="option-control" aria-describedby={descriptionId}>
        {isFixed ? (
          <span className="fixed-value">{definition.type === 'number' && resolved.value === 0 ? 'Not applicable' : formatValue(resolved.value)}</span>
        ) : (
          <OptionControl
            definition={definition}
            value={resolved.supported ? resolved.value : definition.fallback}
            disabled={disabled}
            allowedValues={capability?.values}
            min={capability?.min}
            max={capability?.max}
            formatterName={formatter?.displayName}
            onChange={onChange}
          />
        )}
        {resolved.supported && (
          <div className="option-meta">
            <span className="option-source" title="Where the value in effect comes from">
              From: {sourceText(resolved)}
            </span>
            <Button
              small
              kind="ghost"
              disabled={slot === undefined}
              title={slot === undefined ? `Nothing is set in ${slotLabel}` : `Remove this choice from ${slotLabel} (back to ${formatValue(defaultValue)} unless another setting applies)`}
              ariaLabel={`Reset ${definition.label}`}
              onClick={onReset}
            >
              Reset
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
