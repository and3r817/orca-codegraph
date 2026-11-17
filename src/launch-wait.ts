import { createHash } from 'node:crypto'
import { join } from 'node:path'

export const MAX_WAIT_SECONDS = 300

export function markerPath(markerDir: string, workspacePath: string): string {
  const digest = createHash('sha256').update(workspacePath).digest('hex').slice(0, 16)
  return join(markerDir, `${digest}.pending`)
}

export function waitPrefix(marker: string): string {
  const script =
    `n=0; while [ -e "$0" ] && [ "$n" -lt ${MAX_WAIT_SECONDS} ]; do ` +
    '[ "$n" -eq 0 ] && echo "orca-codegraph: waiting for the CodeGraph index"; ' +
    'sleep 1; n=$((n+1)); done'
  return `sh -c '${script}' '${marker}'; `
}
