import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axeViolations, formatViolations } from '../test/axe';
import { renderUi } from '../test/render';
import {
  isKnownStatus,
  onUnknownStatus,
  PresentedStatusBadge,
  STATUS_SPECS,
  STATUS_VALUES,
  StatusBadge,
  type StatusVocabulary,
} from './status-badge';

const vocabularies = Object.keys(STATUS_VALUES) as StatusVocabulary[];

describe('StatusBadge', () => {
  it('renders every value of every vocabulary with icon, text and an announced vocabulary name', async () => {
    const { container } = renderUi(
      <div>
        {vocabularies.flatMap((v) =>
          STATUS_VALUES[v].map((value) => (
            <StatusBadge key={`${v}-${value}`} vocabulary={v} value={value as never} />
          )),
        )}
      </div>,
    );
    const badges = container.querySelectorAll('[data-vocabulary]');
    expect(badges.length).toBe(vocabularies.reduce((n, v) => n + STATUS_VALUES[v].length, 0));
    for (const b of badges) {
      expect(b.querySelector('svg')).not.toBeNull(); // not colour-only: icon …
      expect(b.textContent?.trim().length).toBeGreaterThan(0); // … and text
    }
    expect(screen.getAllByText(/Stay status:/).length).toBe(STATUS_VALUES.stay.length);
    expect(screen.getAllByText(/Payment status:/).length).toBe(STATUS_VALUES.payment.length);
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });

  it('keeps vocabularies visually distinct: same tone, different shape grammar', () => {
    const { container } = renderUi(
      <div>
        <StatusBadge vocabulary="booking" value="cancelled" />
        <StatusBadge vocabulary="stay" value="cancelled" />
        <StatusBadge vocabulary="condition" value="dirty" />
        <StatusBadge vocabulary="occupancy" value="vacant" />
        <StatusBadge vocabulary="inventory" value="sold_out" />
        <StatusBadge vocabulary="unitAvailability" value="out_of_order" />
        <StatusBadge vocabulary="payment" value="none" />
      </div>,
    );
    const classes = [...container.querySelectorAll('[data-vocabulary]')].map((el) => el.className);
    expect(new Set(classes).size).toBe(classes.length);
    // "Cancelled" exists in both booking and stay vocabularies but must never look the same.
    const [booking, stay] = classes;
    expect(booking).toContain('rounded-sm');
    expect(stay).toContain('rounded-full');
  });

  it('marks unconfirmed payment outcomes as provisional (dashed) — authorized is never shown as paid', () => {
    renderUi(
      <div>
        <StatusBadge vocabulary="payment" value="authorized" />
        <StatusBadge vocabulary="payment" value="pending_verification" />
        <StatusBadge vocabulary="payment" value="paid" />
      </div>,
    );
    expect(screen.getByText('Authorized (not paid)').parentElement?.className).toContain('border-dashed');
    expect(screen.getByText('Pending verification').parentElement?.className).toContain('border-dashed');
    expect(screen.getByText('Paid').parentElement?.className).not.toContain('border-dashed');
    expect(STATUS_SPECS.payment.paid.provisional).toBeFalsy();
  });

  it('never crashes on a value from a newer server: neutral dashed chip with the raw value, reported once', () => {
    const seen: string[] = [];
    onUnknownStatus((vocabulary, value) => seen.push(`${vocabulary}:${value}`));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { container } = renderUi(
        <div>
          <StatusBadge vocabulary="stay" value="checked_in" />
          <StatusBadge vocabulary="stay" value="checked_in" />
          <StatusBadge vocabulary="payment" value="chargeback_won" />
        </div>,
      );
      const unknown = container.querySelectorAll('[data-unknown-status]');
      expect(unknown).toHaveLength(3);
      expect(unknown[0]?.textContent).toContain('Checked in');
      expect(unknown[0]?.className).toContain('border-dashed');
      expect(unknown[0]?.getAttribute('title')).toBe('Unrecognised value “checked_in”');
      expect(seen).toEqual(['stay:checked_in', 'payment:chargeback_won']);
    } finally {
      onUnknownStatus(null);
      warn.mockRestore();
    }
  });

  it('isKnownStatus narrows only to values of that vocabulary', () => {
    expect(isKnownStatus('stay', 'in_house')).toBe(true);
    expect(isKnownStatus('stay', 'dirty')).toBe(false);
    expect(isKnownStatus('payment', 'toString')).toBe(false);
  });

  it('renders the payments module presentation; unconfirmed is dashed whatever the tone', () => {
    renderUi(
      <div>
        <PresentedStatusBadge
          presentation={{
            label: 'Recorded',
            tone: 'recorded',
            explanation: 'Not yet matched to a statement.',
            confirmed: false,
          }}
        />
        <PresentedStatusBadge
          presentation={{
            label: 'Paid',
            tone: 'success',
            explanation: 'Confirmed by the provider.',
            confirmed: true,
          }}
        />
      </div>,
    );
    expect(screen.getByText('Recorded').parentElement?.className).toContain('border-dashed');
    expect(screen.getByText('Paid').parentElement?.className).not.toContain('border-dashed');
    expect(screen.getByText('. Not yet matched to a statement.')).toBeTruthy();
  });
});
