import type { TxContext } from '@portico/db';
import type { DayCloseService } from './service';

/**
 * Demo data (demo environment only, registered in the composition root): every demo property gets a Day Close
 * policy that matches its profile. The guesthouse closes itself (auto-close, DCL-R09) with only blocking checks
 * surfaced; the resort runs the close by hand from 22:00 with the no-show decision left to the auditor's list.
 * Schedules stay switched off in demo organizations so nothing runs unattended on sample data.
 */
export function createDayCloseDemoSeed(service: DayCloseService) {
  return {
    name: 'day-close',
    async run(tx: TxContext, org: { properties: ReadonlyArray<{ id: string; profile: string }> }) {
      for (const p of org.properties) {
        const guesthouse = p.profile === 'guesthouse';
        const current = await service.getPolicy(tx, p.id);
        await service.updatePolicy(
          tx,
          p.id,
          {
            reason: 'Demo data: Day Close policy for this sample property',
            policy: {
              noShow: { mode: 'auto', protectDelayedTransfers: true, collectFee: 'agreed_guarantee' },
              earliestStartLocalTime: guesthouse ? '23:00' : '22:00',
              schedule: {
                enabled: false,
                localTime: guesthouse ? '23:30' : '02:00',
                autoContinue: guesthouse,
              },
              blockingCodes: guesthouse ? [] : ['payment_pending_verification'],
            },
          },
          current.version,
        );
      }
    },
  };
}
