export { check, impact, render, touched, write } from './run.ts'
export { exitCodeOf, FORMATS, isFormat, renderAnswer, renderDiagnostics, renderJson, renderQuickfix, renderText } from './render.ts'
export type { AnswerShape, Format, Layout } from './render.ts'
// `TouchedScenarioReport` carries `Step`, so a consumer naming the one can name the other.
export type { Step } from '../test-scan/index.ts'
export type {
  GoneScenario,
  ImpactReport,
  Locations,
  Outcome,
  ProvenRequirement,
  ProvingLines,
  RunOptions,
  SpecLocation,
  TestProves,
  TouchedReport,
  TouchedRequirement,
  TouchedScenarioReport,
  UnmatchedLines,
} from './types.ts'
