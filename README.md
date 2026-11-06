# HFee AI

A private AI assistant site in the HF Panel look. Chat runs on
[HFee](https://github.com/hostfog/hfee) (or any OpenAI-compatible endpoint);
optional open-source engines add vision, image generation, voice, web search
and a Python sandbox.

React + Vite frontend, Express backend, SQLite (built into Node 22).

## Features

- **Chat** with streaming replies, Markdown and highlighted code, a model
  picker, and a waiting line when the model is busy.
- **Files**: attach text, code, PDF and images (paperclip, drag and drop, paste).
- **Live preview** of HTML/SVG from a reply, with code view and download.
- **Run code**: Python blocks get a Run button; output and charts appear below.
- **Web search** with numbered sources.
- **Images**: “Create image” in the composer, plus a gallery.
- **Voice**: speak instead of typing, and have replies read aloud.
- **Image understanding**: attached images go to the vision model.
- **Projects**: files and instructions shared by every chat in the project.
- **Memory**: custom instructions and things to remember (“remember that …”).
- **Chats**: rename, search, delete, and share a read-only link.
- **Accounts**: email sign-in; the first account is the admin.
- **Admin**: usage overview, users (plans, roles, disable, delete), plans with
  daily message and image limits, and site settings (sign-ups, models, system prompt).

Features whose engine isn't configured stay hidden.

## Development

```bash
npm install
cp .env.example .env   # set AI_BASE_URL / AI_MODEL (e.g. a local HFee)
npm run server         # API on :3001 (Node 22.13+)
npm run dev            # UI on :5173
```

## Ways to run it

| Where | How |
| --- | --- |
| Linux server | `install.sh` (below) |
| Docker | `docker compose up -d` (below) |
| Windows, macOS, Linux desktop | Download the app from [Releases](https://github.com/hostfog/hfee-ai/releases) |
| Phone | Open your site and choose **Add to Home Screen** / **Install app**, or build the Android and iOS apps in [`mobile/`](mobile/README.md) |

## Desktop app

The desktop app runs everything on your own computer: no account, no
internet needed after the model is downloaded. It starts HFee and the site,
opens your browser, and stops when you choose **Quit**. On first start it
asks you to download a model (qwen2.5:3b, about 2 GB, is a good start).

Models are shared with the `hfee` command line in `~/.hfee/models`; chats are
kept in `%AppData%\HFee AI`, `~/Library/Application Support/HFee AI` or
`~/.config/hfee-ai`.

To build it yourself (needs Node 22 and Go):

```bash
HFEE_SRC=../hfee bash desktop/build.sh linux amd64     # or darwin arm64, windows amd64
```

The macOS app is not notarised yet: the first time, right-click it and choose
**Open**. Windows SmartScreen may ask you to confirm the same way.

## Docker

```bash
echo "SEARXNG_SECRET=$(openssl rand -hex 32)" > .env.docker
docker compose --env-file .env.docker up -d
docker compose logs -f hfee-ai      # first start downloads the models
```

Open http://localhost:3001; the first account you create is the admin.
For HTTPS on a domain, add `DOMAIN=chat.example.com` to `.env.docker` and
start with `--profile https`.

The default image has every feature (about 12 GB of models on first start).
Add `HFEE_TARGET=lite` to `.env.docker` for chat only. Other settings
(`AI_MODEL`, `ALLOW_SIGNUP`, `DAILY_MESSAGES`, `HFEE_NUM_CTX`, `SD_TYPE`) go
in the same file. To build with a local checkout of HFee:
`docker build --build-context hfee=../hfee .`

## Put it online

You need a server running Ubuntu 22.04/24.04, Debian 12, Rocky Linux or
AlmaLinux 9, CentOS Stream 9 or Fedora, and a domain.
For the full feature set, plan for 8+ cores, 32+ GB RAM and ~25 GB of disk.

1. Point your domain at the server with a DNS **A record**.
2. Build the package on your PC (needs Node 22 and Go 1.22):

   ```bash
   HFEE_SRC=../hfee bash deploy/package.sh
   ```

3. Copy it to the server and install:

   ```bash
   scp hfee-ai-server.tar.gz root@<server IP>:
   ssh root@<server IP>
   tar -xzf hfee-ai-server.tar.gz
   bash hfee-ai-server/install.sh --domain chat.example.com --email you@example.com
   ```

The installer sets up HFee, the site, HTTPS (Caddy) and the firewall, then
builds the engines (about 15–30 minutes the first time) and downloads their
models. Options: `--model` (default `qwen2.5:7b`), `--no-engines`,
`--no-signup`, `--daily`, `--ctx`.

To update, build a new package and run the installer again. Users, chats,
images, models and `.env` are kept.

| What      | Where                                   |
|-----------|-----------------------------------------|
| Settings  | `/opt/hfee-ai/.env`                     |
| Database  | `/var/lib/hfee/site/hfee.db`            |
| Images    | `/var/lib/hfee/site/images`             |
| Models    | `/var/lib/hfee/models`, `/var/lib/hfee/engines` |
| Logs      | `journalctl -u hfee-ai -u hfee -f`      |

Add more chat models with `HFEE_HOST=127.0.0.1:11500 hfee pull <model>`,
then enable them in Admin → Site.

## Engines

| Feature      | Engine                     | Model (licence)                         |
|--------------|----------------------------|-----------------------------------------|
| Chat         | HFee                       | Qwen2.5 7B (Apache 2.0)                 |
| Vision       | llama.cpp `llama-server`   | Qwen2.5-VL 3B (Apache 2.0)              |
| Images       | stable-diffusion.cpp       | SDXL-Lightning 4-step (OpenRAIL++)      |
| Voice input  | whisper.cpp server         | Whisper small (MIT)                     |
| Read aloud   | Piper                      | en_GB Alba (credit the voice)           |
| Web search   | SearXNG (Docker)           | —                                       |
| Run code     | Python in bubblewrap       | no network, 30 s CPU, 1 GB memory       |

On a CPU-only server an image takes about a minute, so image requests take
turns. The code sandbox has no network and no access to the rest of the server.
