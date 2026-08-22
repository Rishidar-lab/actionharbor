import { describe, expect, it } from "vitest";
import type { OperationRecord } from "./operation-store.js";
import { OperationStore } from "./operation-store.js";

function makeRecord(overrides: Partial<OperationRecord<{ id: string }>> = {}): OperationRecord<{ id: string }> {
  return {
    operationId: "op_1",
    idempotencyKey: "key-1",
    capabilityId: "cap_1",
    payloadHash: "hash-a",
    state: "succeeded",
    receipt: { id: "tix_1" },
    ...overrides,
  };
}

describe("OperationStore", () => {
  it("an unseen idempotency key is 'new'", () => {
    const store = new OperationStore<{ id: string }>();
    expect(store.check("key-1", "hash-a")).toEqual({ status: "new" });
  });

  it("the same key with the same payload hash after a record is 'duplicate', carrying the prior operation", () => {
    const store = new OperationStore<{ id: string }>();
    const record = makeRecord();
    store.record(record);
    expect(store.check("key-1", "hash-a")).toEqual({ status: "duplicate", operation: record });
  });

  it("the same key with a DIFFERENT payload hash is 'conflict' — this must be checked before the adapter is ever called", () => {
    const store = new OperationStore<{ id: string }>();
    store.record(makeRecord({ payloadHash: "hash-a" }));
    expect(store.check("key-1", "hash-b")).toEqual({ status: "conflict" });
  });

  it("lookup() finds a recorded operation by operationId, independent of idempotencyKey", () => {
    const store = new OperationStore<{ id: string }>();
    const record = makeRecord({ operationId: "op_42" });
    store.record(record);
    expect(store.lookup("op_42")).toEqual(record);
    expect(store.lookup("op_does_not_exist")).toBeUndefined();
  });

  it("a failed operation is still tracked and returned as 'duplicate' on replay, not silently forgotten", () => {
    const store = new OperationStore<{ id: string }>();
    const failed: OperationRecord<{ id: string }> = {
      operationId: "op_1",
      idempotencyKey: "key-1",
      capabilityId: "cap_1",
      payloadHash: "hash-a",
      state: "failed",
      errorMessage: "boom",
    };
    store.record(failed);
    expect(store.check("key-1", "hash-a")).toEqual({ status: "duplicate", operation: failed });
  });

  it("two different idempotency keys are tracked independently, even with identical payload hashes", () => {
    const store = new OperationStore<{ id: string }>();
    store.record(makeRecord({ idempotencyKey: "key-1", operationId: "op_1" }));
    expect(store.check("key-2", "hash-a")).toEqual({ status: "new" });
  });
});
