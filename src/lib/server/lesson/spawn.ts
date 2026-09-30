/**
 * Running a coding-agent CLI as a subprocess, with the prompt on stdin.
 *
 * Shared by the two callers that need it — lesson generation (prep.ts) and
 * the student's question box (/api/ask) — deliberately, rather than each
 * growing its own copy. This repo has been bitten more than once by two
 * sides of one concern drifting apart after being written separately, and
 * the details here are exactly the kind that get lost in a second copy:
 *
 *  - BOTH streams are captured. The previous version piped only stderr, on
 *    the reasoning that stdout was noise — and then the failure that
 *    actually happened printed its one diagnostic line to stdout and left
 *    stderr empty:
 *
 *        $ claude -p "reply with exactly: OK"
 *        Your organization has disabled Claude subscription access for Claude Code
 *        exit=1
 *
 *    so the rejection carried an empty string and weeks of failed bookings
 *    recorded nothing usable. The deadlock hazard that argument was built on
 *    is real, but it is solved by DRAINING the pipe, which is what happens
 *    here, not by refusing to read it.
 *
 *  - The prompt goes over stdin, never argv. It embeds text a parent or
 *    child typed, and argv is visible in `ps` to every process on the box.
 *
 *  - The timeout is the caller's, not a constant here. A lesson is minutes
 *    of work; a child waiting on an answer is not.
 *
 * The `label` parameter survives from when there were two engines. It is
 * always 'codex' now and stays only because an error message that names the
 * program is worth more than one that says "the agent".
 */
import { spawn } from 'node:child_process';
import { LessonGenerationError, classifyOutput } from './engine.ts';

/** How much of each stream is kept. The TAIL, not the head: a CLI's fatal
 *  message is its last word, and Codex's stdout is a whole transcript whose
 *  opening lines are a banner. Bounded so a chatty run cannot grow the
 *  server's heap by the length of its own output. */
const CAPTURE_TAIL = 8 * 1024;

export interface SpawnOptions {
  /** Names the program in error messages. */
  label: string;
  timeoutMs: number;
  /** Resolve with the whole of stdout, for an agent whose answer IS its
   *  stdout (Claude Code, opencode) rather than a file it writes (Codex). */
  collectStdout?: boolean;
}

/** The most stdout kept for an answer: a lesson plan is tens of kilobytes. */
const ANSWER_MAX = 4 * 1024 * 1024;

export function spawnAgent(
  bin: string,
  args: string[],
  prompt: string,
  cwd: string,
  { label, timeoutMs, collectStdout = false }: SpawnOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

    let out = '';
    let err = '';
    let answer = '';
    const keep = (buf: string, chunk: unknown): string => {
      const next = buf + String(chunk);
      return next.length > CAPTURE_TAIL ? next.slice(-CAPTURE_TAIL) : next;
    };
    child.stdout!.on('data', c => {
      out = keep(out, c);
      if (collectStdout && answer.length < ANSWER_MAX) answer += String(c);
    });
    child.stderr!.on('data', c => { err = keep(err, c); });

    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
    }, timeoutMs);

    const clearTimers = () => { clearTimeout(timer); clearTimeout(killTimer); };

    child.on('error', spawnErr => {
      clearTimers();
      // ENOENT here is the "installed in the builder stage, missing from the
      // runtime image" mistake the Dockerfile warns about, so it gets its own
      // kind rather than hiding inside a generic failure.
      const kind = (spawnErr as NodeJS.ErrnoException).code === 'ENOENT' ? 'engine-missing' : 'engine-failed';
      reject(new LessonGenerationError(kind, `failed to start ${label}: ${spawnErr.message}`, `${bin} ${args.join(' ')}`));
    });

    child.on('close', code => {
      clearTimers();
      if (timedOut) {
        reject(new LessonGenerationError('engine-timeout', `${label} timed out after ${timeoutMs / 1000}s`, tail(out, err)));
        return;
      }
      if (code === 0) { resolve(answer); return; }
      const detail = tail(out, err);
      const kind = classifyOutput(detail) ?? 'engine-failed';
      reject(new LessonGenerationError(kind, `${label} exited ${code}`, detail));
    });

    child.stdin!.on('error', () => {}); // the child may exit before reading it all
    child.stdin!.write(prompt);
    child.stdin!.end();
  });
}

const tail = (out: string, err: string): string =>
  [out.trim() && `stdout: ${out.trim()}`, err.trim() && `stderr: ${err.trim()}`]
    .filter(Boolean).join('\n') || '(no output on either stream)';
