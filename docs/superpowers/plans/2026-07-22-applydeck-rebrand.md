# ApplyDeck Web-UI Rebrand — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish rebranding the `web/` UI from "career-ops" to "ApplyDeck" — user-visible branding only.

**Architecture:** Pure string/JSX edits in `web/src`. No logic changes, no file renames, no route changes.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind. Dev server may already be running on port 3001 (`PORT=3001 npm run dev` from `web/`).

## Global Constraints — READ FIRST

- **Rebrand USER-VISIBLE strings only.** The following are INTERNAL WIRING and MUST NOT be renamed — changing them breaks state, file paths, or core integration:
  - `web/src/lib/career-ops.ts` module and every import of `@/lib/career-ops`
  - Function names: `careerOpsRoot()`, `rootScript()`, etc.
  - localStorage keys: `career-ops:theme`, `career-ops:config` (renaming wipes users' saved state)
  - The on-disk dir `.career-ops-web/` and any path containing it
  - API route paths, component file names (`co-mark.tsx` stays `co-mark.tsx`)
  - The root repo (CLI scripts, modes/, AGENTS.md) — out of scope entirely
- **Keep the MIT license intact** (`LICENSE` at repo root) — upstream attribution is legally required.
- The component name `CoMark` stays `CoMark` (renaming it means touching every import for zero user-visible gain — YAGNI).
- After each task: `cd web && npx tsc --noEmit` must exit 0. Commit after each task; do not push.

## Already done (do NOT redo — verify only)

| File | Change |
|---|---|
| `web/src/components/co-mark.tsx` | New mark: serif "A" on brand-orange card + offset back-card ("deck" motif) |
| `web/src/app/layout.tsx` | `title: "ApplyDeck — your job search command center"`, description, appleWebApp title |
| `web/src/components/app-shell.tsx` | Sidebar wordmark → `ApplyDeck` |
| `web/src/components/mobile-nav.tsx` | Header wordmark + `aria-label="ApplyDeck home"` |
| `web/src/app/icon.tsx` | NEW favicon matching the mark (ImageResponse, 32×32) |

`npx tsc --noEmit` already passes on this state.

---

### Task 1: Sweep remaining user-visible "career-ops" strings in `web/src`

**Files (Modify):**
- `web/src/app/apply/page.tsx:18` — body copy: `career-ops reads the real application form…` → `ApplyDeck reads the real application form…`
- `web/src/app/portals/page.tsx:14` — body copy: `The companies career-ops watches…` → `The companies ApplyDeck watches…`
- `web/src/components/score-methodology.tsx:37` — `…below it, career-ops` → `…below it, ApplyDeck`
- `web/src/app/api/tracker/delete/route.ts:41` — error string: `Removing a tracker row needs a newer career-ops — update to delete rows from here.` → `Removing a tracker row needs a newer ApplyDeck engine — update to delete rows from here.`
- `web/src/app/api/explore/ai/route.ts:51` — error string: `AI search needs a newer career-ops — update to enable it.` → `AI search needs a newer ApplyDeck engine — update to enable it.`

**Method:** For each, find the exact line (grep the quoted fragment), replace ONLY the visible words `career-ops` → `ApplyDeck`. Do not touch imports on the same lines (`@/lib/career-ops` stays).

**Also check-and-decide (visible only if rendered):**
- `web/src/components/config-form.tsx:137` — external link to `https://career-ops.org/docs/free-ai-engine`. Keep the URL (it's real upstream documentation that still works); change only any visible link TEXT that says "career-ops" to "engine docs".

**Explicitly leave alone:** every `from "@/lib/career-ops"` import, `SYSTEM_PREAMBLE`/AI prompt strings in `api/assistant/route.ts`, `api/run/route.ts`, `api/explore/ai/route.ts` prompt bodies (they instruct the engine, users never see them), `.career-ops-web` paths, comments.

- [ ] **Step 1: Apply the five string edits above**
- [ ] **Step 2: Verify no visible strings remain**

Run:
```bash
cd web && grep -rn "career-ops" src --include="*.tsx" --include="*.ts" \
  | grep -v 'lib/career-ops' | grep -v 'career-ops:' | grep -v '.career-ops-web' \
  | grep -v 'career-ops.org' | grep -vi 'preamble\|prompt\|OUTPUT CONTRACT\|headless\|modes/'
```
Expected: remaining hits are ONLY comments or AI-prompt bodies (manually confirm each is not rendered to the user).

- [ ] **Step 3: Typecheck**

Run: `cd web && npx tsc --noEmit` — Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add web/src
git commit -m "feat(web): rebrand visible strings to ApplyDeck"
```

---

### Task 2: Package metadata + README (cosmetic)

**Files (Modify):**
- `web/package.json` — `"name": "@career-ops/web"` → `"name": "@applydeck/web"`; `"description"` → `"ApplyDeck web experience — local-first."`
- `web/README.md` — first heading `# career-ops web (alpha)` → `# ApplyDeck web (alpha)`; in the first paragraph, replace product-name mentions of career-ops with ApplyDeck **but keep** the sentence structure and the upstream Discussion links untouched (they document real upstream resources).

- [ ] **Step 1: Apply both edits**
- [ ] **Step 2: Verify install still works**

Run: `cd web && npm install --dry-run 2>&1 | tail -2` — Expected: no error about the package name.

- [ ] **Step 3: Commit**

```bash
git add web/package.json web/README.md
git commit -m "chore(web): ApplyDeck package metadata"
```

---

### Task 3: Live verification

- [ ] **Step 1: Ensure the dev server is running**

If nothing answers on 3001: `cd web && PORT=3001 npm run dev &` (background). Note: port **3000 is occupied by an unrelated project — do not kill it, do not use 3000.**

- [ ] **Step 2: Verify served branding**

```bash
curl -s http://localhost:3001 | grep -o "<title>[^<]*</title>"
curl -s http://localhost:3001 | grep -c "ApplyDeck"
curl -s -o /dev/null -w "icon: %{http_code}\n" "http://localhost:3001/icon"
```
Expected: title `ApplyDeck — your job search command center`; count ≥ 1; icon 200.

- [ ] **Step 3: Visual spot-check** — open http://localhost:3001 in a browser: sidebar shows the orange deck-"A" mark + "ApplyDeck"; browser tab shows the new favicon; Apply and Portals pages show no "career-ops" in body copy.

- [ ] **Step 4: Nothing to commit** — `git status --short` should show a clean tree (or only files from Tasks 1–2 already committed).

---

## Self-Review (by plan author)

- Coverage: every rendered "career-ops" string found by grep is either in Tasks 1–2 or explicitly classified as internal/prompt/comment with reason.
- No placeholders; every edit lists exact file:line and exact replacement text.
- Consistency: brand is "ApplyDeck" (one word, capital A and D) everywhere; mark component stays `CoMark`; internal wiring untouched by constraint.
