export {
  GAME_CATALOG,
  GAME_TEMPLATE_IDS,
  getGameCatalogSummary,
  type GameCatalogEntry,
  type GameTemplateId,
} from "./catalog"
export {
  ChangeSetValidationError,
  compileGameTemplate,
  computeChangeSetFingerprint,
  getChangeSetValidationIssues,
  validateChangeSet,
} from "./compiler"
export {
  createRemovalPlan,
  preflightChangeSet,
} from "./preflight"
export {
  clearGameTemplateCache,
  getGameCatalog,
  getGameTemplate,
  isGameTemplateId,
  loadGameTemplate,
  requireGameTemplateId,
  validateLoadedTemplateAssets,
  type LoadedGameTemplate,
  type LoadedTrustedScript,
} from "./registry"
export {
  GameStudioRequestError,
  GameBuilderService,
  gameBuilderService,
  type CreateGameBuildDraftInput,
  type GameInstallResult,
  type GameMutationAction,
  type GameMutationProgress,
  type GameMutationProgressHandler,
  type GameMutationProgressPhase,
  type GameMutationReconciliation,
  type GameRemovalResult,
  type GameStudioPhase,
  type GameVerificationResult,
  type PreparedGameBuild,
  type PreparedStudioGameBuild,
} from "./service"
export * from "./schema"
