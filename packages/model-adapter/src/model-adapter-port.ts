export interface ModelProposeRequest {
  readonly goal: string;
  readonly resourceId: string;
}

export interface ModelProposeResponse {
  /** Raw, untyped bytes (TECHNICAL_SPEC.md: "`model-adapter` returns `unknown` proposal bytes"). Never pre-validated by the adapter itself. */
  readonly raw: string;
}

/**
 * The model boundary. Implementations must never receive adapter
 * credentials or capability-minting authority (SECURITY_MODEL.md: "The
 * agent has no ambient credentials and no direct network tool") — the only
 * thing on the other side of this interface is a proposal generator.
 */
export interface ModelAdapterPort {
  propose(request: ModelProposeRequest): Promise<ModelProposeResponse>;
}
