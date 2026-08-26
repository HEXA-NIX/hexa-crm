import type { WorkReviewMessage } from "../types";

type ValidatableTask = {
  status: string;
  review_messages?: WorkReviewMessage[] | null;
};

const CLIENT_VALIDATION_DECISIONS = new Set<WorkReviewMessage["kind"]>([
  "internal_approved",
  "client_approved",
  "changes_requested",
]);

/** A task is visible to the client only after the latest validation decision
 * is the internal approval. Older approvals must not survive a later request
 * for changes. */
export function awaitsClientValidation(task: ValidatableTask): boolean {
  if (task.status !== "validation") return false;
  const latestDecision = [...(task.review_messages ?? [])]
    .reverse()
    .find((message) => CLIENT_VALIDATION_DECISIONS.has(message.kind));
  return latestDecision?.kind === "internal_approved";
}
