import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axeViolations, formatViolations } from '../test/axe';
import { renderUi } from '../test/render';
import { EnvironmentBanner, NON_LIVE_ENVIRONMENTS } from './environment-banner';
import { PROVENANCE_KINDS, ProvenanceBadge } from './provenance-badge';

describe('ProvenanceBadge', () => {
  it('names every provenance kind with its explanation', async () => {
    const { container } = renderUi(
      <div>
        {PROVENANCE_KINDS.map((p) => (
          <ProvenanceBadge key={p} provenance={p} />
        ))}
      </div>,
    );
    for (const p of PROVENANCE_KINDS)
      expect(container.querySelector(`[data-provenance="${p}"]`)).not.toBeNull();
    expect(
      screen.getByRole('button', { name: /Data source: Simulated\. Sample data produced by a simulator/ }),
    ).toBeInTheDocument();
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });

  it('hatches simulated data so it cannot be mistaken for live', () => {
    const { container } = renderUi(<ProvenanceBadge provenance="simulated" />);
    expect(container.querySelector('[data-provenance="simulated"]')?.className).toContain('pt-hatch');
  });

  it('shows the external system and last sync time', () => {
    renderUi(
      <ProvenanceBadge
        provenance="external"
        system="Legacy PMS"
        lastSyncedAt="2026-11-07T10:00:00Z"
        now={new Date('2026-11-07T10:03:00Z')}
      />,
    );
    const badge = screen.getByRole('button', { name: /External/ });
    expect(badge).toHaveTextContent('Legacy PMS');
    expect(badge).toHaveTextContent(/last synced 3 min\. ago/);
  });
});

describe('EnvironmentBanner', () => {
  it('renders nothing in live', () => {
    const { container } = renderUi(<EnvironmentBanner environment="live" />);
    expect(container.querySelector('[data-environment]')).toBeNull();
  });

  it.each(NON_LIVE_ENVIRONMENTS)('is an unmistakable, persistent region in %s', async (env) => {
    const { container } = renderUi(
      <EnvironmentBanner environment={env} organizationName="Azure Atoll Collection" />,
    );
    const region = screen.getByRole('region', { name: new RegExp(`Environment: ${env}`, 'i') });
    expect(region).toHaveTextContent(/Azure Atoll Collection/);
    expect(region.className).toContain('pt-hatch');
    expect(region.querySelector('button')).toBeNull(); // cannot be dismissed
    expect(container.querySelector(`[data-environment-frame="${env}"]`)).not.toBeNull();
    const v = await axeViolations(container);
    expect(v, formatViolations(v)).toEqual([]);
  });
});
