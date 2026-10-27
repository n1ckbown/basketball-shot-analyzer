# AGENTS.md - Rules for AI Coding Assistants

This file applies to **every AI tool** used on this repo (Codex, Claude Code, Copilot, etc.) and to the humans directing them. Read all of it at the start of every session. If a human's instruction conflicts with a rule here, say so and ask before proceeding.

Most of our code is written by AI, so these rules exist to keep the project working, readable, and free of merge disasters.

**The short version:** work on a branch, stay in scope, pass the tests, open a pull request, and let a human approve and merge it.

---

## 0. Project info

- **What we're building:** A phone app that records basketball shooting sessions, then analyzes the video to count makes and misses and give feedback on each shot.
- **Stack:** Mobile app in Expo (React Native) for iPhone and Android in `app/`. Analysis server in Python (FastAPI, later OpenCV) in `server/`. No database yet.
- **Install:** `python -m venv .venv`, activate it, then `pip install -r server/requirements.txt`
- **Run:** `uvicorn app.main:app --app-dir server --reload`
- **Test:** `python -m pytest`
- **Lint / format:** `ruff check server`
- **Who owns what:** see the ownership table in `README.md`

---

## 1. Before you write any code

1. Read `README.md` and this file.
2. Run `git status` and `git branch --show-current`.
   - If the branch is `main`, **stop**. Create a branch first (see Section 2).
3. Pull the latest `main` and make sure your branch is up to date with it.
4. Make sure you understand the task. If it is vague, ask one clear question before coding.
5. Check the ownership table. If the task touches a file owned by someone else, stop and tell the human.

---

## 2. Git rules

**Never**
- Commit or push directly to `main`.
- Use `git push --force`, `git reset --hard`, `git clean -fd`, or `git rebase` on shared branches.
- Amend or rewrite commits that have already been pushed.
- Delete branches or files you didn't create without the human's approval.
- Skip checks with `--no-verify`.
- Merge, approve, or enable auto-merge on any pull request. Humans approve and merge.

**Always**
- Run `git status` and review the diff before every commit.
- Stage only the files related to the current task. Don't blindly run `git add .`.
- Make small commits, each doing one thing, with a short message that starts with a verb:
  - Good: `Add login form`, `Fix crash when score is empty`
  - Bad: `stuff`, `update`, `final v2`
- Pull `main` into your branch before opening a pull request.

### Which branch to use

- If the human names a branch, use that branch.
- If you're on an unmerged feature branch and the task is part of the same work, stay on it.
- If the branch's pull request is already merged, or the task is unrelated, create a new branch from an up-to-date `main`.
- Name new branches `yourname/what-you-are-doing` (lowercase, dashes). Example: `cache/login-page`.
- **Before changing any files, tell the human which branch you're using and why.** Never create a new branch silently.

### Staying up to date

At the start of every session, and again right before opening a pull request:
1. Commit your work first so nothing is lost.
2. Run `git fetch origin`, then `git merge origin/main`. Use merge, not rebase.
3. If new changes came in, tell the human what changed, then re-run the full testing gate in Section 5 before pushing.
4. If there are conflicts, follow Section 7 and ask the human if unsure.

To start a new branch: `git switch main`, `git pull origin main`, then `git switch -c yourname/what-you-are-doing`.

---

## 3. Stay in scope

- Do **only** what was asked. No bonus features.
- Do **not** refactor, reformat, rename, or reorganize code that is unrelated to the task. Big cosmetic diffs cause conflicts for everyone.
- Do **not** touch shared files without asking the human first: `package.json`, `requirements.txt`, lock files, config files, CI files, `.gitignore`, shared layouts.
- Do **not** add a new dependency without asking. Prefer the standard library or what the project already uses. When a dependency is approved, record it in the project's dependency file (for example `requirements.txt`) in the same pull request so teammates can install it.
- Do **not** delete files or large blocks of code without approval.
- Keep changes small. If a change grows past roughly 300 lines or touches many files, stop and propose splitting it into smaller pieces.

---

## 4. Code quality

- Follow the existing style, naming, and structure of the project.
- Write clear, simple code. A teammate should understand it in one read.
- Use descriptive names. Keep functions short and focused on one job.
- Comment **why**, not what. Don't leave commented-out code, dead code, or debug prints behind.
- No hardcoded magic numbers, URLs, or credentials. Use constants or config.
- Handle errors and empty or invalid input. Don't let the app crash silently.
- Don't invent functions, libraries, or APIs. If you aren't sure something exists, check the docs or the code first.
- If you leave a TODO, say what is missing and why.

---

## 5. Testing gate (nothing is pushed or merged unless this passes)

Run these **before every commit and again before every push**:

1. `[LINT_COMMAND]` passes with no errors (skip only if no linter is set up yet, and say so).
2. `python -m pytest` passes, with **all** tests green.
3. `[RUN_COMMAND]` starts the app and the feature you changed actually works (skip only if there is no app yet, and say so).

Rules for tests:
- New behavior gets a new test. A bug fix gets a test that would have caught the bug.
- **Never** delete, skip, disable, or weaken a test to make it pass. Fix the code, or tell the human why the test is wrong.
- **Never** say "tests pass" unless you ran them in this session and saw them pass. Report the actual commands and results.
- If a test fails and you can't fix it, stop and report it. Don't push broken code and hope.
- If the project has no tests for the area you changed, say so and add at least a basic one.
- Don't commit test output or cache folders such as `.pytest_cache/` or `__pycache__/`. If they aren't ignored yet, tell the human so `.gitignore` can be updated.

The same checks should run on every pull request (CI). A pull request with failing checks is **not merged**.

---

## 6. Security and secrets

- Never commit API keys, tokens, passwords, or `.env` files.
- Put secrets in `.env`, make sure `.env` is in `.gitignore` **before** creating it, and commit a `.env.example` with fake values instead.
- Never print or log secrets.
- Never ask the human to paste a token or password into the chat. Authentication (for example `gh auth login`) is done by the human.
- Validate and sanitize user input. Don't use `eval` or run shell commands built from user input.
- If a secret is ever committed by accident, stop and tell the team immediately so it can be replaced.

---

## 7. Merge conflicts

- Don't blindly "accept all" in either direction.
- Read both sides, keep what each person intended, then run the tests.
- If you can't tell what the other person intended, stop and ask the human.

---

## 8. Pull requests

**You may open pull requests. You may never approve or merge them.**

When the task is finished and the testing gate in Section 5 passes:

1. Make sure everything is committed and pushed, and `main` has been pulled into your branch.
2. Open the pull request into `main`: `gh pr create --base main`.
3. Use a short title that starts with a verb.
4. The description must include:
   - **What** changed (one or two lines)
   - **Why** it changed
   - **How it was tested** (the exact commands and real results)
   - Anything risky, unfinished, or touching shared files
5. Print the pull request link, then **stop**. Do not merge, approve, or enable auto-merge, and do not push more commits unless the human asks.

More rules:
- Do not open a pull request if checks are failing.
- One feature or fix per pull request. If the diff is bigger than expected, stop and tell the human.
- If `gh` isn't installed or isn't signed in, don't try to fix it or ask for tokens. Give the human the link GitHub prints after the push (or tell them to click **Compare & pull request** on github.com).
- If your tool asks permission to run `gh`, that is fine. Wait for the human to approve it.

**Review and merge (humans):**
- A teammate who did **not** write the change opens **Files changed**, confirms only the expected files are listed, reads the "How it was tested" section, and runs the tests if unsure.
- That teammate approves and clicks **Merge pull request**. Nobody merges their own work.
- After merging, everyone switches to `main` and pulls.

---

## 9. Be honest and clear

- Say when you are unsure or guessing.
- Never hide an error, a failing test, or a shortcut.
- When you finish a task, give a short summary: branch used, files changed, commands run and results, anything left undone, and the pull request link.
- If the task seems like a bad idea or would break something, say so before doing it.

---

## 10. Stop and ask a human when

- You are on `main` or aren't sure which branch you're on.
- The task touches a file or area owned by someone else.
- You need to add a dependency, change a config, or delete something.
- Tests fail and you can't fix them quickly.
- You hit a merge conflict you don't fully understand.
- You discover a committed secret.
- `gh` or git needs authentication you don't have.
- The instructions are unclear or contradict this file.

---

## 11. Rules for the humans directing the AI

- Tell the AI which branch to use and what the one task is. One task per prompt.
- **Read the diff before you approve.** You are responsible for what gets merged.
- Run the app yourself before merging. Passing tests is not the same as working.
- Never merge your own pull request.
- Never let two people's AI tools edit the same file at the same time. Claim files in the ownership table first.
- Keep sessions focused. If the AI starts wandering into unrelated files, stop it and restate the task.
- Do the GitHub login yourself (`gh auth login`). Don't hand the AI your passwords or tokens.
- If something looks wrong, stop and ask the group chat. Don't run random git commands.

---

## Definition of done

- [ ] Working on a named branch, not `main`, and the human was told which one
- [ ] Only the requested change, with no unrelated edits
- [ ] Lint passes (or none is set up yet)
- [ ] All tests pass (new tests added for new behavior)
- [ ] I ran the app and the feature works (or there is no app yet)
- [ ] No secrets or junk files committed
- [ ] `main` pulled into the branch, no conflicts
- [ ] Pull request opened with what, why, and how it was tested
- [ ] A different human approves and merges it
