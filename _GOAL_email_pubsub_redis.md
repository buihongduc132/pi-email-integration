<!-- _GOAL_KIND: A -->

## Working Directory

| Location | Path | What's here | What you do here |
|----------|------|-------------|-----------------|
| **This repo** | `/home/bhd/Documents/Projects/bhd/pi-email-integration` | This _GOAL, ALL implementation code (`src/`, `extensions/`, `tests/`), state dir (`.ralph-email-pubsub/`) | Write code, run tests, commit implementation, update state |
| **pi-plugins worktree** | `/home/bhd/Documents/Projects/bhd/pi-plugins/.worktrees/fresh-brook` | Plan docs, inventory, progress tracker, D2 diagrams | Read plans, update inventory, commit config changes |

**ALWAYS `cd` to `/home/bhd/Documents/Projects/bhd/pi-email-integration` before writing code or running tests.**

## Goal

Implement the roll-out plan at `flow/plans/email-pubsub-redis/roll-out-plan.md`. All 9 steps across 4 milestones. Follow the milestone gate mechanism to advance.

## Milestones

| Milestone | Name | Steps | Gate Criteria |
|-----------|------|-------|---------------|
| M-1 | Foundation | S1, S2, S3 | Bus + logger work in isolation. Redis down = no crash. All tests pass. |
| M-2 | Delivery Engine | S4, S5 | Subscription delivers through bus → pi-inject pipeline. Old dead code gone. |
| M-3 | Tools + Wiring | S6, S7 | 3 new tools visible. `email_send` publishes to bus. Types complete. |
| M-4 | Integration + Deploy | S8, S9 | Full E2E flow works. Package installed in pi-plugins. All tools accessible. |

**The current milestone is tracked in `inventory.json` → `current_milestone`.**
**A milestone is LOCKED until the previous milestone passes ALL three gate layers.**

## Locations

| What | Path |
|------|------|
| Intention (sacred) | `flow/intentions/email-pubsub-redis.md` |
| Roll-out plan (milestones + steps) | `flow/plans/email-pubsub-redis/roll-out-plan.md` |
| Progress tracker | `flow/plans/email-pubsub-redis/progress.md` |
| Inventory (state + milestone tracking) | `flow/plans/email-pubsub-redis/inventory.json` |
| Parent plan (context) | `flow/requirements/email-integration/email_integration_plan.md` |
| Risk assessment | `flow/requirements/email-integration/email_integration_verifier_loop.md` |
| D2 diagrams | `flow/requirements/email-integration/d2/` |
| ACP messaging requirements | `flow/requirements/pi-acp-agents/acp-messaging.md` |
| Inter-agent communication | `flow/references/acp-plugins/INTER-AGENT-COMMUNICATION.md` |
| Intercom message loss findings | `flow/findings/delegation-gotchas/01-intercom-message-loss.md` |

## Rules

1. **MUST commit after every step** — no dirty working tree between steps
2. **TDD** — write test first, then implementation, for every new file
3. **Extension-of-extension mindset** — if Redis is down, email stores/retrieves normally via SQLite. Pub/sub is best-effort. No crash, no degradation of core email functionality
4. **Dead code removal** — the old `require("pi-intercom")` in mailbox-subscription.ts MUST be completely removed, not left commented out
5. **_GOAL immutability** — never modify this _GOAL file
6. **Milestone gates** — do NOT start ANY step in M-(N+1) until M-N passes all 3 gate layers (Layer A ✓ + Layer B ✓ + claude -p ✓)
7. **Verify against intention** — the intention file is sacred. If all plan items are done but the intention is not served, flag it
8. **Source repo only for code** — all `.ts` files go in pi-email-integration, never in pi-plugins
9. **Rollback rule** — if Layer B or claude -p finds regression in any previous milestone, ROLL BACK to the LOWEST violated milestone. Demote all items at and after that milestone. All subsequent milestones reset to `locked`.
10. **Cascade demotion** — when rolling back, ALL milestones after the violated one become `locked`. ALL their steps become `not_started`. Work resumes from the violated milestone.
11. **Plans and intentions are READ-ONLY** — NEVER modify the roll-out plan, intention file, requirements, or any reference document. Only source code, tests, inventory, and progress may be written.
12. **No explanation in _GOAL** — this file is an operational script. No rationale, no "why", no purpose descriptions. The mechanism encodes everything.

## Workflow

Iteration {{iteration}}. Follow this decision tree:

### Step 0: Modulo checkpoint check

**Check this BEFORE any other work. If a modulo matches, execute it and END the iteration.**

- **I % 5 == 0 → SYNC** (see I%5 ceremony below)
- **I % 7 == 0 → BACKWARD AUDIT** (see I%7 ceremony below)
- **I % 10 == 0 → MILESTONE GATE** (see I%10 ceremony below) — ONLY if ALL steps in current milestone are `completed`

If a modulo matched and you completed it → END iteration here. Do NOT proceed to Steps 1–6.

### Steps 1–6: Normal iteration work

Only reached if NO modulo matched at Step 0.

1. **Context pickup**: Read `inventory.json`. Identify `current_milestone`. Read only items in current milestone.
2. **Pick up problems**: If any step in current milestone has `problem_notes`, fix those FIRST. Mark `problem_notes: []` when resolved. Commit.
3. **Next unstarted step in current milestone**: Find the first `not_started` step in current milestone whose dependencies are all `completed`. Mark it `in_progress`. Implement in TDD. Run tests. If tests pass, mark `fixed`. Commit.
4. **Verify fixed step**: If any step is `fixed`, run verifier loop against it (tests pass, code matches plan spec, no stubs). If verifier passes, mark `completed`. Update `progress.md`. Commit.
5. **Milestone gate check**: If ALL steps in current milestone are `completed`, trigger the milestone gate (see I%10 ceremony). Do NOT proceed to next milestone until gate passes.
6. **All milestones done**: If ALL milestones are `completed`, run ALL tests one final time, update `progress.md` with final status, commit. Loop naturally ends.

Priority: fix problems → next step in current milestone → verify fixed → milestone gate → all-done.

**NEVER jump ahead to a locked milestone. NEVER start steps in M-(N+1) while M-N is not fully gated.**

## I % 5 == 0 — SYNC

- `cd /home/bhd/Documents/Projects/bhd/pi-email-integration`
- `git pull --rebase` (if remote exists)
- `git add -A && git commit -m "wip: email-pubsub iteration {{iteration}}"` (if dirty)
- Update `progress.md` with current status
- Sync inventory: `cd /home/bhd/Documents/Projects/bhd/pi-plugins && git add -A && git commit -m "wip: inventory sync iteration {{iteration}}"` (if dirty)

## I % 7 == 0 — BACKWARD AUDIT (read-only, no code changes)

Use the skill `wear-hats` — act as @verifier.

Identify ALL wrong-doings in the previous iterations' work that is NOT actually making progress toward the GOAL. What gotchas are NOT covered? What integration and wiring is NOT done correctly? For the CURRENT claimed progress, what is NOT actually as it looks in terms of FINAL application required functionalities?

Record findings into `inventory.json` (problem_notes on affected steps). Commit.

## I % 10 == 0 — MILESTONE GATE (Layer A + Layer B + claude -p)

**Run this ceremony ONLY when ALL steps in the current milestone are `completed`.**
If not all steps are completed, fall through to normal iteration work instead.

### Layer A: Within-Milestone Full Verifier

1. Re-verify EVERY step in current milestone against acceptance criteria in roll-out-plan.md
2. Run ALL tests for files touched by this milestone
3. Check integration between milestone components — do they compose?
4. Edge cases: Redis unavailable, malformed payloads, concurrent subscribers
5. Cross-reference intention — does this milestone's implementation serve what the user wanted?

IF Layer A finds ANY issues → record as problem_notes, demote affected steps. DO NOT proceed to Layer B. Fix in the next normal iteration.

### Layer B: Cross-Milestone Verifier

**ONLY runs if Layer A passed.** Selects 3 RANDOM items from PREVIOUS milestones:

```
Selection method: take (iteration_number * 7) mod total_completed_items_in_previous_milestones
Pick 3 consecutive items starting from that index (wrapping around)
If fewer than 3 items exist in previous milestones, check ALL of them.
```

For each selected item:
1. Re-run its acceptance criteria from the plan
2. Verify its tests still pass
3. Check for regressions caused by current milestone's work
4. Verify system reachability (still wired, still alive, not dead code)

IF Layer B finds ANY regression:
1. Identify the LOWEST milestone that has a violation
2. In `inventory.json`:
   - Violated milestone → `status: "in_progress"`, affected items → `in_progress` with problem_notes
   - ALL subsequent milestones → `status: "locked"`, ALL their items → `not_started`
3. Update `current_milestone` to the violated milestone
4. Record in `audit_log`: "ROLLBACK at iteration {{iteration}}: M-N violated, M-(N+1)+ reset"
5. DO NOT proceed. The next normal iteration starts from the violated milestone.

IF Layer B passes (no regressions found):
- Record in `inventory.json` → `milestone_gates.M-N.layer_b_passed: true`
- Proceed to claude -p approval

### claude -p Approval Gate

**ONLY runs if BOTH Layer A and Layer B passed.**

```bash
cd /home/bhd/Documents/Projects/bhd/pi-email-integration && \
claude -p "You are @milestone-verifier. Review milestone M-N (describe steps) completion against the plan at /home/bhd/Documents/Projects/bhd/pi-plugins/flow/plans/email-pubsub-redis/roll-out-plan.md and intention at /home/bhd/Documents/Projects/bhd/pi-plugins/flow/intentions/email-pubsub-redis.md. Check: (1) all acceptance criteria for this milestone met, (2) spot-check 2 items from previous milestones for regressions, (3) no dead/stub code, (4) tests test behavior not mocks, (5) system reachability from extension entry point. Output <promise>APPROVE</promise> if clean, or list specific issues."
```

Replace M-N with actual milestone ID. Replace describe steps with actual step IDs.

Parse claude output:
- Contains `<promise>APPROVE</promise>` → milestone PASSES
  - Set `milestone_gates.M-N.claude_p_passed: true`
  - Set `milestones.M-N.status: "completed"`
  - Set `milestone_gates.M-N.layer_a_passed: true`
  - Set `current_milestone` to M-(N+1) (if exists)
  - Set `milestones.M-(N+1).status: "in_progress"` (if exists)
  - Commit inventory update
- Contains issues → record as problem_notes, do NOT advance. Fix in the next normal iteration.

### All Milestones Done Check

IF after advancing, all milestones are `completed`:
- Run one final full-system verifier (all tests, all reachability, all edge cases)
- Update `progress.md` with final status
- Commit
- The loop naturally concludes — no promise output needed

## Worst-First; New Things Later

- Fix problems (from I%7 audit findings) BEFORE starting new steps
- Fix regressions BEFORE adding features
- The step with `problem_notes` is ALWAYS higher priority than the next `not_started` step
- Within problems: demoted steps first, then problem_notes, then suggestions
- ROLLBACK items are the ABSOLUTE highest priority — they block everything

## Mandatories

1. **Verifier loop** — every `fixed` step MUST pass independent verifier before `completed`. The implementing iteration CANNOT self-verify.
2. **Commit-before-complete** — every step must be committed before marking `completed`
3. **TDD** — test first for all new files
4. **Context pickup** — first thing every iteration: read `inventory.json` for current state + current milestone
5. **Demotion on regression** — if I%7 audit finds regression, demote `completed` → `in_progress` with problem_notes
6. **No inline scope** — the _GOAL references external files. Scope lives in roll-out-plan.md
7. **External review** — at I%10 milestone gate, run claude -p as independent verifier
8. **Milestone gate sequence** — Layer A FIRST, then Layer B, then claude -p. Never skip or reorder.
9. **Rollback is non-negotiable** — if Layer B or claude -p finds a regression in a previous milestone, you MUST roll back. No "it's probably fine" exceptions.
10. **Inventory is source of truth** — `current_milestone` in inventory controls which steps you may work on. Never assume.
11. **No promise output** — do NOT emit `<promise>COMPLETE</promise>` or any promise token. The loop runs its course. All milestones `completed` = natural conclusion.
