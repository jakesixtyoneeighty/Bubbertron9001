export const BRAND = {
  name: "bubbertron9001",
  shortName: "B9",
  slug: "bubbertron9001",
  description: "The skills-powered AI agent for Roblox Studio",
  repository: "https://github.com/jakesixtyoneeighty/bubbertron9001",
  skillsRepository: "https://github.com/jakesixtyoneeighty/roblox-brain",
} as const;

export const STORAGE_KEYS = {
  settings: "bubbertron9001-settings",
  authStore: "bubbertron9001-auth",
  models: "bubbertron9001_models_cache",
  codexAuth: "bubbertron9001_chatgpt_auth",
  setup: "bubbertron9001-setup",
} as const;

// The product briefly shipped under the misspelled Bubberton9001 name. Keep
// these keys readable so an app update does not silently reset a user's setup.
export const PREVIOUS_STORAGE_KEYS = {
  settings: "bubberton9001-settings",
  authStore: "bubberton9001-auth",
  models: "bubberton9001_models_cache",
  codexAuth: "bubberton9001_chatgpt_auth",
} as const;

export const LEGACY_STORAGE_KEYS = {
  settings: "stud-settings",
  authStore: "stud-auth",
  models: "stud_models_cache",
  codexAuth: "stud_chatgpt_auth",
} as const;
