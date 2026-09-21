#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

function readHookInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

function runGit(root, args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function output(systemMessage) {
  process.stdout.write(JSON.stringify({ systemMessage }));
}

try {
  const input = readHookInput();
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  const root = runGit(cwd, ['rev-parse', '--show-toplevel']);
  const status = runGit(root, ['status', '--short']);

  if (!status) {
    output('Working tree is clean; there is nothing to commit yet.');
    process.exit(0);
  }

  let diffCheck = 'passed';
  try {
    runGit(root, ['diff', '--check']);
    runGit(root, ['diff', '--cached', '--check']);
  } catch {
    diffCheck = 'found whitespace errors; fix them before committing';
  }

  const paths = status.split('\n').slice(0, 12).join(', ');
  const suffix = status.split('\n').length > 12 ? ', …' : '';
  output(`Uncommitted repository changes detected (${diffCheck}). Changed paths: ${paths}${suffix}. Review the diff and run relevant checks before asking whether to commit; this hook never commits or pushes automatically.`);
} catch (error) {
  output(`Commit check hook could not inspect repository state: ${error.message}`);
}
