#!/usr/bin/env bash
#
# Dev stack for the DrumDash website - all Docker, no nohup, no systemd.
#
# Why containers
# --------------
# The site and Worker used to be `nohup` background jobs. They died silently on
# reboot and left the browser serving a cached page with no error, which twice
# looked like "the site is broken" when the truth was "nothing is listening on
# :4000". Containers with `restart: unless-stopped` come back on their own, and
# `docker ps` is the single place to see the real state.
#
# Layout (one origin - see AGENTS.md 8.1):
#   browser -> :4000  /       static files from _site/
#                     /api/*  reverse-proxied to the Worker
#   :8788              Worker (loopback only; it holds UPSTREAM_API_KEY). Not 8787:
#                      server.sh's Editor proxy owns that port.
#
# The conversion worker (drumdash_worker_dev) is separate: it consumes the queue
# and lives in the DrumDash repo. It is checked here too, because a missing
# consumer makes a submitted job sit forever with no visible reason.
#
# Usage:
#   ./dev.sh start     build the site, then start every container
#   ./dev.sh stop      stop the site/Worker containers
#   ./dev.sh restart
#   ./dev.sh status    what is up, and on which port
#   ./dev.sh logs      tail all logs
#   ./dev.sh build     rebuild _site/ only
#   ./dev.sh shell     shell inside the site container
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_PORT="${SITE_PORT:-4000}"
CONV_CONTAINER="${WORKER_CONTAINER:-drumdash_worker_dev}"

cd "$HERE" || exit 1

c_ok()   { printf '\033[32m%s\033[0m\n' "$*"; }
c_warn() { printf '\033[33m%s\033[0m\n' "$*"; }
c_err()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }

lan_ip() {
    ip -4 addr show scope global 2>/dev/null |
        grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1
}

require_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        c_err "docker is required"
        return 1
    fi
    if ! docker info >/dev/null 2>&1; then
        c_err "docker daemon not reachable (running? in the docker group?)"
        return 1
    fi
}

do_build() {
    require_docker || return 1
    echo "Building site (jekyll/jekyll:4)..."
    if docker compose run --rm --no-deps \
        -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" build \
        >/tmp/dev-build.log 2>&1; then
        c_ok "  built _site/"
    else
        c_err "  build failed - see /tmp/dev-build.log"
        tail -15 /tmp/dev-build.log >&2
        return 1
    fi
}

conv_worker_running() {
    docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONV_CONTAINER"
}

start_conv_worker() {
    if docker container inspect "$CONV_CONTAINER" >/dev/null 2>&1; then
        docker update --restart unless-stopped "$CONV_CONTAINER" >/dev/null 2>&1 || true
        conv_worker_running || docker start "$CONV_CONTAINER" >/dev/null 2>&1
        for _ in $(seq 1 40); do
            conv_worker_running && { c_ok "  Conversion worker ($CONV_CONTAINER)"; return 0; }
            sleep 1
        done
        c_err "  Conversion worker did not start - docker logs $CONV_CONTAINER"
        return 1
    fi
    c_warn "  $CONV_CONTAINER does not exist - build it first:"
    c_warn "    cd ../DrumDash && docker build -t drumdash/worker:dev ."
    return 0
}

do_start() {
    require_docker || return 1
    [[ -f .env ]] || { c_warn "no .env - copying .env.example"; cp .env.example .env; }

    do_build || return 1

    echo "Starting containers..."
    if ! docker compose up -d >/tmp/dev-up.log 2>&1; then
        c_err "docker compose up failed - see /tmp/dev-up.log"
        tail -15 /tmp/dev-up.log >&2
        return 1
    fi

    local ok=0
    for _ in $(seq 1 40); do
        if curl -sf -o /dev/null "http://127.0.0.1:$SITE_PORT/api/health" 2>/dev/null; then
            ok=1; break
        fi
        sleep 0.5
    done
    if [[ $ok -eq 1 ]]; then
        c_ok "  site   http://$(lan_ip):$SITE_PORT/  (page + /api proxy)"
    else
        c_err "  the stack did not become healthy - see ./dev.sh logs"
        docker compose ps 2>&1 | tail -5
        return 1
    fi

    start_conv_worker

    echo
    echo "Open (one origin, no ?api= needed):"
    echo "  http://$(lan_ip):$SITE_PORT/transcription.html"
    echo
    c_warn "Containers restart automatically unless you run ./dev.sh stop."
}

do_stop() {
    docker compose down >/dev/null 2>&1 || true
    c_ok "site + Worker containers stopped"
    if conv_worker_running; then
        c_warn "conversion worker ($CONV_CONTAINER) still running - stop it with:"
        c_warn "  docker stop $CONV_CONTAINER"
    fi
}

do_status() {
    local site worker conv
    site=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SITE_PORT/transcription.html" 2>/dev/null)
    worker=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SITE_PORT/api/health" 2>/dev/null)
    conv=$(conv_worker_running && echo UP || echo DOWN)

    printf "page   :%s  %s\n" "$SITE_PORT" "${site:-000}"
    printf "proxy  :%s/api/health  %s\n" "$SITE_PORT" "${worker:-000}"
    printf "conv   docker  %s  (%s)\n" "$conv" "$CONV_CONTAINER"
    printf "LAN    http://%s:%s/transcription.html\n" "$(lan_ip)" "$SITE_PORT"
    echo
    docker compose ps --format '  {{.Name}}  {{.Status}}' 2>/dev/null
    if [[ "${site:-000}" != "200" || "${worker:-000}" != "200" ]]; then
        c_warn "not healthy - ./dev.sh logs"
    fi
}

do_logs() {
    echo "=== compose (site + Worker) ==="
    docker compose logs --tail 20 2>&1 | tail -25
    if conv_worker_running; then
        echo "=== conversion worker ==="
        docker logs --tail 20 "$CONV_CONTAINER" 2>&1
    fi
}

case "${1:-start}" in
    start)   do_start ;;
    stop)    do_stop ;;
    restart) do_stop; do_start ;;
    status)  do_status ;;
    logs)    do_logs ;;
    build)   do_build ;;
    shell)   docker compose exec site sh ;;
    *)
        c_err "usage: $0 {start|stop|restart|status|logs|build|shell}"
        exit 2
        ;;
esac
