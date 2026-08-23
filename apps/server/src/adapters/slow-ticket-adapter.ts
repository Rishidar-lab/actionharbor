import type { Capability, CreateInternalTicketParameters, TicketReceipt } from "@actionharbor/contracts";
import type { Clock, IdGenerator } from "@actionharbor/domain";
import { FakeTicketAdapter } from "@actionharbor/adapters";
import type { AdapterLookupResult, AdapterOperation, AdapterPort } from "@actionharbor/gateway";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * "E. Unknown outcome" needs a real adapter call slower than the execution
 * budget — not a fake timeout. This wraps a genuine `FakeTicketAdapter`
 * with an artificial delay before `execute()` resolves. Crucially, the
 * delay happens BEFORE the inner call, and the inner call itself is never
 * cancelled by `executeAction`'s race (it can't be, in plain JS) — so the
 * ticket really is created in the inner adapter's own state once the delay
 * elapses, exactly demonstrating why `UNKNOWN_OUTCOME` exists: the gateway
 * genuinely does not know, at timeout time, whether this already
 * succeeded.
 */
export class SlowTicketAdapter implements AdapterPort<CreateInternalTicketParameters, TicketReceipt> {
  readonly actionType = "create_internal_ticket" as const;
  private readonly inner: FakeTicketAdapter;

  constructor(
    idGenerator: IdGenerator,
    clock: Clock,
    private readonly delayMs: number,
  ) {
    this.inner = new FakeTicketAdapter(idGenerator, clock);
  }

  async execute(operation: AdapterOperation, capability: Capability, params: CreateInternalTicketParameters): Promise<TicketReceipt> {
    await sleep(this.delayMs);
    return this.inner.execute(operation, capability, params);
  }

  async lookup(operationId: string): Promise<AdapterLookupResult<TicketReceipt>> {
    return this.inner.lookup(operationId);
  }
}
