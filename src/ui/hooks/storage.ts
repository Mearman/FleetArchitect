import { useLiveQuery } from "dexie-react-hooks";
import { storage } from "@/storage/db";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";

/**
 * Reactive reads over the storage contract, powered by Dexie's live queries.
 * Each hook returns `undefined` on the first render and the resolved value
 * thereafter, re-resolving automatically whenever the underlying table changes.
 * Components render a loading state until the value is defined.
 */

export function useShipDesigns(): ShipDesign[] | undefined {
  return useLiveQuery(() => storage().ships.list(), []);
}

export function useShipDesign(id: string | undefined): ShipDesign | undefined {
  return useLiveQuery(
    async () => (id === undefined ? undefined : storage().ships.get(id)),
    [id],
  );
}

export function useFleets(): Fleet[] | undefined {
  return useLiveQuery(() => storage().fleets.list(), []);
}

export function useFleet(id: string | undefined): Fleet | undefined {
  return useLiveQuery(
    async () => (id === undefined ? undefined : storage().fleets.get(id)),
    [id],
  );
}
