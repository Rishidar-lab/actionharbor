import type { ModelAdapterPort, ModelProposeRequest, ModelProposeResponse } from "./model-adapter-port.js";

/**
 * Deterministic, offline, no key/network (CLAUDE_BUILD_PROMPT.md: "The
 * default fake model and fake adapters require no network or key"). Simple
 * keyword matching on the goal text — the point of this class is never "can
 * it write a convincing plan," it's that whatever it proposes is still just
 * untrusted bytes the strict schema and policy engine treat exactly like
 * any other model output, cooperative or adversarial.
 *
 * Deliberately always emits schema-valid `RawAction`s: it exists to
 * exercise the happy path end to end. Test-support fixtures for malformed
 * and unsafe output — the thing Gate 3 actually has to prove stays
 * untrusted — live in `./test-support/adversarial-fixtures.js`.
 */
export class FakeModelAdapter implements ModelAdapterPort {
  async propose(request: ModelProposeRequest): Promise<ModelProposeResponse> {
    const goal = request.goal.toLowerCase();
    const actions: unknown[] = [];

    if (goal.includes("ticket") || goal.includes("incident")) {
      actions.push({
        actionType: "create_internal_ticket",
        resourceId: request.resourceId,
        evidenceRefs: [],
        parameters: {
          title: truncate(request.goal, 120),
          priority: "medium",
        },
      });
    }

    if (goal.includes("message") || goal.includes("email") || goal.includes("notify") || goal.includes("sms")) {
      actions.push({
        actionType: "send_customer_message",
        resourceId: request.resourceId,
        evidenceRefs: [],
        parameters: {
          customerId: request.resourceId,
          body: truncate(`Update regarding: ${request.goal}`, 2000),
          channel: goal.includes("sms") ? "sms" : "email",
        },
      });
    }

    if (goal.includes("refund")) {
      actions.push({
        actionType: "issue_refund",
        resourceId: request.resourceId,
        evidenceRefs: [],
        parameters: {
          orderId: request.resourceId,
          amountMinorInteger: 1000,
          currency: "USD",
          reason: truncate(request.goal, 300),
        },
      });
    }

    if (actions.length === 0) {
      actions.push({
        actionType: "create_internal_ticket",
        resourceId: request.resourceId,
        evidenceRefs: [],
        parameters: {
          title: truncate(`Review needed: ${request.goal}`, 120),
          priority: "low",
        },
      });
    }

    return { raw: JSON.stringify({ actions }) };
  }
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}
