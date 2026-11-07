/**
 * Product naming lives in ONE place (decision D1: "Portico" is a working name). Change it here and in
 * index.html <title>.
 */
export const PRODUCT_NAME = 'Portico';
export const VENDOR_NAME = 'Monoclay';

/** Base path of the Portico API (same origin; Vite proxies it in development). */
export const API_BASE = import.meta.env.VITE_PORTICO_API_BASE ?? '';
