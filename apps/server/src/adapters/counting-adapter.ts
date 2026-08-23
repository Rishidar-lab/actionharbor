import type { ActionType, Capability } from "@actionharbor/contracts";
import type { AdapterLookupResult, AdapterOperation, AdapterPort } from "@actionharbor/gateway";

/**
 * A transparent decorator that counts real `execute()` invocations —
 * app-layer observability for the "C. Replay / duplicate" demo (UX_SPEC.md:
 * prove "no second side effect" from something more convincing than the
 * gateway's own report). Delegates every call unchanged; never fakes a
 * result, never influences whether execute() actually runs.
 */
export class CountingAdapter<TParams, TReceipt> implements AdapterPort<TParams, TReceipt> {
  readonly actionType: ActionType;
  callCount = 0;

  constructor(private readonly inner: AdapterPort<TParams, TReceipt>) {
    this.actionType = inner.actionType;
  }

  async execute(operation: AdapterOperation, capability: Capability, params: TParams): Promise<TReceipt> {
    this.callCount += 1;
    return this.inner.execute(operation, capability, params);
  }

  async lookup(operationId: string): Promise<AdapterLookupResult<TReceipt>> {
    return this.inner.lookup(operationId);
  }
}
