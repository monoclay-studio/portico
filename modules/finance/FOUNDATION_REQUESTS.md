# Foundation requests from finance (wave 1)

## 1. `packages/testing`: teardown race when dropping a test database — RESOLVED on main

Fixed in `packages/testing`; finance's local workaround was removed.

## 2. `packages/kernel` money formatting (nice to have)

Problem messages currently quote amounts as "12345 USD (minor units)". A shared, locale-aware
`formatMoney`-for-messages helper used by every module would make problem details read naturally ("USD 123.45").
No change made; finance keeps minor units in messages for precision. (Main now has a kernel money formatter; finance
messages can adopt it in a later pass.)

## 3. `platform`: `lockBusinessDate(tx, propertyId)` (review P2-01)

Finance reads the business date without a lock; a Day Close committing D+1 in the middle of a posting command can
leave a posting stamped D after D closed. Requested: a platform provider that takes `select … for share` on the
property's business-date row, called at the start of every posting command.
