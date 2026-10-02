import { readFile } from "node:fs/promises";

export function validateAppConfig(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) => !["firebaseApiKey", "googleClientId"].includes(key),
    )
  )
    throw new Error(
      "App configuration accepts only public Firebase and OAuth client identifiers.",
    );
  const { firebaseApiKey, googleClientId } = value;
  if (typeof firebaseApiKey !== "string" || typeof googleClientId !== "string")
    throw new Error(
      "App configuration requires both client identifier fields.",
    );
  if (firebaseApiKey === "" && googleClientId === "") return value;
  if (
    !/^AIza[0-9A-Za-z_-]{35}$/.test(firebaseApiKey) ||
    !/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(googleClientId)
  )
    throw new Error(
      "Invalid Firebase web API key or Google OAuth web client ID. Check app-config.local.json.",
    );
  return { firebaseApiKey, googleClientId };
}

export async function readAppConfig() {
  try {
    return validateAppConfig(
      JSON.parse(await readFile("app-config.local.json", "utf8")),
    );
  } catch (error) {
    if (error.code === "ENOENT")
      return { firebaseApiKey: "", googleClientId: "" };
    throw error;
  }
}
