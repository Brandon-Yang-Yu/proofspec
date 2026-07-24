import { parseSync } from 'oxc-parser'
import type { FileScan, ProofSite, ScanError, Step, StepKeyword } from './types.ts'

/**
 * Reads one TypeScript test file and reports the proof sites it holds.
 *
 * Takes the source rather than a path: the scan parses, it never type-checks, so there is
 * nothing about a file it needs from the project around it. A file that would not compile
 * still yields its proof sites.
 */
export function scanSource(source: string, options: { file: string }): FileScan {
  const { file } = options
  const parsed = parseSync(file, source)
  const lines = new LineMap(source)
  const comments = new CommentIndex(parsed.comments, lines)

  const capability = readCapability(comments, file)
  const context: FileContext = { file, capability: capability.name, lines, comments }

  const sites: ProofSite[] = []
  const errors: ScanError[] = [...capability.errors]
  walk(parsed.program as unknown as AstNode, call => {
    const found = collectFromTest(call, context)
    sites.push(...found.sites)
    errors.push(...found.errors)
  })

  return { file, capability: capability.name, sites, errors }
}

type FileContext = {
  readonly file: string
  readonly capability: string | undefined
  readonly lines: LineMap
  readonly comments: CommentIndex
}

// --- the file's capability ----------------------------------------------------

const CAPABILITY_TAG = 'Capability:'
const REQUIREMENT_TAG = 'Requirement:'
const SCENARIO_TAG = 'Scenario:'

/**
 * A file declares its capability once, in a `// Capability:` comment. A second one is an
 * error: a proof site with two possible parents has no place in the tree.
 */
function readCapability(
  comments: CommentIndex,
  file: string,
): { name: string | undefined; errors: ScanError[] } {
  const declarations = comments.lineComments.filter(
    comment => comment.ownLine && comment.text.startsWith(CAPABILITY_TAG),
  )
  const errors = declarations.slice(1).map(
    (extra): ScanError => ({
      kind: 'second-capability',
      file,
      line: extra.line,
      message: 'a file may declare one capability, but this is a second',
    }),
  )
  const first = declarations[0]
  const name = first === undefined ? undefined : after(CAPABILITY_TAG, first.text)
  return { name, errors }
}

// --- turning one test into its proof sites -----------------------------------

type TaggedStatement = { readonly statement: AstNode; readonly index: number; readonly block: ParsedBlock }

/**
 * A test is a proof site two ways (§13). A tag pair directly above it makes the whole
 * test one site (Layout A). A tag pair on a statement inside it opens a block site
 * (Layout B). Using both at once is an error, because the sites could be counted two ways.
 */
function collectFromTest(
  call: AstNode,
  context: FileContext,
): { sites: ProofSite[]; errors: ScanError[] } {
  const { file, lines, comments } = context
  const testLine = lines.of(call.start)

  const above = parseBlock(comments.leadingBlock(testLine), file)
  const body = testBody(call).map(
    (statement, index): TaggedStatement => ({
      statement,
      index,
      block: parseBlock(comments.leadingBlock(lines.of(statement.start)), file),
    }),
  )
  const errors = [...above.errors, ...body.flatMap(entry => entry.block.errors)]
  const tagged = body.filter(entry => entry.block.tag.tagged)

  if (above.tag.tagged && tagged.length > 0) {
    errors.push({
      kind: 'mixed-placement',
      file,
      line: testLine,
      message: 'a test may not tag both above itself and inside its body',
    })
    return { sites: [], errors }
  }

  if (tagged.length > 0) {
    return { sites: layoutBSites(body, tagged, above, context), errors }
  }
  return { sites: layoutASite(above, call, testLine, context), errors }
}

/** Layout A: the whole test is one site. A lone tag makes no site — guard catches it. */
function layoutASite(
  above: ParsedBlock,
  call: AstNode,
  testLine: number,
  context: FileContext,
): ProofSite[] {
  if (!above.tag.tagged) return []
  return [
    {
      capability: context.capability,
      requirement: above.tag.requirement,
      scenario: above.tag.scenario,
      steps: above.steps,
      file: context.file,
      line: testLine,
      endLine: context.lines.of(call.end),
    },
  ]
}

/**
 * Layout B: each tagged statement is a site. The GIVEN/WHEN above the test is shared,
 * delivered on every block. A block runs from its tagged statement to the statement before
 * the next tagged one, or to the end of the test.
 */
function layoutBSites(
  body: readonly TaggedStatement[],
  tagged: readonly TaggedStatement[],
  above: ParsedBlock,
  context: FileContext,
): ProofSite[] {
  return tagged.flatMap((start, position): ProofSite[] => {
    if (!start.block.tag.tagged) return []
    const next = tagged[position + 1]
    const lastIndex = next === undefined ? body.length - 1 : next.index - 1
    return [
      {
        capability: context.capability,
        requirement: start.block.tag.requirement,
        scenario: start.block.tag.scenario,
        steps: [...above.steps, ...start.block.steps],
        file: context.file,
        line: context.lines.of(start.statement.start),
        endLine: context.lines.of(body[lastIndex]!.statement.end),
      },
    ]
  })
}

// --- reading a comment block into tags and steps -----------------------------

/**
 * A leading comment block, read. It either carries a full tag pair or it does not — a lone
 * tag collapses to `tagged: false`, so a half tag never becomes a proof site.
 */
type ParsedBlock = {
  readonly tag: BlockTag
  readonly steps: readonly Step[]
  readonly errors: readonly ScanError[]
}

type BlockTag =
  | { readonly tagged: true; readonly requirement: string; readonly scenario: string }
  | { readonly tagged: false }

const STEP_KEYWORD = /^(GIVEN|WHEN|THEN)\b/
const AND_KEYWORD = /^AND\b/

/**
 * Reads a run of `//` comment lines into its tags and Gherkin steps. A line with no
 * keyword continues the step above it, which is how a step runs to a second sentence
 * without AND. An AND is an error: a second outcome under one THEN is a second scenario.
 */
function parseBlock(block: readonly LineComment[], file: string): ParsedBlock {
  let requirement: string | undefined
  let scenario: string | undefined
  const steps: Step[] = []
  const errors: ScanError[] = []
  let current: { keyword: StepKeyword; text: string; line: number } | undefined

  for (const comment of block) {
    const text = comment.text
    if (text.startsWith(REQUIREMENT_TAG)) {
      requirement = after(REQUIREMENT_TAG, text)
      current = undefined
      continue
    }
    if (text.startsWith(SCENARIO_TAG)) {
      scenario = after(SCENARIO_TAG, text)
      current = undefined
      continue
    }
    if (text.startsWith(CAPABILITY_TAG)) {
      current = undefined
      continue
    }
    if (AND_KEYWORD.test(text)) {
      errors.push({
        kind: 'and-step',
        file,
        line: comment.line,
        message: 'AND is not a step keyword: a second outcome is a second scenario',
      })
      current = undefined
      continue
    }
    const step = STEP_KEYWORD.exec(text)
    if (step !== null) {
      const keyword = step[1] as StepKeyword
      current = { keyword, text: after(keyword, text), line: comment.line }
      steps.push(current)
      continue
    }
    // A comment with no keyword continues the step above it.
    if (current !== undefined) current.text = `${current.text} ${text}`.trim()
  }

  const tag: BlockTag =
    requirement !== undefined && scenario !== undefined
      ? { tagged: true, requirement, scenario }
      : { tagged: false }
  return { tag, steps, errors }
}

/** The text after a keyword or `Tag:` prefix, trimmed. */
function after(prefix: string, text: string): string {
  return text.slice(prefix.length).trim()
}

// --- comments -----------------------------------------------------------------

type LineComment = { readonly line: number; readonly text: string; readonly ownLine: boolean }

/**
 * The file's comments, indexed for leading-block lookup. Attaching comments to nodes is
 * done here by hand (oxc returns a flat list): a comment leads a node only when it sits
 * on its own line directly above, with no blank line between — exactly what a co-located
 * claim means, and stricter than a general "leading comment" would be.
 */
class CommentIndex {
  readonly lineComments: LineComment[] = []
  private readonly byLine = new Map<number, LineComment>()
  private readonly blockLines = new Set<number>()

  constructor(comments: readonly RawComment[], lines: LineMap) {
    for (const comment of comments) {
      const startLine = lines.of(comment.start)
      if (comment.type === 'Block') {
        for (let line = startLine; line <= lines.of(comment.end); line++) {
          this.blockLines.add(line)
        }
        continue
      }
      const entry: LineComment = {
        line: startLine,
        text: comment.value.trim(),
        ownLine: lines.startsLine(comment.start),
      }
      this.lineComments.push(entry)
      if (entry.ownLine) this.byLine.set(startLine, entry)
    }
  }

  /** The contiguous run of own-line `//` comments directly above `nodeLine`, top-down. */
  leadingBlock(nodeLine: number): LineComment[] {
    const block: LineComment[] = []
    for (let line = nodeLine - 1; line >= 1; line--) {
      if (this.blockLines.has(line)) break
      const comment = this.byLine.get(line)
      if (comment === undefined) break
      block.unshift(comment)
    }
    return block
  }
}

type RawComment = {
  readonly type: 'Line' | 'Block'
  readonly value: string
  readonly start: number
  readonly end: number
}

// --- offsets to lines ---------------------------------------------------------

/**
 * Maps a UTF-16 offset (what oxc reports) to a 1-based line. Positions must be right in
 * files holding non-ASCII text, and JS string offsets are UTF-16, so counting code units
 * here matches what the parser counted.
 */
class LineMap {
  private readonly lineStarts: number[] = [0]

  constructor(private readonly source: string) {
    for (let index = 0; index < source.length; index++) {
      if (source[index] === '\n') this.lineStarts.push(index + 1)
    }
  }

  of(offset: number): number {
    let low = 0
    let high = this.lineStarts.length - 1
    let line = 0
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      if (this.lineStarts[mid]! <= offset) {
        line = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    return line + 1
  }

  /** True when only whitespace precedes `offset` on its line — the comment owns the line. */
  startsLine(offset: number): boolean {
    const lineStart = this.lineStarts[this.of(offset) - 1]!
    return this.source.slice(lineStart, offset).trim() === ''
  }
}

// --- walking the AST ----------------------------------------------------------

type AstNode = {
  readonly type: string
  readonly start: number
  readonly end: number
  readonly [key: string]: unknown
}

/**
 * Visits every node, calling `onTest` for each `it`/`test` call — `describe`-nested tests
 * included, however deep. A test's body is not descended into: its inside statements are
 * the caller's concern, so a nested test is never miscounted.
 */
function walk(node: AstNode, onTest: (call: AstNode) => void): void {
  if (node.type === 'CallExpression' && isTestCall(node)) {
    onTest(node)
    return
  }
  for (const key of Object.keys(node)) {
    const value = node[key]
    if (Array.isArray(value)) {
      for (const element of value) {
        if (isNode(element)) walk(element, onTest)
      }
    } else if (isNode(value)) {
      walk(value, onTest)
    }
  }
}

function isNode(value: unknown): value is AstNode {
  return typeof value === 'object' && value !== null && 'type' in value
}

/** A call is a test when its callee resolves to `it` or `test`, through `.each`/`.skip`/…. */
function isTestCall(node: AstNode): boolean {
  const root = rootCalleeName(node['callee'])
  return root === 'it' || root === 'test'
}

function rootCalleeName(callee: unknown): string | undefined {
  if (!isNode(callee)) return undefined
  if (callee.type === 'Identifier') {
    const name = callee['name']
    return typeof name === 'string' ? name : undefined
  }
  if (callee.type === 'MemberExpression') return rootCalleeName(callee['object'])
  if (callee.type === 'CallExpression') return rootCalleeName(callee['callee'])
  return undefined
}

/** The statements of a test's callback, or none when it has no block body. */
function testBody(call: AstNode): AstNode[] {
  const args = call['arguments']
  if (!Array.isArray(args)) return []
  const callback = [...args].reverse().find(arg => isNode(arg) && isFunction(arg))
  if (!isNode(callback)) return []
  const body = callback['body']
  if (!isNode(body) || body.type !== 'BlockStatement') return []
  const statements = body['body']
  return Array.isArray(statements) ? statements.filter(isNode) : []
}

function isFunction(node: AstNode): boolean {
  return node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression'
}
