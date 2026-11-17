import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, mountWorker, test } from 'orca/testing'
import { markerPath, waitPrefix } from './launch-wait'
import type { CommandResult, RunCommand } from './run-command'
import { createActivate } from './worker'

const WORKSPACE_ID = 'repo::/work/feature'
const WORKTREE = '/work/feature'

const launch = (workspaceId: string | null) => ({
  agent: 'claude',
  workspaceId,
  workspaceKind: workspaceId ? ('worktree' as const) : null,
  command: "claude '--model' 'claude-opus-5-5'",
  env: {}
})

function indexedCheckout(): string {
  const root = mkdtempSync(join(tmpdir(), 'orca-codegraph-test-'))
  mkdirSync(join(root, '.codegraph'))
  writeFileSync(join(root, '.codegraph', 'codegraph.db'), '')
  return root
}

function slowInit(root: string): { run: RunCommand; calls: string[]; finishInit: () => void } {
  const calls: string[] = []
  let finishInit = (): void => {}
  const initDone = new Promise<CommandResult>((resolve) => {
    finishInit = () => resolve({ code: 0, stdout: '' })
  })
  const run: RunCommand = async (file, args) => {
    calls.push([file, ...args].join(' '))
    if (file === 'git') {
      return { code: 0, stdout: `${join(root, '.git')}\n` }
    }
    if (args[0] === 'status') {
      return { code: 0, stdout: JSON.stringify({ initialized: false }) }
    }
    return args[0] === 'init' ? initDone : { code: 0, stdout: '' }
  }
  return { run, calls, finishInit: () => finishInit() }
}

test('agent launch waits for the index of a new workspace, and later launches do not', async () => {
  const markerDir = mkdtempSync(join(tmpdir(), 'orca-codegraph-markers-'))
  const { run, calls, finishInit } = slowInit(indexedCheckout())
  const worker = await mountWorker({ default: createActivate(run, markerDir) })

  await worker.hooks.fire('workspace.create.after', {
    workspaceId: WORKSPACE_ID,
    kind: 'worktree',
    path: WORKTREE,
    branch: 'feature'
  })
  assert.deepEqual(await worker.hooks.fire('agent.launch.before', launch(WORKSPACE_ID)), {
    kind: 'continue',
    event: {
      ...launch(WORKSPACE_ID),
      command: waitPrefix(markerPath(markerDir, WORKTREE)) + launch(WORKSPACE_ID).command
    }
  })

  finishInit()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(await worker.hooks.fire('agent.launch.before', launch(WORKSPACE_ID)), {
    kind: 'continue',
    event: launch(WORKSPACE_ID)
  })
  assert.equal(calls.at(-1), `codegraph init --yes ${WORKTREE}`)
  await worker.deactivate()
})

test('agent launch outside a workspace passes unchanged', async () => {
  const markerDir = mkdtempSync(join(tmpdir(), 'orca-codegraph-markers-'))
  const { run } = slowInit(indexedCheckout())
  const worker = await mountWorker({ default: createActivate(run, markerDir) })
  assert.deepEqual(await worker.hooks.fire('agent.launch.before', launch(null)), {
    kind: 'continue',
    event: launch(null)
  })
  await worker.deactivate()
})
