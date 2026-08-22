import type { Capability, CapabilityRejectionReason, CapabilityRequest } from "@actionharbor/contracts";
import type { Clock } from "@actionharbor/domain";
import { validateCapability } from "@actionharbor/domain";
import type { AdapterOperation, AdapterPort } from "./adapter-port.js";

export interface InvokeAdapterArgs<TParams, TReceipt> {
  readonly capability: Capability;
  readonly request: CapabilityRequest;
  readonly adapter: AdapterPort<TParams, TReceipt>;
  readonly operation: AdapterOperation;
  readonly params: TParams;
  readonly clock: Clock;
}

export type GatewayResult<TReceipt> =
  | { readonly ok: true; readonly receipt: TReceipt }
  | { readonly ok: false; readonly reasonCode: CapabilityRejectionReason };

/**
 * The action gateway (ARCHITECTURE.md): the ONLY policy enforcement point
 * allowed to call `adapter.execute`. No other function in this codebase may
 * do so — every call to a synthetic tool must pass through here.
 *
 * This is deliberately dumb: it does not decide policy, it only checks that
 * the capability presented is `active`, unexpired, and scoped to exactly this
 * principal / action type / resource / proposal hash, using the same pure
 * `validateCapability` the domain package tests in isolation. On any failure
 * it returns a typed rejection and — this is the load-bearing property —
 * `adapter.execute` is never invoked. There is no code path from "capability
 * check failed" to "adapter ran anyway".
 */
export async function invokeAdapter<TParams, TReceipt>(
  args: InvokeAdapterArgs<TParams, TReceipt>,
): Promise<GatewayResult<TReceipt>> {
  const check = validateCapability(args.capability, args.request, args.clock.now());
  if (!check.ok) {
    return { ok: false, reasonCode: check.reasonCode };
  }

  const receipt = await args.adapter.execute(args.operation, args.capability, args.params);
  return { ok: true, receipt };
}
