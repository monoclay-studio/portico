/**
 * Operations' read model of stays is fed by events that can arrive late, retried or reordered. A stay's status
 * may only move forward unless the event proves it is newer (aggregateVersion), so a late `checkedIn` can never
 * re-occupy a vacated unit and a booking modification can never reset an in-house stay to "expected".
 */
export type ProjectedStayStatus = 'expected' | 'in_house' | 'departed' | 'cancelled' | 'no_show';

const FORWARD: Record<ProjectedStayStatus, readonly ProjectedStayStatus[]> = {
  expected: ['in_house', 'departed', 'cancelled', 'no_show'],
  in_house: ['departed'],
  departed: [],
  cancelled: [],
  no_show: [],
};

/**
 * @param ordered true when the event carried an aggregateVersion newer than the last applied one — then it is
 *   authoritative (e.g. a reinstated stay may legitimately go back to in-house).
 */
export function nextStayStatus(
  previous: ProjectedStayStatus | null,
  incoming: ProjectedStayStatus | undefined,
  ordered: boolean,
): ProjectedStayStatus {
  if (!incoming) return previous ?? 'expected';
  if (!previous || ordered || previous === incoming) return incoming;
  return FORWARD[previous].includes(incoming) ? incoming : previous;
}
