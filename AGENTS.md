# Repository Guidelines

## Project Structure & Module Organization

Semilla Digital is a Spanish-language, browser-local AI assistant built with vanilla JavaScript, Vite, and WebLLM; it has no backend. `index.html` and `style.css` define the interface, and `script.js` boots the app. `src/` separates UI orchestration (`app.js`), inference (`engine.js`, plus root `worker.js`), IndexedDB storage, conversations, Markdown sanitization, document retrieval, PDF extraction, and model selection. `tests/` contains automated tests and PDF fixtures. Brand assets live in `assets/brand/`; consult `BRAND.md` for visual changes. `dist/` is generated build output.

## Build, Test, and Development Commands

Use Node.js 22.12+ and pnpm 9.10.0.

- `pnpm install --frozen-lockfile`: install the pinned dependency tree.
- `pnpm dev`: start Vite on localhost; open its printed URL.
- `pnpm test`: run all `tests/*.test.js` files.
- `pnpm build`: generate the static site in `dist/`.
- `pnpm preview`: serve the production build locally.
- `pnpm format:check`: check formatting; `pnpm format` rewrites files.
- `pnpm security:audit`: check dependencies for known vulnerabilities.

Use localhost or HTTPS; opening `index.html` through `file://` is unsupported.

## Coding Style & Naming Conventions

Use ES modules with explicit `.js` import extensions, two-space indentation, semicolons, and single quotes. Prettier enforces formatting with a 100-character print width; no separate linter is configured. Follow existing camelCase functions and variables, UPPER_SNAKE_CASE constants, and lowercase hyphenated filenames. Keep user-facing copy in Spanish and preserve accessible keyboard interactions.

## Testing Guidelines

Tests use `node:test`, strict assertions, JSDOM, and `fake-indexeddb`. Name files `tests/<module>.test.js` and describe observable behavior in test titles. Run an individual suite with `node --test tests/storage.test.js`. Cover changed behavior, including failure paths; no numeric coverage threshold is configured. UI tests mock inference, so verify real model loading and responses in a WebGPU browser for engine changes. Check responsive layouts for UI changes.

## Commit & Pull Request Guidelines

Recent commits use concise imperative subjects with prefixes such as `feat:`, `fix:`, `build:`, `test:`, `docs:`, `security:`, `ui:`, and `brand:`. Keep commits focused. PRs should explain the problem and resulting behavior, link relevant issues, report validation, and include screenshots for visual changes. Run tests, build, and formatting checks before review.

### Required incremental commits

- Separate independent features, bug fixes, and documentation changes into small, focused commits. Include the relevant regression tests with the behavior they verify.
- After running tests for a work block, resolve failures and commit that validated block before starting another independent change. Record the checks and outcomes in the commit body. Do not commit a known failing implementation merely because tests were run.
- If a verification-only run changes no files, report its result without creating an empty commit. At completion, commit all task-owned validated changes; never include unrelated user changes or private data.
- Creating these local commits is part of the normal workflow and does not require repeated confirmation. Push or publication requires user authorization.

## Security & Configuration

Preserve DOMPurify sanitization, document limits, and local-only chat processing. Consult `SECURITY.md` before changing browser policies or download origins. Keep dependency versions and `pnpm-lock.yaml` synchronized; never commit private conversation exports or secrets.
