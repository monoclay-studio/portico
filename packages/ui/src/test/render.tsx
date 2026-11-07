import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Toaster } from '../components/toast';
import { UiProvider } from '../provider';

export function renderUi(ui: ReactElement, opts: { dir?: 'ltr' | 'rtl' } = {}) {
  return render(
    <UiProvider dir={opts.dir ?? 'ltr'}>
      <Toaster>{ui}</Toaster>
    </UiProvider>,
  );
}
