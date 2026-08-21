// Capability: impact

import { expect, it } from 'vitest'
import { impactTree } from '../../src/impact/index.ts'
import type { ImpactNode } from '../../src/impact/index.ts'
import { calls, FILE, node, testNode } from './support.ts'

/** The names of a node's callers, or an empty list where it was not expanded. */
function callerNames(node: ImpactNode | undefined): string[] {
  if (node === undefined || node.kind !== 'reached') return []
  return node.callers.map(one => one.fn.name)
}

const DEEP = 10

// Requirement: A change is placed on the functions whose lines it fell in
// Scenario: A changed line inside a function puts that function on the tree
// GIVEN two functions in a file, and a changed line inside the second
// WHEN the impact tree is built
// THEN the tree is rooted at that function alone, so the walk starts where the change is
//      rather than at everything in the file
it('roots the tree at the function a changed line falls in', () => {
  const untouched = node('untouched', { from: 1, to: 10 })
  const edited = node('edited', { from: 20, to: 30 })

  const tree = impactTree({
    changed: [{ file: FILE, ranges: [{ from: 25, to: 25 }] }],
    graph: { nodes: [untouched, edited], calls: [] },
    depth: DEEP,
  })

  expect(tree.changed.map(one => one.fn.name)).toEqual(['edited'])
})

// Requirement: A change is placed on the functions whose lines it fell in
// Scenario: A changed file with no function the graph knows is reported unmapped
// GIVEN a changed file the graph holds no function for
// WHEN the impact tree is built
// THEN the file is reported as unmapped rather than dropped, because "I could not place
//      this change" is a different answer from "this change reaches nothing"
it('reports a changed file it can place no function in', () => {
  const tree = impactTree({
    changed: [{ file: 'src/main.ts', ranges: [{ from: 1, to: 3 }] }],
    graph: { nodes: [node('elsewhere')], calls: [] },
    depth: DEEP,
  })

  expect(tree.changed).toEqual([])
  expect(tree.unmapped).toEqual(['src/main.ts'])
})

// Requirement: Everything that reaches a changed function is on the tree
// Scenario: A function that calls a changed one is on the tree above it
// GIVEN a changed function and another that calls it
// WHEN the impact tree is built
// THEN the caller sits above the changed function, which is the direction a reviewer reads:
//      what depends on what I edited
it('puts a caller of the changed function above it', () => {
  const edited = node('edited', { from: 20, to: 30 })
  const caller = node('caller', { from: 40, to: 50 })

  const tree = impactTree({
    changed: [{ file: FILE, ranges: [{ from: 25, to: 25 }] }],
    graph: { nodes: [edited, caller], calls: [calls(caller, edited)] },
    depth: DEEP,
  })

  expect(callerNames(tree.changed[0])).toEqual(['caller'])
})

// Requirement: Everything that reaches a changed function is on the tree
// Scenario: A caller two hops away is reached through the caller between them
// GIVEN a chain of three functions, the innermost changed
// WHEN the impact tree is built
// THEN the outermost appears above the middle one rather than beside it, so the tree shows
//      how far each caller is from the change
it('reaches a caller two hops away through the one between', () => {
  const edited = node('edited', { from: 20, to: 30 })
  const middle = node('middle', { from: 40, to: 50 })
  const outer = node('outer', { from: 60, to: 70 })

  const tree = impactTree({
    changed: [{ file: FILE, ranges: [{ from: 25, to: 25 }] }],
    graph: { nodes: [edited, middle, outer], calls: [calls(middle, edited), calls(outer, middle)] },
    depth: DEEP,
  })

  const [first] = tree.changed
  expect(callerNames(first)).toEqual(['middle'])
  expect(callerNames(first?.kind === 'reached' ? first.callers[0] : undefined)).toEqual(['outer'])
})

// Requirement: Everything that reaches a changed function is on the tree
// Scenario: A function already on the tree is not expanded a second time
// GIVEN two functions that call each other, one of them changed
// WHEN the impact tree is built
// THEN the second appearance is marked repeated with no callers walked, so a cycle ends and
//      the same subtree is not printed twice
it('marks a function already on the tree as repeated instead of walking it again', () => {
  const edited = node('edited', { from: 20, to: 30 })
  const other = node('other', { from: 40, to: 50 })

  const tree = impactTree({
    changed: [{ file: FILE, ranges: [{ from: 25, to: 25 }] }],
    graph: { nodes: [edited, other], calls: [calls(other, edited), calls(edited, other)] },
    depth: DEEP,
  })

  const [root] = tree.changed
  const [caller] = root?.kind === 'reached' ? root.callers : []
  expect(caller?.fn.name).toBe('other')
  // Walking on from `other` arrives back at `edited`, which is already the root: it comes
  // back as repeated, with nothing under it, and the walk ends there.
  const [back] = caller?.kind === 'reached' ? caller.callers : []
  expect(back).toEqual({ kind: 'repeated', fn: edited })
})

// Requirement: Everything that reaches a changed function is on the tree
// Scenario: The walk stops at the depth it was given
// GIVEN a chain of callers longer than the depth asked for
// WHEN the impact tree is built
// THEN the walk stops there, because the far end of a long chain is not what a reviewer is
//      looking at and an unbounded walk reaches the whole program
it('stops walking at the depth it was given', () => {
  const edited = node('edited', { from: 20, to: 30 })
  const middle = node('middle', { from: 40, to: 50 })
  const outer = node('outer', { from: 60, to: 70 })

  const tree = impactTree({
    changed: [{ file: FILE, ranges: [{ from: 25, to: 25 }] }],
    graph: { nodes: [edited, middle, outer], calls: [calls(middle, edited), calls(outer, middle)] },
    depth: 1,
  })

  const [first] = tree.changed
  expect(callerNames(first)).toEqual(['middle'])
  expect(callerNames(first?.kind === 'reached' ? first.callers[0] : undefined)).toEqual([])
})

// Requirement: A test is named where it reaches the change
// Scenario: A test that calls a changed function is named under it
// GIVEN a test file calling the changed function
// WHEN the impact tree is built
// THEN the test is named under the changed function with the line it calls from, so the
//      reader sees the proof that sits closest to the change
it('names a test that calls the changed function under it', () => {
  const edited = node('edited', { from: 20, to: 30 })
  const test = testNode('tests/edited.test.ts')

  const tree = impactTree({
    changed: [{ file: FILE, ranges: [{ from: 25, to: 25 }] }],
    graph: { nodes: [edited, test], calls: [calls(test, edited, 42)] },
    depth: DEEP,
  })

  const [root] = tree.changed
  expect(root?.kind === 'reached' ? root.tests : []).toEqual([{ file: 'tests/edited.test.ts', line: 42 }])
})

// Requirement: A test is named where it reaches the change
// Scenario: A test that calls a caller of the change is named under that caller
// GIVEN a test that calls not the changed function but the one calling it
// WHEN the impact tree is built
// THEN the test hangs off that caller, not off the changed function, so the tree shows how
//      far the test is from what changed
it('names a test under the function it actually calls', () => {
  const edited = node('edited', { from: 20, to: 30 })
  const caller = node('caller', { from: 40, to: 50 })
  const test = testNode('tests/caller.test.ts')

  const tree = impactTree({
    changed: [{ file: FILE, ranges: [{ from: 25, to: 25 }] }],
    graph: { nodes: [edited, caller, test], calls: [calls(caller, edited), calls(test, caller, 7)] },
    depth: DEEP,
  })

  const [root] = tree.changed
  expect(root?.kind === 'reached' ? root.tests : []).toEqual([])
  const [up] = root?.kind === 'reached' ? root.callers : []
  expect(up?.kind === 'reached' ? up.tests : []).toEqual([{ file: 'tests/caller.test.ts', line: 7 }])
})
