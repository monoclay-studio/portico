#!/usr/bin/env node
// Demo authenticator (like a phone authenticator app) for DEMO organizations only (ADR-0017 rule 16).
// Prints the current 6-digit sign-in code for the public demo secret. Never valid outside demo organizations.
import { createHmac } from 'node:crypto';

const SECRET = 'PORTICODEMOAUTHENTICATORDEMOKEYS'; // public demo secret, printed by the demo CLI
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let bits = '';
for (const c of SECRET) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
const key = Buffer.from(bits.match(/.{8}/g).map((b) => Number.parseInt(b, 2)));
const step = Math.floor(Date.now() / 1000 / 30);
const msg = Buffer.alloc(8);
msg.writeBigUInt64BE(BigInt(step));
const h = createHmac('sha1', key).update(msg).digest();
const o = h[h.length - 1] & 0xf;
const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
const left = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`${code}  (valid for ${left}s more; demo organizations only)`);
