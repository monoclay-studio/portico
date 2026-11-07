/**
 * Operations' provider functions in the shape reservations' `OperationsPort` reads (owning direction: operations
 * adapts its richer views; reservations never imports operations). ADR-0015: reservations authorizes its own
 * command; these provider calls do not re-check operations' keys. A task kind operations does not know becomes a
 * `general` task with the original kind kept in the description.
 */
import type { TxContext } from '@portico/db';
import type { EntityRef } from '@portico/kernel';
import { TASK_KINDS, type TaskKind, type TaskPriority, type UnitCondition } from './domain/model';
import type { OperationsService } from './service';

export function operationsForReservations(service: Pick<OperationsService, 'getUnitCondition' | 'createTask'>) {
  return {
    async getUnitCondition(
      tx: TxContext,
      unitId: string,
    ): Promise<{ condition: UnitCondition; inspectedAt?: string; discrepancy?: string }> {
      const c = await service.getUnitCondition(tx, unitId);
      return {
        condition: c.condition,
        ...(c.inspectedAt ? { inspectedAt: c.inspectedAt } : {}),
        ...(c.discrepancy ? { discrepancy: c.discrepancy } : {}),
      };
    },
    async createTask(
      tx: TxContext,
      input: {
        propertyId: string;
        departmentId?: string;
        kind: string;
        title: string;
        ref?: EntityRef;
        dueAt?: string;
        priority: TaskPriority;
      },
    ): Promise<{ taskId: string }> {
      const known = (TASK_KINDS as readonly string[]).includes(input.kind);
      const r = await service.createTask(tx, {
        propertyId: input.propertyId,
        ...(input.departmentId ? { departmentId: input.departmentId } : {}),
        kind: known ? (input.kind as TaskKind) : 'general',
        title: input.title,
        ...(known ? {} : { description: `Requested as: ${input.kind}` }),
        ...(input.ref ? { ref: input.ref } : {}),
        ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        priority: input.priority,
      });
      return { taskId: r.taskId };
    },
  };
}
