import type { PageInspection, LocateResult } from '../agent/pageAgent';
import type { Classification } from './detect';
import type { ExtractedDocument } from './extract';
import type { DocumentType, Report } from './schema';

/** Result of inspecting the active tab (before any data leaves the browser). */
export interface InspectResult {
  tabId: number;
  url: string;
  domain: string;
  title: string;
  classification: Classification;
  stats: ExtractedDocument['stats'];
  sectionsCount: number;
  chunksTotal: number;
  chunksSelected: number;
  analyzedChars: number;
  injectionSignals: number;
  /** Review strategy: candidate clauses the rules selected and their total size (what would be sent). */
  candidateCount: number;
  candidateChars: number;
  pageAgent: PageInspection;
}

export interface Settings {
  /** Bumped when defaults change in a way that must override stored values. */
  settingsVersion?: number;
  backendUrl: string;
  usePageAgentLocator: boolean;
  privacyAcknowledged: boolean;
}

export type AnalysisPhase = 'extracting' | 'locating' | 'sending' | 'verifying' | 'done' | 'error';

/** Stored in chrome.storage.session under `progress:<tabId>` while an analysis runs. */
export interface AnalysisProgress {
  phase: AnalysisPhase;
  done?: number;
  total?: number;
  ts: number;
}

export type BackgroundRequest =
  | { type: 'CL_INSPECT'; tabId: number }
  | { type: 'CL_ANALYZE'; tabId: number; typeOverride?: DocumentType; demo?: boolean }
  | { type: 'CL_GET_REPORT'; tabId: number }
  | { type: 'CL_HIGHLIGHT'; tabId: number; quote: string }
  | { type: 'CL_HEALTH' }
  | { type: 'CL_AGENT_FETCH'; body: string };

export type ContentRequest =
  | { type: 'CL_EXTRACT' }
  | { type: 'CL_INSPECT_AGENT' }
  | { type: 'CL_LOCATE'; knownHeadings: string[]; backendUrl: string }
  | { type: 'CL_HIGHLIGHT_QUOTE'; quote: string };

export type ExtractResponse = { ok: true; doc: ExtractedDocument } | { ok: false; error: string };
export type LocateResponse = LocateResult;

export interface HealthInfo {
  reachable: boolean;
  mode: 'llm' | 'demo' | 'unreachable';
  provider: string;
  model: string;
  agentProxy: boolean;
}

export type AnalyzeOutcome = { ok: true; report: Report } | { ok: false; error: string; code: 'backend_unreachable' | 'network' | 'malformed' | 'extraction' | 'unknown' };
