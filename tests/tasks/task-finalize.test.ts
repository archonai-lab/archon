import { describe, expect, it, vi } from "vitest";
import * as taskFinalize from "../../src/tasks/task-finalize.js";

describe("registerFinalizeHandler", () => {
  it("rejects duplicate contract ids and keeps the original handler", () => {
    const contractId = "unit_duplicate_finalize_guard";
    const originalHandler = {
      contractId,
      finalize: vi.fn((): taskFinalize.TaskFinalizeResult => ({
        result: "original",
        resultMeta: {},
        artifacts: [],
      })),
    };
    const duplicateHandler = {
      contractId,
      finalize: vi.fn((): taskFinalize.TaskFinalizeResult => ({
        result: "duplicate",
        resultMeta: {},
        artifacts: [],
      })),
    };
    const unregister = taskFinalize.registerFinalizeHandler(originalHandler);

    try {
      expect(() => taskFinalize.registerFinalizeHandler(duplicateHandler)).toThrow(/already registered/i);
      expect(taskFinalize.getFinalizeHandler(contractId)?.finalize).toBe(originalHandler.finalize);
    } finally {
      unregister();
    }
  });

  it("does not let a stale unregister closure remove a later handler", () => {
    const contractId = "unit_finalize_unregister_release";
    const firstHandler = {
      contractId,
      finalize: vi.fn((): taskFinalize.TaskFinalizeResult => ({
        result: "first",
        resultMeta: {},
        artifacts: [],
      })),
    };
    const secondHandler = {
      contractId,
      finalize: vi.fn((): taskFinalize.TaskFinalizeResult => ({
        result: "second",
        resultMeta: {},
        artifacts: [],
      })),
    };

    const unregisterFirst = taskFinalize.registerFinalizeHandler(firstHandler);
    unregisterFirst();
    const unregisterSecond = taskFinalize.registerFinalizeHandler(secondHandler);

    try {
      unregisterFirst();
      expect(taskFinalize.getFinalizeHandler(contractId)?.finalize).toBe(secondHandler.finalize);
    } finally {
      unregisterSecond();
    }
  });
});
