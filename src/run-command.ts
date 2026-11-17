import { spawn } from 'node:child_process'

export type CommandResult = { code: number; stdout: string }

export type RunCommand = (
  file: string,
  args: readonly string[],
  env?: Readonly<Record<string, string>>
) => Promise<CommandResult>

export const runCommand: RunCommand = (file, args, env) =>
  new Promise((resolve) => {
    const child = spawn(file, [...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'ignore']
    })
    let stdout = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.on('error', () => resolve({ code: 127, stdout }))
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }))
  })
