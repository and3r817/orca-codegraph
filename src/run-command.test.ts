import { assert, test } from 'orca/testing'
import { runCommand } from './run-command'

test('returns the exit code and the standard output', async () => {
  assert.deepEqual(await runCommand('/bin/sh', ['-c', 'echo hi; exit 3']), { code: 3, stdout: 'hi\n' })
})

test('adds the given variables to the environment of the command', async () => {
  const result = await runCommand('/bin/sh', ['-c', 'echo "$PROBE"'], { PROBE: 'on' })
  assert.deepEqual(result, { code: 0, stdout: 'on\n' })
})

test('reports exit code 127 when the command does not exist', async () => {
  const result = await runCommand('/nonexistent/orca-codegraph-binary', [])
  assert.equal(result.code, 127)
})
