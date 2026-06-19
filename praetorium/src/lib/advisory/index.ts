// ============================================================
// Praetorium — Advisory: Barrel exports
// ============================================================

export type {
  AdvisoryMode,
  AdvisoryPlan,
  LeaderboardModel,
  MatchedModel,
  ScoreBreakdown,
  ModelScore,
  AgentRecommendation,
  AdvisoryResponse,
  AdvisoryCacheEntry,
} from './types';

export {
  readCache,
  writeCache,
  getCacheAgeSeconds,
  CACHE_TTL,
  CACHE_FILE,
} from './cache';

export {
  AGENT_PROFILES,
  getWeights,
} from './profiles';
export type { AgentProfile } from './profiles';

export {
  scoreModels,
  getAgentProfile,
} from './scorer';

export {
  fetchGoModels,
  toMatchedModels,
} from './aaApi';
export type { ScrapedModel } from './aaApi';
