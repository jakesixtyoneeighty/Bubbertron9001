import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateStorageKey } from "@/lib/storage";

describe("storage key migration", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("copies a previous value without deleting the recovery source", () => {
    localStorage.setItem("previous", "saved-value");

    migrateStorageKey("previous", "current");

    expect(localStorage.getItem("current")).toBe("saved-value");
    expect(localStorage.getItem("previous")).toBe("saved-value");
  });

  it("never blocks startup when storage is full", () => {
    localStorage.setItem("previous", "oversized-cache");
    const setItemSpy = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() => migrateStorageKey("previous", "current")).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
    setItemSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
