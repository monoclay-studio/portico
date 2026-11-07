import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// jsdom lacks layout APIs that Radix and the virtualizer use.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollTo ??= () => {};
globalThis.CSS ??= { escape: (s: string) => s } as unknown as typeof CSS;
CSS.escape ??= (s: string) => s;

// Give virtualized scroll containers a viewport so rows render in tests.
const originalRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function (this: Element) {
  if (this instanceof HTMLElement && this.dataset.scroller !== undefined) {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1200,
      bottom: 600,
      width: 1200,
      height: 600,
      toJSON() {},
    } as DOMRect;
  }
  return originalRect.call(this);
};
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return this.dataset.scroller !== undefined ? 600 : 0;
  },
});
// axe probes canvas for icon ligatures; jsdom has no canvas.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
