#!/usr/bin/env node
/**
 * svelte-check, with a ceiling on warnings as well as errors.
 *
 * ## Why this exists
 *
 * `npm run check` has always failed on errors and ignored warnings, so the
 * warning count drifted upward — 34, then 35 — and each new one arrived
 * into a pile nobody read.
 *
 * On 2026-09-21 that pile turned out to contain a real bug. Nineteen
 * `state_referenced_locally` warnings across the twelve game templates were
 * telling us the components captured their `data` prop once; a child who
 * opened a second game of the same template played the first one, with the
 * score filed against the new game (fixed in #79). The warning was correct
 * and had been there the whole time.
 *
 * A ceiling does not stop that happening. What it stops is the pile growing
 * silently: a new warning now fails CI and has to be either fixed or
 * deliberately accepted by raising BASELINE here, with a reason.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * What 22 is made of, as of 2026-09-21:
 *
 *   19  state_referenced_locally — the twelve game templates reading their
 *       `data` prop once. Correct and intended: #79 keys the whole shell on
 *       the dataset, so each game gets a fresh component. See
 *       tests/unit/game-remounts-per-dataset.test.mjs.
 *    2  css_unused_selector — `h4` in `h1, h2, h3, h4` and `input[type=
 *       'time']` in a list of input types. Both are one arm of a selector
 *       whose other arms are used; keeping them means the style applies if
 *       such an element is ever added.
 *    1  a11y_autofocus — the login page's single field.
 *
 * Lower it when warnings are removed. Raise it only with a note saying what
 * was accepted and why.
 */
const BASELINE = 22;

/**
 * Parses svelte-check's summary. Exported for its own test.
 *
 * Both formats, because svelte-check chooses one by itself: locally it
 * emitted the machine line, and on the CI runner the same command printed
 * the human one — which the first version of this script did not know, so
 * CI failed with "did its output format change?". It failing rather than
 * passing is the whole point (see verdict()), but it should not need to.
 * `--output machine` is now passed explicitly AND both shapes are read.
 */
export function parseSummary(output) {
  const machine = /COMPLETED\s+(\d+)\s+FILES\s+(\d+)\s+ERRORS\s+(\d+)\s+WARNINGS/.exec(output);
  if (machine) {
    return { files: Number(machine[1]), errors: Number(machine[2]), warnings: Number(machine[3]) };
  }
  const human = /found\s+(\d+)\s+errors?\s+and\s+(\d+)\s+warnings?\s+in\s+(\d+)\s+files?/.exec(output);
  if (human) {
    return { files: Number(human[3]), errors: Number(human[1]), warnings: Number(human[2]) };
  }
  return null;
}

/** The verdict, separated from running anything so it can be tested. */
export function verdict(summary, baseline = BASELINE) {
  if (!summary) {
    return { ok: false, reason: 'could not find svelte-check\'s summary line — did its output format change?' };
  }
  if (summary.errors > 0) {
    return { ok: false, reason: `${summary.errors} type/template error(s)` };
  }
  if (summary.warnings > baseline) {
    return {
      ok: false,
      reason: `${summary.warnings} warnings, baseline is ${baseline}. `
        + 'Fix the new one, or raise BASELINE in scripts/check-warnings.mjs with a reason. '
        + 'A warning that sits in the pile is a warning nobody reads — see this file\'s header.',
    };
  }
  const slack = baseline - summary.warnings;
  return {
    ok: true,
    reason: slack > 0
      ? `${summary.warnings} warnings, ${slack} below baseline — lower BASELINE to ${summary.warnings}.`
      : `${summary.warnings} warnings, at baseline.`,
  };
}

// Only run when invoked directly, so the test can import the pure parts.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const run = promisify(execFile);
  let output = '';
  try {
    const { stdout, stderr } = await run('npx', ['svelte-check', '--tsconfig', './tsconfig.json', '--output', 'machine'], {
      maxBuffer: 32 * 1024 * 1024,
    });
    output = stdout + stderr;
  } catch (err) {
    // svelte-check exits non-zero when it finds errors; its output is still
    // what we need, so read it rather than treating the exit code as fatal.
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (!output) {
      console.error('svelte-check could not be run:', err.message);
      process.exit(1);
    }
  }

  const summary = parseSummary(output);
  const result = verdict(summary);
  if (!result.ok) {
    console.error(output);
    console.error(`\ncheck failed: ${result.reason}`);
    process.exit(1);
  }
  console.log(`check passed: ${result.reason}`);
}
