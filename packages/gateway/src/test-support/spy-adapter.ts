import type { ActionType } from "@actionharbor/contracts";
import { vi } from "vitest";
import type { AdapterLookupResult, AdapterPort } from "../adapter-port.js";

/**
 * A real test double at the adapter boundary — `vi.fn()`-wrapped, not a
 * hand-rolled counter — so tests can assert both call count and call
 * arguments on `execute`/`lookup` the way they would against any other spy.
 * Used only to prove the gateway invariant; the granular fake adapters that
 * behave like real stateful tools (ticket, message, refund) are built at
 * Gate 4.
 */
export function createSpyAdapter<TParams, TReceipt>(
  actionType: ActionType,
  receipt: TReceipt,
): AdapterPort<TParams, TReceipt> & {
  execute: ReturnType<typeof vi.fn>;
  lookup: ReturnType<typeof vi.fn>;
} {
  return {
    actionType,
    execute: vi.fn(async () => receipt),
    lookup: vi.fn(async (): Promise<AdapterLookupResult<TReceipt>> => ({ status: "unknown" })),
  };
}
