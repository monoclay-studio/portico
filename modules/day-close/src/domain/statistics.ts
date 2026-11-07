/**
 * Day statistics (DCL-R02 step 7) from counted facts: rooms available, sold, complimentary and house use;
 * occupancy, ADR and RevPAR with Decimal, rounded once (half up). Complimentary and house-use rooms are counted
 * but excluded from rooms sold, ADR and RevPAR (EC-DCL-034, USALI convention).
 */
import { Decimal } from '@portico/kernel';

export interface RoomCounts {
  capacity: number;
  outOfOrder: number;
  /** Paying room nights (standard stays in house). */
  sold: number;
  complimentary: number;
  houseUse: number;
}

export interface Kpis {
  available: number;
  occupancyPercent: string;
  adrMinor: number;
  revparMinor: number;
}

/** Rooms available = capacity − out of order − house use (house use is not for sale). */
export function computeKpis(rooms: RoomCounts, roomRevenueMinor: number): Kpis {
  const available = Math.max(0, rooms.capacity - rooms.outOfOrder - rooms.houseUse);
  const occupancy =
    available === 0
      ? new Decimal(0)
      : new Decimal(rooms.sold).div(available).mul(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const adr =
    rooms.sold === 0
      ? 0
      : new Decimal(roomRevenueMinor).div(rooms.sold).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  const revpar =
    available === 0
      ? 0
      : new Decimal(roomRevenueMinor).div(available).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
  return { available, occupancyPercent: occupancy.toFixed(2), adrMinor: adr, revparMinor: revpar };
}
