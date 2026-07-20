/**
 * Model and Provider type definitions
 * Based on models.dev API schema (same as opencode fork)
 */

import { z } from "zod";

// Model schema from models.dev
export const ModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  family: z.string().optional(),
  release_date: z.string().optional(),
  attachment: z.boolean().default(false),
  reasoning: z.boolean().default(false),
  temperature: z.boolean().default(true),
  tool_call: z.boolean().default(true),
  cost: z
    .object({
      input: z.number(),
      output: z.number(),
      cache_read: z.number().optional(),
      cache_write: z.number().optional(),
    })
    .optional(),
  limit: z
    .object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    })
    .optional(),
  modalities: z
    .object({
      input: z.array(z.string()),
      output: z.array(z.string()),
    })
    .optional(),
  experimental: z.boolean().optional(),
  status: z.enum(["alpha", "beta", "deprecated"]).optional(),
  options: z.record(z.string(), z.unknown()).optional(),
});

export type Model = z.infer<typeof ModelSchema>;

// Provider schema from models.dev
export const ProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  api: z.string().optional(),
  env: z.array(z.string()).optional(),
  npm: z.string().optional(),
  models: z.record(z.string(), ModelSchema),
});

export type ProviderData = z.infer<typeof ProviderSchema>;

// Full response from models.dev/api.json
export type ProvidersData = Record<string, ProviderData>;

// Simplified model for UI display
export interface DisplayModel {
  id: string;
  name: string;
  description?: string;
  reasoning?: boolean;
  attachment?: boolean;
  provider: string;
  status?: "alpha" | "beta" | "deprecated";
  isNew?: boolean;
}

// Models allowed for Codex (ChatGPT Plus/Pro) - from models.dev
export const CODEX_ALLOWED_MODELS = new Set([
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
]);

// Fallback models when offline - from models.dev
export const FALLBACK_CODEX_MODELS: DisplayModel[] = [
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    description: "Balanced capability and speed",
    provider: "openai",
    isNew: true,
    reasoning: true,
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    description: "Frontier capability",
    provider: "openai",
    isNew: true,
    reasoning: true,
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6 Luna",
    description: "Fast and efficient",
    provider: "openai",
    isNew: true,
    reasoning: true,
  },
];
