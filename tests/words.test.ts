import { expect, it } from "vitest";
import { wordAt } from "../src/shared/words";
it("selects a word at a Unicode text offset without punctuation or adjacent words", () => {
  expect(wordAt("A déjà vu moment.", 4)).toBe("déjà");
  expect(wordAt("Don't panic.", 3)).toBe("Don't");
  expect(wordAt("hello", 5)).toBe("hello");
  expect(wordAt("hello world", 5)).toBe("");
  expect(wordAt("hello", -1)).toBe("");
});
