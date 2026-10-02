/** Public app identifiers shipped by the maintainer, never user/API secrets. */
export interface AppConfig {
  firebaseApiKey: string;
  googleClientId: string;
}

let pending: Promise<AppConfig> | undefined;
export function getAppConfig(): Promise<AppConfig> {
  return (pending ??= fetch(chrome.runtime.getURL("app-config.json"))
    .then(async (response) => {
      if (!response.ok) throw new Error("App configuration is missing.");
      const config = await response.json();
      if (
        typeof config.firebaseApiKey !== "string" ||
        typeof config.googleClientId !== "string"
      )
        throw new Error("App configuration is invalid.");
      return {
        firebaseApiKey: config.firebaseApiKey,
        googleClientId: config.googleClientId,
      };
    })
    .catch((error) => {
      pending = undefined;
      throw error;
    }));
}
