// ============================================================
// Praetorium — Advisory: Profili statici dei 12 agenti di Codex Romanus
// ============================================================
//
// Ogni agente ha un profilo con:
//  - Stelle (1-5) su intelligence, speed, cost (per display)
//  - Pesi High Performance (HP): massima qualità del codice
//  - Pesi Low Budget (LB): miglior value-for-money
//  - Flag requiresReasoning: se l'agente beneficia di modelli reasoning
//
// I pesi sono derivati dalle stelle secondo le formule nell'ADR-006.
// Σ dei pesi = 1.00 per entrambe le modalità.
// ============================================================

import type { AdvisoryMode } from './types';

/** Profilo esigenze di un agente per lo scoring */
export interface AgentProfile {
  /** ID univoco dell'agente (es. "iuppiter-orchestrator") */
  agentId: string;
  /** Nome leggibile dell'agente */
  name: string;
  /** Stelle 1-5 per ciascuna dimensione (per display UI) */
  stars: {
    intelligence: number;
    speed: number;
    cost: number;
  };
  /** Se l'agente richiede/tra beneficio da modelli con reasoning */
  requiresReasoning: boolean;
  /** Pesi per la modalità High Performance */
  weightHP: {
    intelligence: number;
    speed: number;
    cost: number;
    reasoning: number;
  };
  /** Pesi per la modalità Low Budget */
  weightLB: {
    intelligence: number;
    speed: number;
    cost: number;
    reasoning: number;
  };
}

/**
 * Helper: restituisce i pesi corretti in base alla modalità.
 */
export function getWeights(
  profile: AgentProfile,
  mode: AdvisoryMode,
): { intelligence: number; speed: number; cost: number; reasoning: number } {
  return mode === 'high' ? profile.weightHP : profile.weightLB;
}

// ============================================================
// Profili dei 12 agenti
// Pesi esatti da ADR-006:
//
// | Agente               | HP I/S/C/R     | LB I/S/C/R     | Stelle I/S/C | Reasoning |
// |----------------------|----------------|----------------|-------------|-----------|
// | iuppiter-orchestrator| .444/.178/.178/.200 | .139/.033/.828/.000 | 5/2/2 | true  |
// | minerva-architect    | .444/.178/.178/.200 | .139/.033/.828/.000 | 5/2/2 | true  |
// | vulcanus-senior-dev  | .400/.240/.160/.200 | .125/.045/.830/.000 | 5/3/2 | true  |
// | catone-quality       | .300/.400/.300/.000 | .075/.060/.865/.000 | 3/4/3 | false |
// | janus-security       | .356/.178/.267/.200 | .111/.033/.856/.000 | 4/2/3 | true  |
// | agrippa-devops       | .300/.300/.400/.000 | .075/.045/.880/.000 | 3/3/4 | false |
// | scipione-perf        | .356/.178/.267/.200 | .111/.033/.856/.000 | 4/2/3 | true  |
// | ovidio-frontend      | .333/.444/.222/.000 | .083/.067/.850/.000 | 3/4/2 | false |
// | plinioilvecchio-seo  | .200/.400/.400/.000 | .050/.060/.890/.000 | 2/4/4 | false |
// | mercurius-junior-dev | .167/.417/.417/.000 | .042/.063/.896/.000 | 2/5/5 | false |
// | diana-tester         | .333/.333/.333/.000 | .083/.050/.867/.000 | 3/3/3 | false |
// | tacito-docs          | .182/.364/.455/.000 | .045/.055/.900/.000 | 2/4/5 | false |
// ============================================================

export const AGENT_PROFILES: Record<string, AgentProfile> = {
  'iuppiter-orchestrator': {
    agentId: 'iuppiter-orchestrator',
    name: 'Iuppiter',
    stars: { intelligence: 5, speed: 2, cost: 2 },
    requiresReasoning: true,
    weightHP: { intelligence: 0.444, speed: 0.178, cost: 0.178, reasoning: 0.200 },
    weightLB: { intelligence: 0.139, speed: 0.033, cost: 0.828, reasoning: 0.000 },
  },
  'minerva-architect': {
    agentId: 'minerva-architect',
    name: 'Minerva',
    stars: { intelligence: 5, speed: 2, cost: 2 },
    requiresReasoning: true,
    weightHP: { intelligence: 0.444, speed: 0.178, cost: 0.178, reasoning: 0.200 },
    weightLB: { intelligence: 0.139, speed: 0.033, cost: 0.828, reasoning: 0.000 },
  },
  'vulcanus-senior-dev': {
    agentId: 'vulcanus-senior-dev',
    name: 'Vulcanus',
    stars: { intelligence: 5, speed: 3, cost: 2 },
    requiresReasoning: true,
    weightHP: { intelligence: 0.400, speed: 0.240, cost: 0.160, reasoning: 0.200 },
    weightLB: { intelligence: 0.125, speed: 0.045, cost: 0.830, reasoning: 0.000 },
  },
  'catone-quality': {
    agentId: 'catone-quality',
    name: 'Catone',
    stars: { intelligence: 3, speed: 4, cost: 3 },
    requiresReasoning: false,
    weightHP: { intelligence: 0.300, speed: 0.400, cost: 0.300, reasoning: 0.000 },
    weightLB: { intelligence: 0.075, speed: 0.060, cost: 0.865, reasoning: 0.000 },
  },
  'janus-security': {
    agentId: 'janus-security',
    name: 'Janus',
    stars: { intelligence: 4, speed: 2, cost: 3 },
    requiresReasoning: true,
    weightHP: { intelligence: 0.356, speed: 0.178, cost: 0.267, reasoning: 0.200 },
    weightLB: { intelligence: 0.111, speed: 0.033, cost: 0.856, reasoning: 0.000 },
  },
  'agrippa-devops': {
    agentId: 'agrippa-devops',
    name: 'Agrippa',
    stars: { intelligence: 3, speed: 3, cost: 4 },
    requiresReasoning: false,
    weightHP: { intelligence: 0.300, speed: 0.300, cost: 0.400, reasoning: 0.000 },
    weightLB: { intelligence: 0.075, speed: 0.045, cost: 0.880, reasoning: 0.000 },
  },
  'scipione-perf': {
    agentId: 'scipione-perf',
    name: 'Scipione',
    stars: { intelligence: 4, speed: 2, cost: 3 },
    requiresReasoning: true,
    weightHP: { intelligence: 0.356, speed: 0.178, cost: 0.267, reasoning: 0.200 },
    weightLB: { intelligence: 0.111, speed: 0.033, cost: 0.856, reasoning: 0.000 },
  },
  'ovidio-frontend': {
    agentId: 'ovidio-frontend',
    name: 'Ovidio',
    stars: { intelligence: 3, speed: 4, cost: 2 },
    requiresReasoning: false,
    weightHP: { intelligence: 0.333, speed: 0.444, cost: 0.222, reasoning: 0.000 },
    weightLB: { intelligence: 0.083, speed: 0.067, cost: 0.850, reasoning: 0.000 },
  },
  'plinioilvecchio-seo': {
    agentId: 'plinioilvecchio-seo',
    name: 'Plinio il Vecchio',
    stars: { intelligence: 2, speed: 4, cost: 4 },
    requiresReasoning: false,
    weightHP: { intelligence: 0.200, speed: 0.400, cost: 0.400, reasoning: 0.000 },
    weightLB: { intelligence: 0.050, speed: 0.060, cost: 0.890, reasoning: 0.000 },
  },
  'mercurius-junior-dev': {
    agentId: 'mercurius-junior-dev',
    name: 'Mercurius',
    stars: { intelligence: 2, speed: 5, cost: 5 },
    requiresReasoning: false,
    weightHP: { intelligence: 0.167, speed: 0.417, cost: 0.417, reasoning: 0.000 },
    weightLB: { intelligence: 0.042, speed: 0.063, cost: 0.896, reasoning: 0.000 },
  },
  'diana-tester': {
    agentId: 'diana-tester',
    name: 'Diana',
    stars: { intelligence: 3, speed: 3, cost: 3 },
    requiresReasoning: false,
    weightHP: { intelligence: 0.333, speed: 0.333, cost: 0.333, reasoning: 0.000 },
    weightLB: { intelligence: 0.083, speed: 0.050, cost: 0.867, reasoning: 0.000 },
  },
  'tacito-docs': {
    agentId: 'tacito-docs',
    name: 'Tacito',
    stars: { intelligence: 2, speed: 4, cost: 5 },
    requiresReasoning: false,
    weightHP: { intelligence: 0.182, speed: 0.364, cost: 0.455, reasoning: 0.000 },
    weightLB: { intelligence: 0.045, speed: 0.055, cost: 0.900, reasoning: 0.000 },
  },
};
