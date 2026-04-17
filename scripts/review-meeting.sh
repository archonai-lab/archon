#!/usr/bin/env bash
# =============================================================================
# review-meeting.sh — Create an Archon meeting where agents review your code.
#
# Can be run from any project directory — it reviews the project you're in.
#
# Prerequisites:
#   1. Hub running:  cd ~/archon && npx tsx src/index.ts
#   2. Agents registered in DB with identity files in ~/.archon/agents/<id>/
#
# Usage:
#   ./review-meeting.sh                        # Review all uncommitted changes
#   ./review-meeting.sh --staged               # Review only staged changes
#   ./review-meeting.sh --branch               # Review full branch vs main
#   ./review-meeting.sh --agents alice,bob      # Choose agents
#   ./review-meeting.sh --initiator ceo         # Set meeting initiator
#   ./review-meeting.sh --project ~/my-project  # Review a specific project
#   ./review-meeting.sh --skip-checks           # Skip tests and type check
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HUB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Parse args
MODE="all"
AGENTS=""
INITIATOR="ceo"
HUB_URL="ws://localhost:9500"
SUMMARY_MODE="structured"
PROJECT_DIR="$(pwd)"
SKIP_CHECKS=false
BASE_REF=""
HEAD_REF=""
PR_URL=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --staged)       MODE="staged"; shift ;;
    --branch)       MODE="branch"; shift ;;
    --agents)       AGENTS="$2"; shift 2 ;;
    --initiator)    INITIATOR="$2"; shift 2 ;;
    --hub)          HUB_URL="$2"; shift 2 ;;
    --summary)      SUMMARY_MODE="$2"; shift 2 ;;
    --project)      PROJECT_DIR="$(cd "$2" && pwd)"; shift 2 ;;
    --skip-checks)  SKIP_CHECKS=true; shift ;;
    --help|-h)
      echo "Usage: review-meeting.sh [--staged|--branch] [OPTIONS]"
      echo ""
      echo "Modes:"
      echo "  (default)   Review all uncommitted changes"
      echo "  --staged    Review only staged changes"
      echo "  --branch    Review all commits on current branch vs main"
      echo ""
      echo "Options:"
      echo "  --agents       Comma-separated agent IDs (auto-detected from ~/.archon/agents/ if not set)"
      echo "  --initiator    Meeting initiator agent ID (default: ceo)"
      echo "  --hub          Hub WebSocket URL (default: ws://localhost:9500)"
      echo "  --summary      Summary mode: off, structured, llm (default: structured)"
      echo "  --project      Project directory to review (default: current directory)"
      echo "  --skip-checks  Skip test and type check steps"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Preflight checks ─────────────────────────────────────────────────────────

if ! git -C "$PROJECT_DIR" rev-parse --is-inside-work-tree &>/dev/null; then
  echo -e "${RED}ERROR: Not a git repository. Run from a git project or use --project <path>${NC}"
  exit 1
fi

# Check hub is reachable — parse host:port from URL
HUB_HOSTPORT="${HUB_URL#ws://}"
HUB_HOSTPORT="${HUB_HOSTPORT#wss://}"
HUB_HOSTPORT="${HUB_HOSTPORT%%/*}"  # strip trailing path
if [[ "$HUB_HOSTPORT" == *:* ]]; then
  HUB_HOST="${HUB_HOSTPORT%%:*}"
  HUB_PORT="${HUB_HOSTPORT##*:}"
else
  HUB_HOST="$HUB_HOSTPORT"
  HUB_PORT=80
fi
if command -v nc &>/dev/null; then
  if ! nc -z -w 2 "$HUB_HOST" "$HUB_PORT" &>/dev/null; then
    echo -e "${RED}ERROR: Hub not reachable at ${HUB_URL}. Start the hub: cd ~/archon && npm run dev${NC}"
    exit 1
  fi
elif ! (echo >/dev/tcp/"$HUB_HOST"/"$HUB_PORT") &>/dev/null 2>&1; then
  echo -e "${RED}ERROR: Hub not reachable at ${HUB_URL}. Start the hub: cd ~/archon && npm run dev${NC}"
  exit 1
fi

cd "$PROJECT_DIR"
WORKTREE_ROOT="$(git rev-parse --show-toplevel)"
TARGET_REPO="$(basename "$WORKTREE_ROOT")"
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

# ── Auto-detect agents if not specified ──────────────────────────────────────

if [ -z "$AGENTS" ]; then
  ARCHON_AGENTS_DIR="$HOME/.archon/agents"
  if [ -d "$ARCHON_AGENTS_DIR" ]; then
    DETECTED=()
    for agent_dir in "$ARCHON_AGENTS_DIR"/*/; do
      [ -d "$agent_dir" ] || continue
      agent_id=$(basename "$agent_dir")
      # Skip the initiator — they run the meeting, not participate
      [[ "$agent_id" == "$INITIATOR" ]] && continue
      # Only include agents that have identity files
      if [ -f "$agent_dir/SOUL.md" ] || [ -f "$agent_dir/IDENTITY.md" ]; then
        DETECTED+=("$agent_id")
      fi
    done
    if [ ${#DETECTED[@]} -gt 0 ]; then
      AGENTS=$(IFS=,; echo "${DETECTED[*]}")
    fi
  fi
fi

if [ -z "$AGENTS" ]; then
  echo -e "${RED}No agents found. Specify --agents or create identity files in ~/.archon/agents/<id>/${NC}"
  exit 1
fi

echo -e "${CYAN}━━━ Archon Review Meeting ━━━${NC}"
echo -e "  Project:   ${PROJECT_DIR}"
echo -e "  Initiator: ${INITIATOR}"
echo -e "  Agents:    ${AGENTS}"
echo ""

# ── Step 1: Gather the diff ──────────────────────────────────────────────────

case $MODE in
  staged)
    echo -e "${BLUE}[1/3] Gathering staged changes...${NC}"
    DIFF=$(git diff --cached)
    DIFF_STAT=$(git diff --cached --stat)
    HEAD_REF="INDEX"
    ;;
  branch)
    if git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
      BASE_REF="origin/main"
    elif git rev-parse --verify --quiet refs/remotes/origin/master >/dev/null; then
      BASE_REF="origin/master"
    else
      BASE_REF="$(git merge-base HEAD main 2>/dev/null || git merge-base HEAD master 2>/dev/null || echo "HEAD~5")"
    fi
    HEAD_REF="HEAD"
    echo -e "${BLUE}[1/3] Gathering branch changes...${NC}"
    DIFF=$(git diff "$BASE_REF"...$HEAD_REF)
    DIFF_STAT=$(git diff "$BASE_REF"...$HEAD_REF --stat)
    ;;
  all)
    echo -e "${BLUE}[1/3] Gathering all uncommitted changes...${NC}"
    DIFF=$(git diff HEAD)
    DIFF_STAT=$(git diff HEAD --stat)
    BASE_REF="HEAD"
    HEAD_REF="WORKTREE"
    ;;
esac

if [ "$MODE" = "branch" ] && command -v gh >/dev/null 2>&1; then
  PR_URL="$(gh pr view --json url --jq .url 2>/dev/null || true)"
fi

if [ -z "$DIFF" ]; then
  echo -e "${YELLOW}No changes to review.${NC}"
  exit 0
fi

FILE_COUNT=$(echo "$DIFF_STAT" | tail -1)
echo -e "  ${FILE_COUNT}"
echo ""

# ── Step 2: Run checks (if available and not skipped) ────────────────────────

CHECK_RESULTS=""
REVIEW_TMPDIR="$(mktemp -d)"
trap 'rm -rf "$REVIEW_TMPDIR"' EXIT

if ! $SKIP_CHECKS; then
  echo -e "${BLUE}[2/3] Running automated checks...${NC}"

  # Tests — try common test runners
  if [ -f "package.json" ]; then
    TEST_CMD=""
    if command -v npx &>/dev/null; then
      if npx --no-install vitest --version &>/dev/null 2>&1; then
        TEST_CMD="npx vitest run"
      elif npx --no-install jest --version &>/dev/null 2>&1; then
        TEST_CMD="npx jest"
      elif grep -q '"test"' package.json 2>/dev/null; then
        TEST_CMD="npm test --"
      fi
    fi

    if [ -n "$TEST_CMD" ]; then
      if $TEST_CMD > "$REVIEW_TMPDIR/tests.txt" 2>&1; then
        echo -e "  ${GREEN}Tests passed${NC}"
        CHECK_RESULTS="${CHECK_RESULTS}Tests: PASSED\n"
      else
        echo -e "  ${RED}Tests failed${NC}"
        CHECK_RESULTS="${CHECK_RESULTS}Tests: FAILED\n"
      fi
    else
      echo -e "  ${YELLOW}No test runner detected, skipping${NC}"
    fi
  fi

  # Type check — try tsc if available
  if [ -f "tsconfig.json" ] && command -v npx &>/dev/null; then
    if npx tsc --noEmit > "$REVIEW_TMPDIR/tsc.txt" 2>&1; then
      echo -e "  ${GREEN}Type check passed${NC}"
      CHECK_RESULTS="${CHECK_RESULTS}Type check: PASSED\n"
    else
      echo -e "  ${RED}Type check failed${NC}"
      CHECK_RESULTS="${CHECK_RESULTS}Type check: FAILED\n"
    fi
  fi

  # Lint — try if configured
  if [ -f "package.json" ] && grep -q '"lint"' package.json 2>/dev/null; then
    if npm run lint --silent > "$REVIEW_TMPDIR/lint.txt" 2>&1; then
      echo -e "  ${GREEN}Lint passed${NC}"
      CHECK_RESULTS="${CHECK_RESULTS}Lint: PASSED\n"
    else
      echo -e "  ${RED}Lint failed${NC}"
      CHECK_RESULTS="${CHECK_RESULTS}Lint: FAILED\n"
    fi
  fi

  if [ -z "$CHECK_RESULTS" ]; then
    echo -e "  ${YELLOW}No checks available for this project${NC}"
  fi
  echo ""
else
  echo -e "${YELLOW}[2/3] Skipping checks (--skip-checks)${NC}"
  echo ""
fi

# ── Step 3: Create review meeting via Archon hub ─────────────────────────────

echo -e "${BLUE}[3/3] Creating review meeting on Archon hub...${NC}"
echo ""

# Build agenda
AGENDA=$(cat <<AGENDA_EOF
Code Review — ${FILE_COUNT}
$(if [ -n "$CHECK_RESULTS" ]; then echo -e "\nAutomated checks:\n${CHECK_RESULTS}"; fi)

Review target:
- Target repo: ${TARGET_REPO}
- Workspace path: ${WORKTREE_ROOT}
- Current branch: ${CURRENT_BRANCH}
- Review mode: ${MODE}
- Base ref: ${BASE_REF:-"(not applicable)"}
- Head ref: ${HEAD_REF:-"(not applicable)"}
$(if [ -n "$PR_URL" ]; then echo "- PR URL: ${PR_URL}"; fi)

Reviewer self-check:
- Run \`pwd\`
- Run \`git rev-parse --show-toplevel\`
- Run \`git branch --show-current\`
$(if [ "$MODE" = "branch" ]; then echo "- Run \`git diff --name-only ${BASE_REF}...${HEAD_REF}\`"; elif [ "$MODE" = "staged" ]; then echo "- Run \`git diff --name-only --cached\`"; else echo "- Run \`git diff --name-only HEAD\`"; fi)
- If those commands do not match the target repo/workspace/branch above, stop immediately and reply with \`INVALID REVIEW SURFACE\`

Changed files:
${DIFF_STAT}
AGENDA_EOF
)

# Run the start-meeting script from the hub repo
cd "$HUB_DIR"

# Unset CLAUDECODE to allow nested sessions
unset CLAUDECODE

exec npx tsx scripts/start-meeting.ts \
  --initiator "$INITIATOR" \
  --agents "$AGENTS" \
  --title "Code Review: $(cd "$PROJECT_DIR" && git log --oneline -1 HEAD 2>/dev/null || echo 'uncommitted changes')" \
  --agenda "$AGENDA" \
  --hub "$HUB_URL"
