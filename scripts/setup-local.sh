#!/bin/bash

# Chautauqua Calendar - Local Development Setup Script

set -e

# Run from the repo root no matter where this was invoked from: every
# `docker compose` call below resolves docker-compose.yml relative to cwd.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "🎪 Setting up Chautauqua Calendar for local development..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is available
if ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not available. Please install Docker with Compose plugin."
    exit 1
fi

# npm is required even though the services themselves run in Docker: this
# script installs the workspace tree on the host too, so editors, type-checking
# and host-run tests work. Checked up front rather than letting `npm ci` below
# fail with a bare "command not found".
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Node.js 24+ is required (see .nvmrc)."
    exit 1
fi

# curl and node are what the readiness and content checks at the end are made
# of. Both are checked here, before `npm ci` and a Docker build, because
# finding out they are missing only after several minutes of building is the
# same first-run confusion those checks exist to prevent. npm being present
# does not imply node is on PATH (a broken nvm shim, a partial install), so
# node is checked by name.
for tool in curl node; do
    if ! command -v "$tool" &> /dev/null; then
        echo "❌ $tool is not installed. It is needed to check the stack actually"
        echo "   serves events once it is up."
        exit 1
    fi
done

# Is anything listening on this port? Uses a raw TCP connect rather than
# lsof/ss process inspection: Docker's port-forwarding sockets are owned by
# root, so a non-root lsof cannot see them and a real conflict slips through
# unnoticed. /dev/tcp is a bash builtin — this is why the shebang above is
# bash and not sh; do not "portability-fix" it.
# Both loopbacks are probed: Docker's published ports bind dual-stack, but a
# stray host process bound only to ::1 would otherwise slip through a v4-only
# check and fail confusingly later.
port_in_use() {
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0
    (exec 3<>"/dev/tcp/::1/$1") 2>/dev/null
}

# The container that legitimately owns each port when this project's stack is
# already up. Re-running setup against a live stack should be a no-op rather
# than a hard exit, but only this project's own container earns that pass —
# anything else on the port is a genuine conflict.
port_owner() {
    case "$1" in
        3000) echo "chq-calendar-frontend" ;;
        3001) echo "chq-calendar-backend" ;;
        8000) echo "chq-calendar-dynamodb" ;;
        8001) echo "chq-calendar-dynamodb-admin" ;;
        4566) echo "chq-calendar-localstack" ;;
        *)    echo "" ;;
    esac
}

# `docker ps` rather than `docker compose ps`: it does not depend on cwd or on
# the Compose version supporting Go-template --format.
container_running() {
    [ -n "$1" ] || return 1
    docker ps --filter "name=^${1}$" --filter status=running --format '{{.Names}}' 2>/dev/null \
        | grep -qx "$1"
}

check_port() {
    local port=$1
    local owner
    port_in_use "$port" || return 0

    owner=$(port_owner "$port")
    if container_running "$owner"; then
        echo "ℹ️  Port $port is held by $owner — reusing the running stack."
        return 0
    fi

    echo "❌ Port $port is already in use. Please stop the service using this port."
    exit 1
}

# Check required ports
echo "🔍 Checking if required ports are available..."
check_port 3000
check_port 3001
check_port 8000
check_port 8001
check_port 4566

# No manual `docker network create` here: docker-compose.yml declares the
# network without a `name:`, so Compose creates and owns its own network named
# <project>_chq-calendar-network — where <project> is COMPOSE_PROJECT_NAME, or
# the directory name if that is unset. A hand-made `chq-calendar-network` is
# attached to nothing, survives `docker compose down -v`, and just accumulates
# on developer machines as a decoy when debugging connectivity.
# `docker compose config` prints the resolved name if you need it.

# Install host-side dependencies. This is an npm workspaces monorepo with a
# single root lockfile; installing per-workspace builds nested trees that fight
# it. One root `npm ci` installs every workspace at exactly the locked versions.
echo "📦 Installing dependencies (all workspaces)..."
npm ci

# Build and start services.
#
# --renew-anon-volumes is load-bearing: the anonymous volumes that hold each
# container's node_modules survive `up --build`, so without it a rebuilt image
# is masked by the previous run's dependency tree and a lockfile change never
# takes effect. That silent staleness is the same class of bug this setup
# exists to fix, so pay the reinstall rather than risk it.
echo "🚀 Building and starting services..."
docker compose up -d --build --renew-anon-volumes

# Poll for readiness rather than sleeping a fixed interval and hoping. The
# backend container compiles tools/publisher-format with tsc before it starts
# the dev server, and the --renew-anon-volumes above discards that build on
# every run — so a cold start routinely takes longer than the 10s this used to
# sleep, and a fixed wait reports "failed to start" for a container that is
# merely still compiling. That false negative is exactly the kind of first-run
# confusion this script exists to prevent.
wait_for() {
    local label=$1 port=$2 url=$3 tries=${4:-90}
    local i
    for ((i = 1; i <= tries; i++)); do
        if curl -s -o /dev/null --max-time 3 "$url"; then
            echo "✅ $label is running on port $port"
            return 0
        fi
        sleep 1
    done
    echo "❌ $label failed to start (no response from $url after ${tries}s)"
    return 1
}

echo "⏳ Waiting for services to become ready..."
all_ready=true
wait_for "DynamoDB Local" 8000 http://localhost:8000        || all_ready=false
wait_for "Backend API"    3001 http://localhost:3001/health || all_ready=false
wait_for "Frontend"       3000 http://localhost:3000        || all_ready=false
wait_for "DynamoDB Admin" 8001 http://localhost:8001        || all_ready=false
# /_localstack/health rather than /: LocalStack's root path 404s. This check
# exists because a license-gated or otherwise broken LocalStack exits shortly
# after start, which every check above is blind to (issue #247 item 1).
wait_for "LocalStack (S3)" 4566 http://localhost:4566/_localstack/health || all_ready=false

# Every check above asks "did something answer?" — none of them asks "did it
# answer with anything?". That gap is #286: a fresh clone brought up a stack
# where all five services were genuinely healthy and the calendar rendered
# zero events, and this script printed the success banner over it. #214 and
# #247 were the same shape. So assert content, once, on the one file the
# calendar cannot render without.
#
# It runs through the frontend rather than against the CDN directly, because
# what is being tested is the path the browser will actually take — including
# the /cache proxy rule in frontend/vite.config.ts, which is the piece that
# makes a fresh clone work at all.
#
# Every input to that path is read from the running frontend, never worked
# out here. An earlier version picked /data or /cache from this shell's
# VITE_LOCAL_DATA and computed the year from the October turnover, and both
# guesses could be wrong while the browser was right: under Docker the
# container's VITE_LOCAL_DATA can come from the root .env or the bind-mounted
# frontend/.env.local rather than this shell, and the browser takes its year
# from years.json's defaultYear, not from a clock. A check that probes a
# different file than the browser asks for passes over an empty calendar —
# which is #286, the thing it exists to catch.
#
# Takes the frontend's origin so it can be exercised against a dev server on
# another port; setup itself always uses the default.
check_events() {
    local origin=${1:-http://localhost:3000}
    local base year year_from month url count

    # Already checked up front by this script, but repeated so the function
    # stands on its own — it is lifted out and run against a bare dev server
    # to test it, and a missing tool must not read as "zero events".
    if ! command -v curl > /dev/null 2>&1 || ! command -v node > /dev/null 2>&1; then
        echo "❌ Cannot check the calendar's data: curl and node are both required."
        return 1
    fi

    # 1. Which data base the app reads.
    #
    # Asked of the app itself: Vite's dev server serves each source module
    # transformed, with import.meta.env inlined from everything Vite resolved —
    # the process environment (this shell, or Compose's environment block,
    # which is fed by the shell and the root .env) and frontend/.env* files,
    # with process.env winning. So evaluating the served dataSource.ts and
    # calling its dataBase() gives exactly the answer the browser gets,
    # including any gate inside it (it honours VITE_LOCAL_DATA only under the
    # dev server), with no second copy of that rule here to drift from it.
    #
    # This depends on dataSource.ts staying import-free: node cannot resolve
    # the /src/... specifiers Vite rewrites imports to. If that ever changes
    # the evaluation fails, and this reports that it could not tell rather
    # than guessing — a guess is how the earlier version passed over #286.
    #
    # It also means node executes whatever the dev server on ${origin} serves
    # at that path. That is a deliberate trade: this function only runs
    # against the stack this script just started, after the port checks above
    # established nothing else held those ports, and the code it runs is this
    # repo's own dataSource.ts.
    base=$(curl -fsS --max-time 30 "${origin}/src/lib/dataSource.ts" 2>/dev/null \
        | node --input-type=module -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",async()=>{try{const m=await import("data:text/javascript,"+encodeURIComponent(s));const b=m.dataBase();if(typeof b!=="string"||b[0]!=="/")throw 0;console.log(b)}catch{process.exit(1)}})' \
        2>/dev/null) || base=""

    if [ -z "$base" ]; then
        echo ""
        echo "❌ Could not work out which data source the frontend reads."
        echo "   This check evaluates dataBase() from"
        echo "   ${origin}/src/lib/dataSource.ts, and that failed — either the"
        echo "   frontend did not serve it, or dataSource.ts changed shape (it"
        echo "   must stay free of imports for this to work). The calendar may"
        echo "   well be fine; open ${origin} and look."
        return 1
    fi

    # 2. Which season the app asks for.
    #
    # useAvailableYears reads ${base}/years.json and useSelectedYear takes its
    # defaultYear, so that is the year to probe. The two can disagree with a
    # clock: the server flips defaultYear on its own schedule, and a local
    # years.json says whatever it said when it was written. Only when the
    # manifest is missing or unreadable does the app fall back to
    # getDefaultYear(), so only then does this.
    year=$(curl -fsS --max-time 30 "${origin}${base}/years.json" 2>/dev/null \
        | node -e 'let b="";process.stdin.on("data",c=>b+=c).on("end",()=>{try{const y=JSON.parse(b).defaultYear;if(!Number.isInteger(y))throw 0;console.log(y)}catch{process.exit(1)}})' \
        2>/dev/null) || year=""

    if [ -n "$year" ]; then
        year_from="defaultYear in ${base}/years.json"
    else
        # The same October turnover as getDefaultYear().
        #
        # TZ is load-bearing, not decoration. The turnover is defined in the
        # Institution's timezone (frontend/src/lib/constants.ts reads it
        # through chqParts), so a contributor east of Eastern running this at
        # 22:00 ET on Sep 30 is already on October 1 by their own clock — a
        # bare `date` would check next season's file while their browser
        # asked for this one.
        #
        # `10#` because `date +%m` zero-pads, and 08/09 are invalid octal.
        year=$(TZ=America/New_York date +%Y)
        month=$((10#$(TZ=America/New_York date +%m)))
        if [ "$month" -ge 10 ]; then
            year=$((year + 1))
        fi
        year_from="no readable ${base}/years.json, so the app falls back to the October turnover"
    fi

    url="${origin}${base}/all-events-${year}.json"

    echo "🔎 Checking the calendar has events for ${year} (${year_from})..."

    # 3. Whether that file has anything in it.
    #
    # Counted by node rather than grepped: a substring count over 5MB of
    # descriptions is a guess where this needs to be a fact. Prints 0 for
    # anything unparseable or unexpectedly shaped, which is the answer we
    # want in every such case.
    #
    # --max-time is generous: ~5MB proxied to the CDN on a cold cache.
    count=$(curl -s --max-time 60 "$url" \
        | node -e 'let b="";process.stdin.on("data",c=>b+=c).on("end",()=>{try{const d=JSON.parse(b);console.log(Array.isArray(d.data)?d.data.length:0)}catch{console.log(0)}})' \
        2>/dev/null) || count=0

    if [ "${count:-0}" -eq 0 ] 2>/dev/null || [ -z "${count:-}" ]; then
        echo ""
        echo "❌ The stack is up, but the calendar has no events to show."
        echo "   Fetched: $url"
        echo ""
        if [ "$base" = "/data" ]; then
            echo "   The frontend is in local-data mode (VITE_LOCAL_DATA=true),"
            echo "   so it reads frontend/public/data/ — which git ignores, so a"
            echo "   fresh clone has nothing there. The value came from this"
            echo "   shell, the root .env (under Docker) or a frontend/.env*"
            echo "   file such as frontend/.env.local."
            echo "   Either fetch the published ${year} feed, no AWS needed:"
            echo "     curl -fo frontend/public/data/all-events-${year}.json \\"
            echo "       https://www.chqcal.org/cache/calendar-cache/all-events-${year}.json"
            echo "   or sync one (needs AWS credentials):"
            echo "     npm run sync:local --workspace=backend"
            echo "   See backend/README-LOCAL-SYNC.md. Or unset VITE_LOCAL_DATA"
            echo "   wherever it is set, and restart, to load from the CDN."
        else
            echo "   The frontend proxies /cache to https://www.chqcal.org"
            echo "   (see the '/cache' rule in frontend/vite.config.ts), so this"
            echo "   usually means no outbound network. To work offline, sync a"
            echo "   local copy and set VITE_LOCAL_DATA=true:"
            echo "     npm run sync:local --workspace=backend"
            echo "   See backend/README-LOCAL-SYNC.md."
        fi
        return 1
    fi

    echo "✅ Calendar data for ${year} is reachable from ${base} (${count} events)"
    return 0
}

if [ "$all_ready" = true ]; then
    check_events || all_ready=false
fi

# Fail loudly rather than printing the success banner over a broken stack.
# `npm run setup` runs this script, so a zero exit here is a health claim that
# automation and humans both act on — announcing "ready" when a service never
# answered is worse than no message at all. The containers are deliberately
# left running so the logs are still there to read.
if [ "$all_ready" != true ]; then
    echo ""
    echo "❌ The stack is not ready. Inspect it with:"
    echo "     docker compose logs -f"
    echo ""
    echo "   The stack is still running. Fix the problem and re-run this"
    echo "   script, or tear it down with: docker compose down"
    exit 1
fi

echo ""
echo "🎉 Local development environment is ready!"
echo ""
echo "📋 Services:"
echo "   • Frontend:        http://localhost:3000"
echo "   • Backend API:     http://localhost:3001"
echo "   • DynamoDB Local:  http://localhost:8000"
echo "   • DynamoDB Admin:  http://localhost:8001"
echo "   • LocalStack (S3): http://localhost:4566"
echo ""
echo "🔧 Useful commands:"
echo "   • View logs:       docker compose logs -f"
echo "   • Stop services:   docker compose down"
echo "   • Restart:         docker compose restart"
echo "   • Rebuild:         docker compose up -d --build --renew-anon-volumes"
echo "                      (--renew-anon-volumes is required after any"
echo "                       package.json / package-lock.json change)"
echo ""
echo "🗄️  Database:"
echo "   • DynamoDB tables are created by the backend container on every"
echo "     start (see backend/Dockerfile.dev; npm run init-tables is idempotent)"
echo "   • DynamoDB Local runs with -inMemory: data is discarded whenever"
echo "     the container restarts"
echo "   • Use DynamoDB Admin UI to view/edit data"
echo ""
echo "Happy coding! 🚀"
