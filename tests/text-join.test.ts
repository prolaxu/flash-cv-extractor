import { describe, it, expect } from "vitest";
import { joinWrappedText } from "../src/text/join";

describe("joining wrapped text - ", () => {
  it("undoes hyphenation at a line break", () => {
    // Justified text breaks words at the margin
    expect(joinWrappedText(["further upgrade my skills and compe-", "tencies"]))
      .toBe("further upgrade my skills and competencies");
    expect(joinWrappedText(["Stanford Graduate School of Busi-", "ness"]))
      .toBe("Stanford Graduate School of Business");
  });

  it("keeps a real compound prefix", () => {
    // "e-" is a prefix, not a wrapped word
    expect(joinWrappedText(["the e-", "commerce platform"])).toBe(
      "the e-commerce platform"
    );
    expect(joinWrappedText(["a co-", "founder"])).toBe("a co-founder");
  });

  it("joins ordinary lines with a single space", () => {
    expect(joinWrappedText(["first line", "second line"])).toBe(
      "first line second line"
    );
  });

  it("does not join across a capital letter", () => {
    // A trailing dash before a capitalised word is not word wrapping
    expect(joinWrappedText(["Peace Nepal DOT Com -", "Kathmandu"])).toBe(
      "Peace Nepal DOT Com - Kathmandu"
    );
  });

  it("skips blank parts and trims", () => {
    expect(joinWrappedText(["  one  ", "", "   ", "two"])).toBe("one two");
    expect(joinWrappedText([])).toBe("");
  });
});
