# Contributing

## Getting started

```sh
git clone <repo>
cd flugrekorder
npm install        # also sets up git hooks via husky
```

## Running tests

Node.js runs the TypeScript sources directly — no transpiler, no loader — which needs Node.js 22.18 or later.

```sh
npm test               # type check, then run the test suite
npm run typecheck      # type check only (node strips types, it does not check them)
npm run test:coverage  # run the test suite with a coverage summary
```

### In browsers

`npm run test:browser` builds the IIFE and runs `test/**/*.browser.ts` in Chromium (V8), Firefox (SpiderMonkey) and WebKit (JavaScriptCore) through [Playwright](https://playwright.dev). The browsers are a separate download, once:

```sh
npx playwright install chromium firefox webkit
npm run test:browser
```

These tests are not part of `npm test`; CI runs them in a job of their own.

Type stripping only supports erasable syntax: write type assertions as `value as T`, not `<T>value`, and import relative files with their `.ts` extension. `tsconfig.json` enforces both.

## Building

```sh
npm run build      # produces dist/ via tsdown (ESM + IIFE + types)
```

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org/).
Commit messages are validated locally by commitlint and again in CI.

Format: `type(optional scope): description`

| Type | When to use |
|---|---|
| `feat` | A new capability visible to users of the package — new export, new option, new behaviour |
| `fix` | Corrects something that was wrong — incorrect output, broken edge case, violated contract |
| `refactor` | Changes code structure without changing behaviour or fixing a bug |
| `test` | Adds, corrects, or removes tests |
| `docs` | README, CONTRIBUTING, inline comments, examples — no code changes |
| `build` | Changes to the build system or its config (`tsdown.config.ts`, `tsconfig.json`, `package.json` build fields) |
| `ci` | Changes to CI/CD workflows (`.github/workflows/`) |
| `chore` | Maintenance that doesn't fit elsewhere — dependency updates, repo housekeeping |
| `style` | Purely cosmetic — whitespace, formatting (rare: Biome handles most of this automatically) |
| `perf` | A change that measurably improves performance without altering behaviour |

**Common confusions:**
- `build` vs `chore`: if it touches the build toolchain, use `build`; for everything else, use `chore`
- `ci` vs `chore`: if it's in `.github/workflows/`, use `ci`
- `fix` vs `refactor`: did it correct wrong behaviour? `fix`. Did it restructure correct behaviour? `refactor`

## Using Git UI's with husky

Many Git UI's (such as [Fork](https://git-fork.com)) respect husky commit hooks, but does not source your shell environment by design. If your hooks fail silently or with a `command not found` error, it can't find `node` or `npx` because your version manager (nvm, asdf, etc.) isn't loaded.

Fix: add a `~/.config/husky/init.sh` file that sources your version manager before the hook runs.

For **asdf**:
```sh
. "$HOME/.asdf/asdf.sh"
```

For **nvm**:
```sh
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

Note: `~/.huskyrc` still works but is deprecated as of husky v9 — use `~/.config/husky/init.sh` instead.

If hooks still don't run as expected, CLI commits are always a reliable fallback — and CI validates commit messages regardless.
