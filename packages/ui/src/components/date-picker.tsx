import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import {
  addDays,
  addMonths,
  dayOfWeek,
  diffDays,
  isLocalDate,
  type LocalDate,
  monthMatrix,
  startOfMonth,
  toUtcDate,
} from '../lib/dates';
import { formatLocalDate } from '../lib/format';
import { useControllableState } from '../lib/hooks';
import { useUi } from '../provider';
import { fmt } from '../strings';
import { IconButton } from './button';
import { fieldControlProps, useField } from './field';
import { controlClass } from './input';
import { Popover } from './popover';

export interface DateRange {
  from: LocalDate;
  /** Exclusive end (departure date): nights are [from, to). */
  to: LocalDate;
}

export interface CalendarProps {
  /** Selected single date. */
  selected?: LocalDate | null | undefined;
  /** Selected range (half-open). A range with only `from` is in progress. */
  range?: { from: LocalDate; to?: LocalDate | undefined } | null | undefined;
  onSelect: (date: LocalDate) => void;
  /** Month shown first (any date in it). */
  month: LocalDate;
  onMonthChange: (month: LocalDate) => void;
  min?: LocalDate | undefined;
  max?: LocalDate | undefined;
  isDateDisabled?: ((date: LocalDate) => boolean) | undefined;
  /** Business date / today marker (never read from the browser clock: the property's business date matters). */
  today?: LocalDate | undefined;
  months?: 1 | 2;
  autoFocus?: boolean;
}

/** Month grid following the WAI-ARIA date picker dialog pattern. */
export function Calendar({
  selected,
  range,
  onSelect,
  month,
  onMonthChange,
  min,
  max,
  isDateDisabled,
  today,
  months = 1,
  autoFocus,
}: CalendarProps) {
  const { strings, locale, weekStartsOn, dir } = useUi();
  const initialFocus = selected ?? range?.to ?? range?.from ?? today ?? month;
  const [focused, setFocused] = useState<LocalDate>(initialFocus);
  const [hover, setHover] = useState<LocalDate | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const shouldFocus = useRef(Boolean(autoFocus));

  useEffect(() => {
    if (!shouldFocus.current) return;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-date="${focused}"]`);
    el?.focus();
  }, [focused]);

  const disabled = (d: LocalDate) => (min && d < min) || (max && d > max) || Boolean(isDateDisabled?.(d));

  const moveFocus = (next: LocalDate) => {
    shouldFocus.current = true;
    setFocused(next);
    const first = startOfMonth(month);
    const last = addMonths(first, months);
    if (next < first) onMonthChange(startOfMonth(next));
    else if (next >= last) onMonthChange(addMonths(startOfMonth(next), -(months - 1)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const rtl = dir === 'rtl';
    const offset = (dayOfWeek(focused) - weekStartsOn + 7) % 7;
    let target: LocalDate | null = null;
    switch (e.key) {
      case 'ArrowLeft':
        target = addDays(focused, rtl ? 1 : -1);
        break;
      case 'ArrowRight':
        target = addDays(focused, rtl ? -1 : 1);
        break;
      case 'ArrowUp':
        target = addDays(focused, -7);
        break;
      case 'ArrowDown':
        target = addDays(focused, 7);
        break;
      case 'Home':
        target = addDays(focused, -offset);
        break;
      case 'End':
        target = addDays(focused, 6 - offset);
        break;
      case 'PageUp':
        target = addMonths(focused, e.shiftKey ? -12 : -1);
        break;
      case 'PageDown':
        target = addMonths(focused, e.shiftKey ? 12 : 1);
        break;
    }
    if (target) {
      e.preventDefault();
      moveFocus(target);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!disabled(focused)) onSelect(focused);
    }
  };

  const weekdayNames = useMemo(() => {
    const base = '2026-11-01'; // a Sunday
    return Array.from({ length: 7 }, (_, i) => {
      const d = toUtcDate(addDays(base, (weekStartsOn + i) % 7));
      return {
        short: new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' }).format(d),
        long: new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(d),
      };
    });
  }, [locale, weekStartsOn]);

  const rangeEnd = range?.to ?? (range?.from && hover && hover > range.from ? hover : undefined);
  const inRange = (d: LocalDate) => Boolean(range?.from && rangeEnd && d >= range.from && d < rangeEnd);

  const monthStarts = Array.from({ length: months }, (_, i) => addMonths(startOfMonth(month), i));

  return (
    <div ref={gridRef} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <IconButton
          size="sm"
          label={strings.datePicker.previousMonth}
          icon={dir === 'rtl' ? <ChevronRight /> : <ChevronLeft />}
          onClick={() => onMonthChange(addMonths(startOfMonth(month), -1))}
        />
        <IconButton
          size="sm"
          label={strings.datePicker.nextMonth}
          icon={dir === 'rtl' ? <ChevronLeft /> : <ChevronRight />}
          onClick={() => onMonthChange(addMonths(startOfMonth(month), 1))}
        />
      </div>
      <div className="flex flex-wrap gap-4">
        {monthStarts.map((m) => {
          const headingId = `cal-${m}`;
          const monthOf = m.slice(0, 7);
          return (
            <div key={m} className="flex flex-col gap-1">
              <h2 id={headingId} aria-live="polite" className="text-center text-sm font-semibold">
                {new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
                  toUtcDate(m),
                )}
              </h2>
              <table
                role="grid"
                aria-labelledby={headingId}
                className="border-collapse"
                onKeyDown={onKeyDown}
              >
                <thead>
                  <tr>
                    {weekdayNames.map((w) => (
                      <th
                        key={w.long}
                        scope="col"
                        abbr={w.long}
                        className="size-9 text-xs font-medium text-ink-muted"
                      >
                        {w.short}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthMatrix(m, weekStartsOn).map((week) => (
                    <tr key={week[0]}>
                      {week.map((d) => {
                        const outside = d.slice(0, 7) !== monthOf;
                        if (outside) return <td key={d} className="size-9" />;
                        const isSelected = d === selected || d === range?.from || d === range?.to;
                        const isDisabled = disabled(d);
                        const isFocusTarget = d === focused;
                        return (
                          <td
                            key={d}
                            data-date={d}
                            role="gridcell"
                            tabIndex={isFocusTarget ? 0 : -1}
                            aria-selected={isSelected || inRange(d) || undefined}
                            aria-disabled={isDisabled || undefined}
                            aria-current={d === today ? 'date' : undefined}
                            aria-label={formatLocalDate(d, locale, 'long')}
                            data-focus-inset
                            onFocus={() => setFocused(d)}
                            onMouseEnter={() => setHover(d)}
                            onClick={() => !isDisabled && onSelect(d)}
                            className={cn(
                              'pt-tabular size-9 cursor-pointer rounded-md text-center text-sm',
                              inRange(d) && 'rounded-none bg-accent-soft',
                              isSelected && 'rounded-md bg-accent font-semibold text-on-accent',
                              !isSelected && !isDisabled && 'hover:bg-surface-hover',
                              isDisabled && 'cursor-not-allowed text-ink-subtle line-through',
                              d === today &&
                                !isSelected &&
                                'font-semibold underline decoration-2 underline-offset-4',
                            )}
                          >
                            {Number(d.slice(8))}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export interface DatePickerProps {
  value?: LocalDate | null | undefined;
  defaultValue?: LocalDate | null;
  onValueChange?: (value: LocalDate | null) => void;
  min?: LocalDate;
  max?: LocalDate;
  today?: LocalDate;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}

/** Date input: type YYYY-MM-DD or pick from the calendar. Values are LocalDate strings (no time zone). */
export function DatePicker({
  value: valueProp,
  defaultValue = null,
  onValueChange,
  min,
  max,
  today,
  disabled,
  id,
  ...aria
}: DatePickerProps) {
  const { strings, locale } = useUi();
  const field = useField();
  const [value, setValue] = useControllableState<LocalDate | null>({
    value: valueProp,
    defaultValue,
    onChange: onValueChange,
  });
  const [text, setText] = useState(value ?? '');
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<LocalDate>(value ?? today ?? '2026-01-01');
  const hintId = useId();

  useEffect(() => setText(value ?? ''), [value]);

  const commitText = () => {
    if (text === '') {
      setInvalid(false);
      setValue(null);
    } else if (isLocalDate(text) && !(min && text < min) && !(max && text > max)) {
      setInvalid(false);
      setValue(text);
    } else setInvalid(true);
  };

  const controlProps = fieldControlProps(field, { id });
  const describedBy = [
    controlProps['aria-describedby' as keyof typeof controlProps],
    invalid ? hintId : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          disabled={disabled}
          value={text}
          aria-label={aria['aria-label']}
          className={cn(controlClass, 'pt-tabular pe-24')}
          {...controlProps}
          aria-describedby={describedBy || undefined}
          aria-invalid={
            invalid || controlProps['aria-invalid' as keyof typeof controlProps] ? true : undefined
          }
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitText();
            if (e.key === 'ArrowDown' && e.altKey) {
              e.preventDefault();
              setOpen(true);
            }
          }}
        />
        <div className="absolute inset-y-0 end-0 flex items-center gap-1 pe-1">
          {value && (
            <span aria-hidden className="text-xs text-ink-muted">
              {new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
                toUtcDate(value),
              )}
            </span>
          )}
          <Popover
            open={open}
            onOpenChange={(o) => {
              setOpen(o);
              if (o) setMonth(value ?? today ?? month);
            }}
            label={strings.datePicker.chooseDate}
            align="end"
            trigger={
              <IconButton
                size="sm"
                disabled={disabled}
                label={strings.datePicker.chooseDate}
                icon={<CalendarDays />}
              />
            }
          >
            <Calendar
              autoFocus
              selected={value}
              month={month}
              onMonthChange={setMonth}
              min={min}
              max={max}
              today={today}
              onSelect={(d) => {
                setValue(d);
                setInvalid(false);
                setOpen(false);
              }}
            />
          </Popover>
        </div>
      </div>
      {invalid && (
        <p id={hintId} className="text-xs font-medium text-danger-fg">
          {strings.datePicker.invalid}
        </p>
      )}
    </div>
  );
}

export interface DateRangePickerProps {
  value?: DateRange | null | undefined;
  defaultValue?: DateRange | null;
  onValueChange?: (value: DateRange | null) => void;
  min?: LocalDate;
  max?: LocalDate;
  today?: LocalDate;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}

/** Arrival → departure picker. Ranges are half-open nights [from, to); the trigger shows the night count. */
export function DateRangePicker({
  value: valueProp,
  defaultValue = null,
  onValueChange,
  min,
  max,
  today,
  disabled,
  id,
  ...aria
}: DateRangePickerProps) {
  const { strings, locale } = useUi();
  const field = useField();
  const [value, setValue] = useControllableState<DateRange | null>({
    value: valueProp,
    defaultValue,
    onChange: onValueChange,
  });
  const [draft, setDraft] = useState<{ from: LocalDate; to?: LocalDate } | null>(value);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<LocalDate>(value?.from ?? today ?? '2026-01-01');

  const nights = value ? diffDays(value.from, value.to) : 0;
  const label = value
    ? `${formatLocalDate(value.from, locale, 'short')} → ${formatLocalDate(value.to, locale, 'short')} · ${
        nights === 1 ? strings.datePicker.night : fmt(strings.datePicker.nights, { count: nights })
      }`
    : strings.datePicker.chooseDates;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setDraft(value);
          setMonth(value?.from ?? today ?? month);
        }
      }}
      label={strings.datePicker.chooseDates}
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={aria['aria-label'] ? `${aria['aria-label']}: ${label}` : undefined}
          className={cn(controlClass, 'pt-tabular inline-flex items-center gap-2 text-start')}
          {...fieldControlProps(field, { id })}
        >
          <CalendarDays aria-hidden className="size-4 text-ink-muted" />
          <span className={cn(!value && 'text-ink-subtle')}>{label}</span>
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-xs text-ink-muted" aria-live="polite">
          {draft && !draft.to ? strings.datePicker.selectEnd : ' '}
        </p>
        <Calendar
          autoFocus
          months={2}
          range={draft}
          month={month}
          onMonthChange={setMonth}
          min={min}
          max={max}
          today={today}
          onSelect={(d) => {
            if (!draft || draft.to || d <= draft.from) {
              setDraft({ from: d });
            } else {
              const next = { from: draft.from, to: d };
              setDraft(next);
              setValue(next);
              setOpen(false);
            }
          }}
        />
      </div>
    </Popover>
  );
}
