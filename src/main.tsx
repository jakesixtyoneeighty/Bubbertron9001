import React from "react";
import ReactDOM from "react-dom/client";
import { initializeSecretStorage } from "@/lib/secure-storage";

async function bootstrap() {
  const storage = await initializeSecretStorage();
  if (storage.migrationErrors.length > 0) {
    console.warn(
      "[Secure Storage] Some credentials could not be migrated to the OS keychain.",
      storage.migrationErrors,
    );
  }

  // Load stores and UI only after their synchronous secret cache is hydrated.
  const { default: App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
