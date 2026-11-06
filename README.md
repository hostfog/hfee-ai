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

## Put it online

You need an Ubuntu 22.04/24.04 (or Debian 12) server and a domain.
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
