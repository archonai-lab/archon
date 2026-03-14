#!/usr/bin/env bash
# =============================================================================
# review.sh — Single-agent review: run checks, then send diff to Claude.
#
# Can be run from any project directory — it reviews the project you're in.
#
# Usage:
#   ./review.sh              # Review all uncommitted changes
#   ./review.sh --staged     # Review only staged changes
#   ./review.sh --branch     # Review all changes vs main branch
#   ./review.sh --fix        # Review + let reviewer suggest fixes
#   ./review.sh --project ~/my-project  # Review a specific project
#   ./review.sh --skip-checks           # Skip tests and type check
# =============================================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Parse args
MODE="all"
FIX_MODE=false
MODEL="sonnet"
MAX_BUDGET="0.50"
PROJECT_DIR="$(pwd)"
SKIP_CHECKS=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --staged)       MODE="staged"; shift ;;
    --branch)       MODE="branch"; shift ;;
    --fix)          FIX_MODE=true; shift ;;
    --model)        MODEL="$2"; shift 2 ;;
    --budget)       MAX_BUDGET="$2"; shift 2 ;;
    --project)      PROJECT_DIR="$(cd "$2" && pwd)"; shift 2 ;;
    --skip-checks)  SKIP_CHECKS=true; shift ;;
    --help|-h)
      echo "Usage: review.sh [--staged|--branch] [OPTIONS]"
      echo ""
      echo "Modes:"
      echo "  (default)   Review all uncommitted changes (staged + unstaged)"
      echo "  --staged    Review only staged changes"
      echo "  --branch    Review all commits on current branch vs main"
      echo ""
      echo "Options:"
      echo "  --fix          Enable fix suggestions (reviewer can propose edits)"
      echo "  --model        Claude model to use (default: sonnet)"
      echo "  --budget       Max budget in USD (default: 0.50)"
      echo "  --project      Project directory to review (default: current directory)"
      echo "  --skip-checks  Skip test and type check steps"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

cd "$PROJECT_DIR"

# ── Step 1: Gather the diff ──────────────────────────────────────────────────

echo -e "${CYAN}━━━ Review Pipeline ━━━${NC}"
echo -e "  Project: ${PROJECT_DIR}"
echo ""

case $MODE in
  staged)
    echo -e "${BLUE}[1/3] Gathering staged changes...${NC}"
    DIFF=$(git diff --cached)
    DIFF_STAT=$(git diff --cached --stat)
    ;;
  branch)
    BASE_BRANCH=$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || echo "HEAD~5")
    echo -e "${BLUE}[1/3] Gathering branch changes vs $(git rev-parse --abbrev-ref HEAD)...${NC}"
    DIFF=$(git diff "$BASE_BRANCH"...HEAD)
    DIFF_STAT=$(git diff "$BASE_BRANCH"...HEAD --stat)
    ;;
  all)
    echo -e "${BLUE}[1/3] Gathering all uncommitted changes...${NC}"
    DIFF=$(git diff HEAD)
    DIFF_STAT=$(git diff HEAD --stat)
    ;;
esac

if [ -z "$DIFF" ]; then
  echo -e "${YELLOW}No changes to review.${NC}"
  exit 0
fi

FILE_COUNT=$(echo "$DIFF_STAT" | tail -1)
echo -e "  ${FILE_COUNT}"
echo ""

# ── Step 2: Run checks (if available and not skipped) ────────────────────────

CHECK_SUMMARY=""
REVIEW_TMPDIR="$(mktemp -d)"
trap 'rm -rf "$REVIEW_TMPDIR"' EXIT

if ! $SKIP_CHECKS; then
  echo -e "${BLUE}[2/3] Running automated checks...${NC}"

  # Tests
  if [ -f "package.json" ]; then
    TEST_CMD=""
    if command -v npx &>/dev/null; then
      if npx --no-install vitest --version &>/dev/null 2>&1; then
        TEST_CMD="npx vitest run --reporter=verbose"
      elif npx --no-install jest --version &>/dev/null 2>&1; then
        TEST_CMD="npx jest"
      elif grep -q '"test"' package.json 2>/dev/null; then
        TEST_CMD="npm test --"
      fi
    fi

    if [ -n "$TEST_CMD" ]; then
      if $TEST_CMD 2>&1 | tee $REVIEW_TMPDIR/tests.txt; then
        echo -e "  ${GREEN}Tests passed${NC}"
        CHECK_SUMMARY="${CHECK_SUMMARY}ALL TESTS PASSED\n"
      else
        echo -e "  ${RED}Tests failed${NC}"
        CHECK_SUMMARY="${CHECK_SUMMARY}TESTS FAILED:\n$(tail -40 $REVIEW_TMPDIR/tests.txt)\n"
      fi
    else
      echo -e "  ${YELLOW}No test runner detected, skipping${NC}"
    fi
  fi

  # Type check
  if [ -f "tsconfig.json" ] && command -v npx &>/dev/null; then
    if npx tsc --noEmit 2>&1 | tee $REVIEW_TMPDIR/tsc.txt; then
      echo -e "  ${GREEN}Type check passed${NC}"
      CHECK_SUMMARY="${CHECK_SUMMARY}TYPE CHECK PASSED\n"
    else
      echo -e "  ${RED}Type check failed${NC}"
      CHECK_SUMMARY="${CHECK_SUMMARY}TYPE CHECK FAILED:\n$(tail -20 $REVIEW_TMPDIR/tsc.txt)\n"
    fi
  fi

  if [ -z "$CHECK_SUMMARY" ]; then
    echo -e "  ${YELLOW}No checks available for this project${NC}"
  fi
  echo ""
else
  echo -e "${YELLOW}[2/3] Skipping checks (--skip-checks)${NC}"
  echo ""
fi

# ── Step 3: Send to Claude reviewer ─────────────────────────────────────────

echo -e "${BLUE}[3/3] Sending to reviewer agent...${NC}"
echo ""

REVIEW_CONTEXT=$(cat <<CONTEXT_EOF
## Changes to Review

### Diff Statistics
$DIFF_STAT
$(if [ -n "$CHECK_SUMMARY" ]; then echo -e "\n### Automated Checks\n${CHECK_SUMMARY}"; fi)
### Full Diff
\`\`\`diff
$DIFF
\`\`\`
CONTEXT_EOF
)

# Reviewer tools — read-only by default, add Edit if --fix mode
if $FIX_MODE; then
  TOOLS="Read Glob Grep Bash(npm test:*) Bash(npx tsc:*) Bash(npx vitest:*)"
else
  TOOLS="Read Glob Grep"
fi

# Unset CLAUDECODE to allow nested invocation
unset CLAUDECODE

echo "$REVIEW_CONTEXT" | claude -p \
  --model "$MODEL" \
  --max-budget-usd "$MAX_BUDGET" \
  --allowedTools "$TOOLS" \
  --system-prompt "$(cat <<'SYSTEM_EOF'
You are a senior code reviewer. You review diffs for correctness, type safety,
security, UX issues, and test coverage.

## Output Format

Start with a verdict: PASS, PASS WITH NOTES, or NEEDS CHANGES.

Then list findings grouped by severity:
- 🔴 **Critical** — Must fix before merge (bugs, security, data loss)
- 🟡 **Warning** — Should fix (UX issues, missing error handling, test gaps)
- 🟢 **Suggestion** — Nice to have (style, performance, refactoring)

For each finding:
- File and line reference
- What the issue is
- Why it matters
- Suggested fix (code snippet if helpful)

Keep it concise. Focus on what's WRONG or MISSING, not what's correct.
SYSTEM_EOF
)"

echo ""
echo -e "${CYAN}━━━ Review Complete ━━━${NC}"
