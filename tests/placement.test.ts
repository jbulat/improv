import { describe, it, expect } from "vitest";
import { inkBox } from "../tools/lib/placement";

describe("inkBox", () => {
  it("reports the first inked row as top, alongside left/width/bottom", () => {
    //        row 0 blank, row 1 has ink at x2-x3, row 2 has ink at x1
    const grid = [".....", "..rr.", ".r...", "....."];
    expect(inkBox(grid)).toEqual({ left: 1, top: 1, width: 3, bottom: 3 });
  });

  it("reports top 0 when the very first row is inked", () => {
    expect(inkBox(["r....", "....."]).top).toBe(0);
  });
});
