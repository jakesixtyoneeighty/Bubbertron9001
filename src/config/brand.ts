export const BRAND = {
  name: "Bubberton9001",
  shortName: "B9",
  slug: "bubberton9001",
  description: "The skills-powered AI agent for Roblox Studio",
  repository: "https://github.com/jakesixtyoneeighty/stud",
  skillsRepository: "https://github.com/jakesixtyoneeighty/roblox-brain",
} as const;

export const STORAGE_KEYS = {
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

