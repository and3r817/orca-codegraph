import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { assert, test } from 'orca/testing'
import { MAX_WAIT_SECONDS, markerPath, waitPrefix } from './launch-wait'

const run = promisify(execFile)

test('marker name holds only hex digits for a path with spaces and quotes', () => {
  const marker = markerPath('/tmp/markers', "/Users/o'brien/my repo")
  assert.match(marker, /^\/tmp\/markers\/[0-9a-f]{16}\.pending$/)
})

test('two workspace paths get two markers', () => {
  assert.notEqual(markerPath('/tmp/markers', '/repo/a'), markerPath('/tmp/markers', '/repo/b'))
})

test('prefix has a 300 second limit, no backslash, and ends with the quoted marker', () => {
  const prefix = waitPrefix('/tmp/markers/abc.pending')
  assert.equal(MAX_WAIT_SECONDS, 300)
  assert.match(prefix, /-lt 300 /)
  assert.equal(prefix.includes('\\'), false)
  assert.equal(prefix.endsWith("'/tmp/markers/abc.pending'; "), true)
})

test('shell starts the command at once when the marker does not exist', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orca-codegraph-test-'))
  const { stdout } = await run('/bin/sh', ['-c', `${waitPrefix(join(dir, 'gone.pending'))}echo started`])
  assert.equal(stdout, 'started\n')
})

test('shell waits while the marker exists and starts the command after it goes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orca-codegraph-test-'))
  const marker = join(dir, 'busy.pending')
  writeFileSync(marker, '')
  setTimeout(() => rmSync(marker), 200)
  const { stdout } = await run('/bin/sh', ['-c', `${waitPrefix(marker)}echo started`])
  assert.equal(stdout, 'orca-codegraph: waiting for the CodeGraph index\nstarted\n')
})
