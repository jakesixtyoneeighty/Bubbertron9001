import { create } from "zustand";
import { persist } from "zustand/middleware";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  OAuthAuth,
  getStoredAuth,
  clearAuth,
  clearPendingOAuth,
  startOAuthLogin,
  handleOAuthCallback,
  isAuthenticated,
} from "@/lib/auth/codex";
import { useModelsStore } from "./models";
import { LEGACY_STORAGE_KEYS, STORAGE_KEYS } from "@/config/brand";
import { migrateStorageKey } from "@/lib/storage";
import { authenticatedLocalFetch } from "@/lib/local-bridge";

export type AuthMethod = "api_key" | "oauth";

interface AuthState {
  // Current auth method
  authMethod: AuthMethod;
  
  // OAuth state
  oauthAuth: OAuthAuth | null;
  isLoggingIn: boolean;
  loginError: string | null;
  loginUrl: string | null; // URL to show as fallback
  
  // Actions
  setAuthMethod: (method: AuthMethod) => void;
  startLogin: () => Promise<void>;
  completeLogin: (code: string, state: string) => Promise<void>;
  logout: () => Promise<void>;
  checkOAuthCallback: () => Promise<boolean>;
  cancelLogin: () => Promise<void>;

  // Getters
  isOAuthAuthenticated: () => boolean;
}

migrateStorageKey(LEGACY_STORAGE_KEYS.authStore, STORAGE_KEYS.authStore);

const OAUTH_CALLBACK_BASE = "http://localhost:1455/auth";
let callbackCheckPromise: Promise<boolean> | null = null;

async function clearOAuthCallbackServer() {
  try {
    await authenticatedLocalFetch(`${OAUTH_CALLBACK_BASE}/clear`, {
      method: "POST",
    });
  } catch {
    // The callback server may not be ready yet; local PKCE state is still reset.
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      authMethod: "api_key",
      oauthAuth: getStoredAuth(),
      isLoggingIn: false,
      loginError: null,
      loginUrl: null,

      setAuthMethod: (method) => {
        set({ authMethod: method });
      },

      startLogin: async () => {
        set({ isLoggingIn: true, loginError: null, loginUrl: null });
        try {
          clearPendingOAuth();
          await clearOAuthCallbackServer();
          const { url } = await startOAuthLogin();
          // Store the URL for fallback display
          set({ loginUrl: url });
          // Try to open in default browser using Tauri's opener
          await openUrl(url);
        } catch (error) {
          // Even if browser open fails, we have the URL to show
          set({ 
            loginError: error instanceof Error ? error.message : String(error),
          });
        }
      },

      cancelLogin: async () => {
        clearPendingOAuth();
        await clearOAuthCallbackServer();
        set({ isLoggingIn: false, loginUrl: null, loginError: null });
      },

      completeLogin: async (code: string, state: string) => {
        set({ isLoggingIn: true, loginError: null });
        try {
          const auth = await handleOAuthCallback(code, state);
          set({
            oauthAuth: auth,
            isLoggingIn: false,
            authMethod: "oauth",
          });
          // Fetch models after successful login
          useModelsStore.getState().fetchModels();
        } catch (error) {
          clearPendingOAuth();
          set({ 
            loginError: error instanceof Error ? error.message : String(error),
            isLoggingIn: false 
          });
          throw error;
        }
      },

      logout: async () => {
        await clearAuth();
        // Clear cached models on logout
        useModelsStore.getState().clearModels();
        set({
          oauthAuth: null,
          authMethod: "api_key",
          loginError: null,
        });
      },

      checkOAuthCallback: async () => {
        if (callbackCheckPromise) return callbackCheckPromise;

        // Poll the OAuth callback server for pending auth data
        callbackCheckPromise = (async () => {
          try {
            const response = await authenticatedLocalFetch(
              `${OAUTH_CALLBACK_BASE}/poll`,
            );
            if (!response.ok) return false;

            const data = await response.json();
            if (!data.pending) return false;

            const { code, state } = data;

            // Consume the one-time callback before exchanging it so overlapping
            // pollers can never exchange the same authorization code.
            await clearOAuthCallbackServer();
            if (code && state) {
              await get().completeLogin(code, state);
              return true;
            }
            clearPendingOAuth();
          } catch (error) {
            console.debug("[OAuth] Poll failed:", error);
          }
          return false;
        })();

        try {
          return await callbackCheckPromise;
        } finally {
          callbackCheckPromise = null;
        }
      },

      isOAuthAuthenticated: () => {
        const result = isAuthenticated();
        console.log("[Auth] isOAuthAuthenticated:", result);
        return result;
      },
    }),
    {
      name: STORAGE_KEYS.authStore,
      partialize: (state) => ({ 
        authMethod: state.authMethod,
      }),
    }
  )
);
