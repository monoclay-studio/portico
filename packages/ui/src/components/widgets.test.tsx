import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations, formatViolations } from '../test/axe';
import { renderUi } from '../test/render';
import { Button, IconButton } from './button';
import { Combobox } from './combobox';
import { CommandPalette, type PaletteCommand, rankCommands } from './command-palette';
import { Calendar, DatePicker, DateRangePicker } from './date-picker';
import { Field } from './field';
import { Input } from './input';
import { OfflineIndicator } from './offline-indicator';

describe('Button', () => {
  it('blocks double submission while loading and keeps its label', async () => {
    const onClick = vi.fn();
    renderUi(
      <Button loading onClick={onClick}>
        Check in
      </Button>,
    );
    const b = screen.getByRole('button', { name: /Check in/ });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('requires a name for icon buttons', () => {
    renderUi(<IconButton label="Open command palette" icon={<svg />} shortcut="Ctrl K" />);
    expect(screen.getByRole('button', { name: 'Open command palette' })).toBeInTheDocument();
  });
});

describe('Field + Input', () => {
  it('wires label, description and error for assistive technology', async () => {
    const { container } = renderUi(
      <Field label="Check-in time" description="Property local time" error="Use HH:MM, e.g. 14:00">
        <Input defaultValue="2pm" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Check-in time' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Property local time Use HH:MM, e.g. 14:00');
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });
});

const villas = [
  { value: 'wv212', label: 'Water Villa 212', keywords: ['sunset'] },
  { value: 'wv214', label: 'Water Villa 214' },
  { value: 'bv104', label: 'Beach Villa 104' },
];

describe('Combobox', () => {
  it('filters as you type and selects with arrows + Enter', async () => {
    const onValueChange = vi.fn();
    renderUi(<Combobox aria-label="Villa" options={villas} onValueChange={onValueChange} />);
    const input = screen.getByRole('combobox', { name: 'Villa' });
    await userEvent.type(input, 'water');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onValueChange).toHaveBeenCalledWith('wv214');
    expect(input).toHaveValue('Water Villa 214');
  });

  it('matches keywords and closes on Escape', async () => {
    renderUi(<Combobox aria-label="Villa" options={villas} />);
    const input = screen.getByRole('combobox', { name: 'Villa' });
    await userEvent.type(input, 'sunset');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
});

function PaletteHost({ go }: { go: (where: string) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <CommandPalette
      open={open}
      onOpenChange={setOpen}
      commands={[
        { id: 'arr', label: 'Arrivals board', group: 'Go to', onSelect: () => go('arrivals') },
        { id: 'hk', label: 'Housekeeping board', group: 'Go to', onSelect: () => go('hk') },
      ]}
    />
  );
}

describe('CommandPalette', () => {
  it('ranks prefix matches first and matches keywords', () => {
    const cmds = [
      { id: 'a', label: 'Open housekeeping board', group: 'Go to', onSelect() {} },
      { id: 'b', label: 'Arrivals board', group: 'Go to', keywords: ['front desk'], onSelect() {} },
    ] satisfies PaletteCommand[];
    expect(rankCommands(cmds, 'board').map((c) => c.id)).toEqual(['a', 'b']);
    expect(rankCommands(cmds, 'arr').map((c) => c.id)).toEqual(['b']);
    expect(rankCommands(cmds, 'front desk').map((c) => c.id)).toEqual(['b']);
  });

  it('runs the highlighted command with the keyboard', async () => {
    const go = vi.fn();
    renderUi(<PaletteHost go={go} />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    await userEvent.type(input, 'board');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await act(() => new Promise((r) => setTimeout(r, 5)));
    expect(go).toHaveBeenCalledWith('hk');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Date pickers', () => {
  it('Calendar: arrows move by day/week, Enter selects', () => {
    const onSelect = vi.fn();
    renderUi(
      <Calendar
        month="2026-11-01"
        onMonthChange={() => {}}
        selected="2026-11-07"
        onSelect={onSelect}
        autoFocus
      />,
    );
    const cell = screen.getByRole('gridcell', { name: /Saturday, November 7, 2026/ });
    expect(cell).toHaveAttribute('tabindex', '0');
    expect(cell).toHaveAttribute('aria-selected', 'true');
    act(() => cell.focus());
    fireEvent.keyDown(cell, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    fireEvent.keyDown(document.activeElement as Element, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('2026-11-15');
  });

  it('DatePicker accepts typed ISO dates and explains invalid input', async () => {
    const onValueChange = vi.fn();
    renderUi(
      <Field label="Arrival">
        <DatePicker onValueChange={onValueChange} today="2026-11-07" />
      </Field>,
    );
    const input = screen.getByRole('textbox', { name: 'Arrival' });
    await userEvent.type(input, '2026-02-30{Enter}');
    expect(screen.getByText('Enter a date as YYYY-MM-DD.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await userEvent.clear(input);
    await userEvent.type(input, '2026-11-14{Enter}');
    expect(onValueChange).toHaveBeenLastCalledWith('2026-11-14');
  });

  it('DateRangePicker selects arrival then departure and shows nights', async () => {
    const onValueChange = vi.fn();
    renderUi(<DateRangePicker aria-label="Stay dates" today="2026-11-07" onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('button', { name: /Stay dates/ }));
    await userEvent.click(screen.getByRole('gridcell', { name: /Saturday, November 14, 2026/ }));
    expect(screen.getByText('Now choose the departure date')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('gridcell', { name: /Wednesday, November 18, 2026/ }));
    expect(onValueChange).toHaveBeenCalledWith({ from: '2026-11-14', to: '2026-11-18' });
    expect(screen.getByRole('button', { name: /4 nights/ })).toBeInTheDocument();
  });
});

describe('OfflineIndicator', () => {
  it('says what is stale and that changes cannot be saved', () => {
    renderUi(
      <OfflineIndicator online={false} lastUpdatedAt="2026-11-07T05:42:00Z" timeZone="Indian/Maldives" />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Offline. You are offline. Information shown is from 10:42 and may be out of date. Changes cannot be saved',
    );
  });

  it('distinguishes an unreachable server from a lost connection', () => {
    renderUi(<OfflineIndicator online apiReachable={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('Server unreachable');
  });

  it('is silent when everything is reachable', () => {
    renderUi(<OfflineIndicator online />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
