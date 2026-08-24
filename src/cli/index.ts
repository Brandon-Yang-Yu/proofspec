export { check, impact, render, review, touched, write } from './run.ts'
export { exitCodeOf, FORMATS, isFormat, renderAnswer, renderDiagnostics, renderJson, renderQuickfix, renderText } from './render.ts'
export type { AnswerShape, Format, Layout } from './render.ts'
// `TouchedScenarioReport` carries both, so a consumer naming it can name what it holds.
export type { Step } from '../test-scan/index.ts'
export type { ProvingLines } from '../review/index.ts'
export type {
  GoneScenario,
  ImpactReport,
  Locations,
  Outcome,
  ProposedInput,
  ProvenRequirement,
  ReachedRequirement,
  RunOptions,
  SpecLocation,
  StandingReview,
  TestProves,
  TouchedAsk,
  TouchedReport,
  TouchedRequirement,
  TouchedScenarioReport,
  TouchedSummary,
  TouchedUnmatched,
  UnmatchedLines,
} from './types.ts'
