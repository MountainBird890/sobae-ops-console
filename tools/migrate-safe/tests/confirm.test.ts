import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { askForCode, ConfirmationAborted, generateCode } from '../src/confirm.ts'
import { formatFatal } from '../src/report.ts'

const TOOL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')

function streams() {
  const input = new PassThrough()
  const output = new PassThrough()
  output.resume() // discard what is printed
  return { input, output, isTTY: true }
}

describe('generateCode', () => {
  it('produces codes from an unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) assert.match(generateCode(), /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)
  })
})

describe('askForCode (injected streams)', () => {
  it('returns true for the exact code, ignoring surrounding whitespace', async () => {
    const io = streams()
    const p = askForCode('ABC123', io)
    io.input.write('  ABC123 \n')
    assert.equal(await p, true)
  })
  it('returns false for a wrong or differently-cased code', async () => {
    for (const answer of ['wrong', 'abc123', 'ABC12', '']) {
      const io = streams()
      const p = askForCode('ABC123', io)
      io.input.write(`${answer}\n`)
      assert.equal(await p, false, `answer: "${answer}"`)
    }
  })
  it('refuses when the input is not an interactive terminal', async () => {
    await assert.rejects(askForCode('ABC123', { ...streams(), isTTY: false }), /TTY/)
  })
  it('treats a closed input (Ctrl-D / end of stream) as an abort', async () => {
    const io = streams()
    const p = askForCode('ABC123', io)
    io.input.end()
    await assert.rejects(p, ConfirmationAborted)
  })
})

describe('what the CLI prints for a fatal error', () => {
  it('prints an abort on a fresh line without an error prefix, saying nothing was changed', () => {
    const text = formatFatal(new ConfirmationAborted())
    assert.ok(text.startsWith('\n'))
    assert.ok(!text.includes('エラー'))
    assert.match(text, /中止/)
    assert.match(text, /何も変更していません/)
  })
  it('prints other errors with a prefix and masks secrets', () => {
    const text = formatFatal(new Error('failed postgresql://u:secretpw@host/db and secretpw'), ['secretpw'])
    assert.ok(text.startsWith('エラー: '))
    assert.ok(!text.includes('secretpw'))
  })
})

// A real pseudo-terminal (via util-linux `script`) so stdin AND stdout are TTYs, exactly like an
// operator's terminal. Skipped where `script` is not available.
const HAS_SCRIPT = process.platform === 'linux' && spawnSync('script', ['--version'], { stdio: 'ignore' }).status === 0

function runOnPty(send: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('script', ['-qefc', 'node --import tsx tests/fixtures/ask.ts', '/dev/null'], { cwd: TOOL_DIR, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let sent = false
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('timed out waiting for the prompt')) }, 20_000)
    child.stdout.on('data', (d) => {
      out += d
      // send the input only once the prompt is on screen (readline is in raw mode by then)
      if (!sent && out.includes('> ')) { sent = true; child.stdin.write(send) }
    })
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out: out.replace(/\r/g, '') }) })
  })
}

describe('askForCode on a real pseudo-terminal', { skip: !HAS_SCRIPT }, () => {
  it('accepts the right code', async () => {
    const r = await runOnPty('ABC123\n')
    assert.match(r.out, /RESULT:match/)
    assert.equal(r.code, 0)
  })
  it('rejects a wrong code', async () => {
    const r = await runOnPty('wrong\n')
    assert.match(r.out, /RESULT:mismatch/)
  })
  it('treats Ctrl-C as an abort', async () => {
    const r = await runOnPty('\u0003')
    assert.match(r.out, /RESULT:aborted/)
    assert.equal(r.code, 2)
  })
  it('treats Ctrl-D as an abort', async () => {
    const r = await runOnPty('\u0004')
    assert.match(r.out, /RESULT:aborted/)
  })
})

describe('askForCode with piped (non-terminal) input', () => {
  it('refuses, so the code cannot be supplied by a script', () => {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'tests/fixtures/ask.ts'], { cwd: TOOL_DIR, input: 'ABC123\n', encoding: 'utf8', timeout: 20_000 })
    assert.match(r.stdout, /RESULT:error:.*TTY/)
    assert.equal(r.status, 1)
  })
})
