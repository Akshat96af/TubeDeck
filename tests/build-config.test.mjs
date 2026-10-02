import { describe, expect, it } from "vitest";
import { validateAppConfig } from "../scripts/app-config.mjs";

const config = {
  firebaseApiKey: "AIza" + "x".repeat(35),
  googleClientId: "123-fixture.apps.googleusercontent.com",
};
describe("maintainer configuration boundary", () => {
  it("accepts public identifiers or an explicitly unconfigured development build", () => {
    expect(validateAppConfig(config)).toEqual(config);
    expect(
      validateAppConfig({ firebaseApiKey: "", googleClientId: "" }),
    ).toEqual({ firebaseApiKey: "", googleClientId: "" });
  });
  it("rejects private credentials and unknown fields instead of packaging them", () => {
    for (const field of [
      "geminiKey",
      "clientSecret",
      "private_key",
      "backendSecret",
    ])
      expect(() =>
        validateAppConfig({ ...config, [field]: "do-not-package" }),
      ).toThrow("only public");
  });
  it("rejects partial configuration and malformed identifiers", () => {
    for (const value of [
      null,
      [],
      { googleClientId: "" },
      { ...config, firebaseApiKey: "" },
      { ...config, googleClientId: "not-an-oauth-client" },
    ])
      expect(() => validateAppConfig(value)).toThrow();
  });
});
