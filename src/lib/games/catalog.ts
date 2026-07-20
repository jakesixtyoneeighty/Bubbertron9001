export const GAME_CATALOG = [
  {
    id: "obby-starter",
    version: "1.0.0",
    name: "Obby Starter",
    category: "Starter games",
    description:
      "Build a checkpoint obby from primitive parts and bundled reviewed scripts.",
    compatibilityVersion: 1,
    optionSummary: [
      "5, 10, or 15 stages",
      "Easy, standard, or challenging",
      "Bright, neon, or nature",
    ],
  },
] as const

export type GameCatalogEntry = (typeof GAME_CATALOG)[number]
export type GameTemplateId = GameCatalogEntry["id"]

export const GAME_TEMPLATE_IDS = GAME_CATALOG.map((game) => game.id) as [
  GameTemplateId,
  ...GameTemplateId[],
]

export function getGameCatalogSummary() {
  return GAME_CATALOG.map(
    (game) => `- ${game.id}@${game.version}: ${game.description}`,
  ).join("\n")
}
