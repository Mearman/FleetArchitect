import type { BattleResult } from "@/schema/battle";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";

/**
 * A generic repository over some entity keyed by `id`. This is the storage
 * contract domain code depends on; the Dexie adapter is one implementation.
 * When a sync server exists, a remote adapter implements the same interface.
 */
export interface Repository<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | undefined>;
  save(entity: T): Promise<void>;
  remove(id: string): Promise<void>;
}

export type ShipDesignRepository = Repository<ShipDesign>;
export type FleetRepository = Repository<Fleet>;
export type BattleResultRepository = Repository<BattleResult>;

export interface Storage {
  ships: ShipDesignRepository;
  fleets: FleetRepository;
  battles: BattleResultRepository;
}
