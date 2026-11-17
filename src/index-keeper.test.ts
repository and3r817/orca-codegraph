import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { IndexKeeper, nextAction } from './index-keeper'
import type { CommandResult, RunCommand } from './run-command'

type Call = { file: string; args: readonly string[]; env?: Readonly<Record<string, string>> }
type Answer = (call: Call) => CommandResult | Promise<CommandResult>

const OK: CommandResult = { code: 0, stdout: '' }
const MISSING: CommandResult = { code: 127, stdout: '' }
const WORKTREE = '/work/feature tree'

function primaryCheckout(indexed: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'orca-codegraph-test-'))
  if (indexed) {
    mkdirSync(join(root, '.codegraph'))
    writeFileSync(join(root, '.codegraph', 'codegraph.db'), '')
  }
  return root
}

function answerFor(root: string, status: object, overrides: Record<string, CommandResult> = {}): Answer {
  return (call) => {
    if (call.file === 'git') {
      return { code: 0, stdout: `${join(root, '.git')}\n` }
    }
    const subcommand = String(call.args[0])
    return overrides[subcommand] ?? (subcommand === 'status' ? { code: 0, stdout: JSON.stringify(status) } : OK)
  }
}

function keeperFor(answer: Answer): { keeper: IndexKeeper; calls: Call[]; logs: string[]; markerDir: string } {
  const calls: Call[] = []
  const logs: string[] = []
  const markerDir = mkdtempSync(join(tmpdir(), 'orca-codegraph-markers-'))
  const run: RunCommand = async (file, args, env) => {
    const call = { file, args, env }
    calls.push(call)
    return answer(call)
  }
  return { keeper: new IndexKeeper(run, markerDir, (message) => logs.push(message)), calls, logs, markerDir }
}

const codegraphCalls = (calls: Call[]): string[] =>
  calls.filter((call) => call.file === 'codegraph').map((call) => call.args.join(' '))

test('nextAction builds the index when the workspace has none', () => {
  assert.deepEqual(nextAction({ initialized: false }), ['init', '--yes'])
})

test('nextAction rebuilds the index when CodeGraph recommends it', () => {
  assert.deepEqual(nextAction({ initialized: true, index: { reindexRecommended: true } }), ['index', '-f', '-q'])
})

test('nextAction does nothing for a current index', () => {
  assert.equal(nextAction({ initialized: true, index: { reindexRecommended: false } }), undefined)
})

test('upgrades CodeGraph without the install refresh, then builds the index of a new worktree', async () => {
  const { keeper, calls } = keeperFor(answerFor(primaryCheckout(true), { initialized: false }))
  await keeper.ensure('repo::wt', WORKTREE)
  assert.deepEqual(calls[0], {
    file: 'git',
    args: ['-C', WORKTREE, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    env: undefined
  })
  assert.deepEqual(calls[1], { file: 'codegraph', args: ['upgrade'], env: { CODEGRAPH_NO_INSTALL_REFRESH: '1' } })
  assert.deepEqual(codegraphCalls(calls), ['upgrade', `status --json ${WORKTREE}`, `init --yes ${WORKTREE}`])
})

test('rebuilds the index when CodeGraph recommends it', async () => {
  const status = { initialized: true, index: { reindexRecommended: true } }
  const { keeper, calls } = keeperFor(answerFor(primaryCheckout(true), status))
  await keeper.ensure('repo::wt', WORKTREE)
  assert.deepEqual(codegraphCalls(calls), ['upgrade', `status --json ${WORKTREE}`, `index -f -q ${WORKTREE}`])
})

test('runs no CodeGraph command when the primary checkout has no index', async () => {
  const { keeper, calls } = keeperFor(answerFor(primaryCheckout(false), { initialized: false }))
  await keeper.ensure('repo::wt', WORKTREE)
  assert.deepEqual(codegraphCalls(calls), [])
})

test('skips a folder that is not a Git repository', async () => {
  const { keeper, calls } = keeperFor(() => ({ code: 128, stdout: '' }))
  await keeper.ensure('folder::docs', '/work/docs')
  assert.equal(calls.length, 1)
})

test('builds the index when the upgrade fails', async () => {
  const answer = answerFor(primaryCheckout(true), { initialized: false }, { upgrade: { code: 1, stdout: '' } })
  const { keeper, calls, logs } = keeperFor(answer)
  await keeper.ensure('repo::wt', WORKTREE)
  assert.equal(codegraphCalls(calls).at(-1), `init --yes ${WORKTREE}`)
  assert.equal(logs[0], 'codegraph upgrade failed with exit code 1')
})

test('runs one upgrade for two workspaces created together', async () => {
  const { keeper, calls } = keeperFor(answerFor(primaryCheckout(true), { initialized: false }))
  await Promise.all([keeper.ensure('repo::a', '/work/a'), keeper.ensure('repo::b', '/work/b')])
  assert.equal(codegraphCalls(calls).filter((line) => line === 'upgrade').length, 1)
})

test('builds no index and removes the marker when codegraph is not installed', async () => {
  const answer = answerFor(primaryCheckout(true), {}, { upgrade: MISSING, status: MISSING })
  const { keeper, calls, logs, markerDir } = keeperFor(answer)
  await keeper.ensure('repo::wt', WORKTREE)
  assert.deepEqual(codegraphCalls(calls), ['upgrade', `status --json ${WORKTREE}`])
  assert.equal(logs.at(-1), `codegraph status failed with exit code 127 for ${WORKTREE}`)
  assert.equal(keeper.pendingMarker('repo::wt'), undefined)
  assert.deepEqual(readdirSync(markerDir), [])
})

test('keeps a marker file while the index is built and removes it after', async () => {
  let finishInit = (): void => {}
  const initDone = new Promise<CommandResult>((resolve) => {
    finishInit = () => resolve(OK)
  })
  const base = answerFor(primaryCheckout(true), { initialized: false })
  const { keeper } = keeperFor((call) => (call.args[0] === 'init' ? initDone : base(call)))
  const ensured = keeper.ensure('repo::wt', WORKTREE)
  const marker = keeper.pendingMarker('repo::wt')
  assert.ok(marker)
  assert.equal(existsSync(marker), true)
  finishInit()
  await ensured
  assert.equal(existsSync(marker), false)
  assert.equal(keeper.pendingMarker('repo::wt'), undefined)
})

test('ignores a second check for a workspace whose index is being built', async () => {
  let finishInit = (): void => {}
  const initDone = new Promise<CommandResult>((resolve) => {
    finishInit = () => resolve(OK)
  })
  const base = answerFor(primaryCheckout(true), { initialized: false })
  const { keeper, calls } = keeperFor((call) => (call.args[0] === 'init' ? initDone : base(call)))
  const first = keeper.ensure('repo::wt', WORKTREE)
  const second = keeper.ensure('repo::wt', WORKTREE)
  finishInit()
  await Promise.all([first, second])
  assert.equal(codegraphCalls(calls).filter((line) => line.startsWith('init')).length, 1)
  assert.equal(keeper.pendingMarker('repo::wt'), undefined)
})
