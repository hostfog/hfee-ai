# Package and service helpers shared by install.sh and engines.sh, so the
# same steps work on Debian/Ubuntu (apt) and RHEL/Rocky/Alma/CentOS/Fedora (dnf).
# shellcheck shell=bash

# shellcheck disable=SC1091
. /etc/os-release
case " ${ID:-} ${ID_LIKE:-} " in
  *" debian "* | *" ubuntu "*) OS_FAMILY=debian ;;
  *" rhel "* | *" fedora "* | *" centos "*) OS_FAMILY=rhel ;;
  *)
    echo "Unsupported system: ${PRETTY_NAME:-unknown}. HFee AI supports Ubuntu, Debian, Rocky, AlmaLinux, CentOS Stream and Fedora." >&2
    exit 1
    ;;
esac

step() { printf '\n\033[1;38;2;216;120;88m==>\033[0m %s\n' "$*"; }

# pkg_install <common names...>: installs packages, translating names where the families differ.
pkg_install() {
  local pkgs=()
  for p in "$@"; do
    if [[ "$OS_FAMILY" == rhel ]]; then
      case "$p" in
        build-essential) pkgs+=(gcc gcc-c++ make) ;;
        python3-venv) pkgs+=(python3) ;;
        curl) command -v curl >/dev/null || pkgs+=(curl) ;; # curl-minimal is enough and conflicts with curl
        ufw | debian-keyring | debian-archive-keyring | apt-transport-https) ;; # not used on RHEL
        *) pkgs+=("$p") ;;
      esac
    else
      pkgs+=("$p")
    fi
  done
  [[ ${#pkgs[@]} -eq 0 ]] && return

  if [[ "$OS_FAMILY" == debian ]]; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${pkgs[@]}" >/dev/null
  else
    dnf install -y -q --setopt=install_weak_deps=False "${pkgs[@]}" >/dev/null
  fi
}

pkg_update() {
  if [[ "$OS_FAMILY" == debian ]]; then
    apt-get update -qq
  else
    dnf makecache -q >/dev/null
  fi
}

install_node() {
  if node -e 'process.exit(+process.versions.node.split(".")[0] >= 22 ? 0 : 1)' 2>/dev/null; then
    return
  fi
  step "Installing Node.js 22"
  if [[ "$OS_FAMILY" == debian ]]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  else
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - >/dev/null
  fi
  pkg_install nodejs
}

install_caddy() {
  command -v caddy >/dev/null && return
  step "Installing Caddy"
  if [[ "$OS_FAMILY" == debian ]]; then
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
  else
    dnf install -y -q 'dnf-command(copr)' >/dev/null
    dnf copr enable -y -q @caddy/caddy >/dev/null
  fi
  pkg_install caddy
}

# enable_extra_repos adds the repositories RHEL-family systems need for ffmpeg.
enable_extra_repos() {
  [[ "$OS_FAMILY" == rhel ]] || return 0
  if [[ "${ID:-}" == fedora ]]; then
    dnf install -y -q "https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-$(rpm -E %fedora).noarch.rpm" >/dev/null
  else
    dnf install -y -q epel-release >/dev/null
    dnf config-manager --set-enabled crb >/dev/null 2>&1 || true
    dnf install -y -q "https://mirrors.rpmfusion.org/free/el/rpmfusion-free-release-$(rpm -E %rhel).noarch.rpm" >/dev/null
  fi
}

# install_containers provides a `docker` command: Docker on Debian, Podman on RHEL.
install_containers() {
  if [[ "$OS_FAMILY" == debian ]]; then
    pkg_install docker.io
    systemctl enable --now docker >/dev/null
  else
    pkg_install podman podman-docker
    touch /etc/containers/nodocker # silence podman's docker-emulation notice
  fi
}

# container_unit_deps prints the systemd dependency lines for container services.
container_unit_deps() {
  if [[ "$OS_FAMILY" == debian ]]; then
    printf 'After=docker.service\nRequires=docker.service\n'
  else
    printf 'After=network-online.target\n'
  fi
}

open_firewall() {
  step "Opening the firewall (SSH, HTTP, HTTPS)"
  if [[ "$OS_FAMILY" == debian ]]; then
    pkg_install ufw
    ufw allow OpenSSH >/dev/null
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    ufw --force enable >/dev/null
  elif systemctl is-active --quiet firewalld; then
    firewall-cmd -q --permanent --add-service=ssh --add-service=http --add-service=https
    firewall-cmd -q --reload
  fi
}

# allow_proxy lets Caddy connect to the site when SELinux is enforcing.
allow_proxy() {
  if command -v getenforce >/dev/null && [[ "$(getenforce)" != Disabled ]]; then
    setsebool -P httpd_can_network_connect 1
  fi
}
