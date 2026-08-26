import { describe, expect, it } from "vitest";
import { awaitsClientValidation } from "./client-validation";
import type { WorkReviewMessage } from "../types";

const message = (kind: WorkReviewMessage["kind"]): WorkReviewMessage => ({
  id: kind,
  author_id: 1,
  author_name: "Equipo",
  message: kind,
  created_at: "2026-08-26T12:00:00.000Z",
  kind,
});

describe("awaitsClientValidation", () => {
  it("requires validation status and the latest decision to be internal approval", () => {
    expect(awaitsClientValidation({ status: "validation", review_messages: [message("internal_approved")] })).toBe(true);
    expect(awaitsClientValidation({ status: "in_progress", review_messages: [message("internal_approved")] })).toBe(false);
  });

  it("does not reuse an old approval after the client requests changes", () => {
    expect(awaitsClientValidation({
      status: "validation",
      review_messages: [message("internal_approved"), message("changes_requested")],
    })).toBe(false);
  });
});
