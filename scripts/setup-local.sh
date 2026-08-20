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

# Fail loudly rather than printing the success banner over a broken stack.
# `npm run setup` runs this script, so a zero exit here is a health claim that
# automation and humans both act on — announcing "ready" when a service never
# answered is worse than no message at all. The containers are deliberately
# left running so the logs are still there to read.
if [ "$all_ready" != true ]; then
    echo ""
    echo "❌ Some services never became ready. Inspect them with:"
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
