import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

/** Permission keys (docs/specs/distribution.md §8, plus simulator control). */
export const P = {
  channelRead: 'distribution.channel.read',
  connectionManage: 'distribution.connection.manage',
  mappingManage: 'distribution.mapping.manage',
  ariResync: 'distribution.ari.resync',
  reservationRecover: 'distribution.reservation.recover',
  discrepancyResolve: 'distribution.discrepancy.resolve',
  stopSellManage: 'distribution.stopSell.manage',
  simulatorControl: 'distribution.simulator.control',
  guestDataErase: 'distribution.guestData.erase',
} as const;

/** Record types (universal record contract; `type` equals the audit target type). */
export const RECORD = {
  connection: 'distribution_connection',
  roomMapping: 'distribution_room_mapping',
  rateMapping: 'distribution_rate_mapping',
  ariMessage: 'distribution_ari_message',
  revision: 'distribution_revision',
  stopSell: 'distribution_stop_sell',
  exception: 'distribution_exception',
  discrepancy: 'distribution_discrepancy',
  simulator: 'distribution_simulator',
} as const;

export const distributionManifest: ModuleManifest = {
  name: 'distribution',
  schema: 'distribution',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  // The webhook router and the scheduler read platform.tenant_environment() (routing metadata only).
  migrateAfter: ['platform'],
  features: ['distribution.channelManager'],
  recordTypes: [
    {
      type: RECORD.connection,
      label: 'Channel connection',
      readPermission: P.channelRead,
      route: '/distribution/connections/:id',
    },
    { type: RECORD.roomMapping, label: 'Room mapping', readPermission: P.channelRead },
    { type: RECORD.rateMapping, label: 'Rate mapping', readPermission: P.channelRead },
    { type: RECORD.ariMessage, label: 'Availability and rate update', readPermission: P.channelRead },
    {
      type: RECORD.revision,
      label: 'Channel booking revision',
      readPermission: P.channelRead,
      route: '/distribution/revisions/:id',
    },
    { type: RECORD.stopSell, label: 'Stop-sell', readPermission: P.channelRead },
    { type: RECORD.exception, label: 'Distribution exception', readPermission: P.channelRead },
    { type: RECORD.discrepancy, label: 'Channel discrepancy', readPermission: P.channelRead },
    { type: RECORD.simulator, label: 'Simulated channel hub', readPermission: P.simulatorControl },
  ],
  permissions: [
    {
      key: P.channelRead,
      description:
        'View channel connections, mappings, health, the channel calendar, booking revisions, exceptions and discrepancies',
      scope: 'property',
    },
    {
      key: P.connectionManage,
      description:
        'Connect, activate, pause, resume or disconnect a channel hub; set its credential and webhook secret',
      scope: 'property',
      sensitive: true,
    },
    {
      key: P.mappingManage,
      description: 'Map unit types and rate plans to channel room types and rate plans',
      scope: 'property',
    },
    {
      key: P.ariResync,
      description: 'Re-send availability, rates and restrictions to a channel (full or date range)',
      scope: 'property',
    },
    {
      key: P.reservationRecover,
      description:
        'Recover channel bookings: pull missed revisions, retry or resolve parked and failed revisions',
      scope: 'property',
    },
    {
      key: P.discrepancyResolve,
      description: 'Resolve or accept channel discrepancies and distribution exceptions',
      scope: 'property',
    },
    {
      key: P.stopSellManage,
      description: 'Close or reopen sales on a channel (stop-sell), including releasing automatic protection',
      scope: 'property',
    },
    {
      key: P.guestDataErase,
      description:
        'Erase the guest personal data held in stored channel booking revisions (privacy request); ids, dates and amounts stay',
      scope: 'property',
      sensitive: true,
    },
    {
      key: P.simulatorControl,
      description:
        'Drive the simulated channel hub (create test bookings, inject faults) — never available in live organizations',
      scope: 'organization',
    },
  ],
};
