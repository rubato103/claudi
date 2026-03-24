# claud.i

Personal AI assistant powered by Claude Code — always-on Telegram bot with multi-session support.

```
   _____ _                 _   _
  / ____| |               | | (_)
 | |    | | __ _ _   _  __| |  _
 | |    | |/ _` | | | |/ _` | | |
 | |____| | (_| | |_| | (_| |_| |
  \_____|_|\__,_|\__,_|\__,(_)_|
```

## What is this?

A lightweight bridge between Telegram and Claude Code. Unlike OpenClaw (which is a full agent framework), claud.i leverages Claude Code's native capabilities — coding, file access, git, MCP servers — and just adds a Telegram interface on top.

## Architecture

```
Telegram ←→ TelegramBot ←→ Router ←→ SessionManager ←→ Claude Code CLI
                                          ↕
                                    SessionStore (SQLite)
```

- **Per-chat context isolation** — each Telegram chat gets its own Claude Code session
- **Session persistence** — conversations survive restarts via `--resume`
- **Sequential message processing** — no context interleaving within a chat
- **Access control** — allowlist of Telegram user IDs

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/rubato103/claudi.git
cd claudi
npm install

# 2. Configure
cp .env.example .env
# Edit .env — set TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USERS

# 3. Run
npm start
```

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/project <path>` | Set working directory for this chat |
| `/reset` | Reset conversation (clear context) |
| `/sessions` | List active sessions |
| `/help` | Show available commands |

## Proxmox Deployment

```bash
# In an LXC container or VM:

# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Clone and setup
git clone https://github.com/rubato103/claudi.git
cd claudi
npm install
cp .env.example .env
nano .env  # configure

# Run with systemd (recommended)
sudo cp claudi.service /etc/systemd/system/
sudo systemctl enable claudi
sudo systemctl start claudi
```

## systemd Service

See `claudi.service` for a ready-to-use systemd unit file.

## Configuration

| Env Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | From @BotFather |
| `TELEGRAM_ALLOWED_USERS` | Recommended | (open) | Comma-separated user IDs |
| `CLAUDE_PATH` | No | `claude` | Path to claude CLI |
| `SESSIONS_DIR` | No | `./data` | Session data directory |
| `SESSION_IDLE_TIMEOUT` | No | `30` | Idle timeout (minutes) |
| `MAX_SESSIONS` | No | `5` | Max concurrent sessions |

## Roadmap

- [ ] Streaming responses (progressive message updates)
- [ ] File/image upload support
- [ ] Inline keyboard for permission approval
- [ ] Cron job / scheduled tasks
- [ ] Webhook mode (alternative to polling)
- [ ] Web dashboard

## License

MIT
