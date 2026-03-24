# claud.i

Personal AI assistant powered by Claude Code — always-on Telegram bot with auto-routing agents, skills, cron jobs, webhooks, and streaming responses.

```
   _____ _                 _   _
  / ____| |               | | (_)
 | |    | | __ _ _   _  __| |  _
 | |    | |/ _` | | | |/ _` | | |
 | |____| | (_| | |_| | (_| |_| |
  \_____|_|\__,_|\__,_|\__,(_)_|
```

## What is this?

A lightweight, extensible bridge between Telegram and Claude Code. Unlike OpenClaw (which is a full agent framework with 5,000+ files), claud.i leverages Claude Code's native capabilities — coding, file access, git, MCP servers — and adds a Telegram interface with agent orchestration on top.

**Key design principle:** Start with an empty canvas and grow by adding markdown files. No code changes needed to add agents, skills, or cron jobs.

## Architecture

```
Telegram ←→ Bot ←→ Router ←→ SessionManager ←→ Claude Code CLI
                     │              ↕
                IntentRouter    SessionStore (JSON)
                     │
              ┌──────┼──────┐
              ↓      ↓      ↓
          AgentLoader SkillLoader HandoffManager
          agents/*.md skills/*.md  data/handoff.json
```

- **Per-chat session isolation** — each chat gets its own Claude Code session
- **Auto-routing** — messages automatically routed to the right agent by keyword triggers
- **Session persistence** — conversations survive restarts via `--resume`
- **Streaming responses** — progressive message updates in Telegram
- **Handoff protocol** — context persists across sessions

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

## Extensibility — Add Features Without Code

### Add an Agent

Create `agents/my-agent.md`:

```markdown
---
name: my-agent
description: What this agent does
icon: 🎯
triggers: keyword1,keyword2,한국어키워드
---

System prompt for this agent...
```

Restart → auto-routing picks it up. Messages containing trigger keywords are routed automatically.

Set `default: true` in frontmatter to make an agent the fallback for unmatched messages.

### Add a Skill

Create `skills/my-skill.md`:

```markdown
---
name: my-skill
description: What this skill does
trigger: keyword1,keyword2
---

Instructions injected into Claude's prompt when triggered...
```

### Add a Cron Job (from Telegram)

```
/cron 0 9 * * 1-5 오전 뉴스 브리핑 해줘
/cron 30 7 * * * 오늘 일정 알려줘
```

### Register a Webhook

```
/webhook ci-notify CI build result: {{payload}}
```

Then `POST http://your-server:3000/webhook/<id>` from CI/CD.

## Built-in Agents

| Agent | Icon | Triggers | Role |
|-------|------|----------|------|
| jarvis | 🦾 | (default) | Main orchestrator, general assistant |
| developer | 💻 | 코드, debug, fix, 버그... | Code writing, debugging, refactoring |
| analyst | 📊 | 뉴스, briefing, 요약... | News briefing, data analysis |
| investor | 💰 | 주식, 매수, portfolio... | Portfolio management, trading |
| iot | 🏠 | 조명, temperature, 불 켜... | Home automation via Home Assistant |
| devops | 🚀 | docker, nginx, 서버... | Infrastructure, CI/CD, deployment |
| reviewer | 🔍 | review, 코드 리뷰... | Code review, security audit |
| writer | 📝 | readme, 문서, blog... | Technical writing, documentation |

All agents are defined in `agents/*.md` — edit or delete freely.

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/help` | Show all commands |
| `/agents` | List available agents |
| `/agent <name>` | Manually switch agent |
| `/agent off` | Return to auto-routing |
| `/project <path>` | Set working directory |
| `/reset` | Reset session and agent |
| `/sessions` | List active sessions |
| `/briefing` | Generate news briefing |
| `/cron <schedule> <prompt>` | Add scheduled task |
| `/crons` | List scheduled tasks |
| `/uncron <id>` | Remove task |
| `/webhook <name> [template]` | Register webhook |
| `/webhooks` | List webhooks |
| `/unwebhook <id>` | Remove webhook |
| `/skills` | List loaded skills |

You can also send **photos, files, and voice messages** — they are downloaded and passed to Claude.

## Proxmox Deployment

```bash
# In an LXC container or VM (Ubuntu 24.04 / Debian 12):

# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Authenticate Claude (one-time)
claude auth login

# Clone and setup
git clone https://github.com/rubato103/claudi.git /opt/claudi
cd /opt/claudi
npm install
cp .env.example .env
nano .env  # set TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USERS

# Test run
npm start

# Setup systemd for always-on
useradd -r -s /bin/bash -m claudi
chown -R claudi:claudi /opt/claudi
cp claudi.service /etc/systemd/system/
systemctl enable claudi
systemctl start claudi

# Check logs
journalctl -u claudi -f
```

## Integrating Existing Scripts (e.g., OpenClaw migration)

If you have existing Python scripts (calendar notifications, trading bots, etc.), run them via cron:

```
# From Telegram:
/cron 30 7 * * * python3 /path/to/daily_schedule_notify.py
/cron 0 9 * * 1-5 python3 /path/to/investment_bot.py
```

Or use the system crontab for scripts that don't need Claude:

```bash
# Traditional crontab for standalone scripts
crontab -e
30 7 * * * cd /opt/scripts && python3 daily_schedule_notify.py
```

Claude Code's MCP servers (Google Calendar, Gmail, Notion) can replace many custom Python scripts — just ask the agent directly:

```
"오늘 캘린더 일정 알려줘"     → Claude uses Google Calendar MCP
"읽지 않은 메일 확인해줘"     → Claude uses Gmail MCP
"브리핑 결과를 노션에 저장해줘" → Claude uses Notion MCP
```

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | From @BotFather |
| `TELEGRAM_ALLOWED_USERS` | Recommended | (open) | Comma-separated user IDs |
| `BOT_NAME` | No | Jarvis | Bot display name |
| `BOT_EMOJI` | No | 🦾 | Bot icon |
| `BOT_USER_NAME` | No | 형님 | How to address the user |
| `BOT_LANGUAGE` | No | ko | Primary language |
| `CLAUDE_PATH` | No | claude | Path to claude CLI |
| `SESSIONS_DIR` | No | ./data | Session data directory |
| `AGENTS_DIR` | No | ./agents | Agent definitions |
| `SKILLS_DIR` | No | ./skills | Skill definitions |
| `SESSION_IDLE_TIMEOUT` | No | 30 | Idle timeout (minutes) |
| `MAX_SESSIONS` | No | 5 | Max concurrent sessions |
| `WEBHOOK_ENABLED` | No | true | Enable webhook server |
| `WEBHOOK_PORT` | No | 3000 | Webhook server port |

## Project Structure

```
claudi/
├── src/
│   ├── index.js                 # Entry point
│   ├── config.js                # Environment config
│   ├── telegram/bot.js          # Telegram bot (streaming + media)
│   ├── router/
│   │   ├── router.js            # Command + message routing
│   │   └── intent-router.js     # Auto-routing (reads agent triggers)
│   ├── sessions/
│   │   ├── session-manager.js   # Session lifecycle
│   │   ├── session-store.js     # JSON persistence
│   │   ├── claude-process.js    # Claude CLI process manager
│   │   └── handoff.js           # Cross-session context
│   ├── agents/agent-loader.js   # Load agents from markdown
│   ├── skills/skill-loader.js   # Load skills from markdown
│   ├── cron/scheduler.js        # Cron job scheduler
│   ├── webhook/server.js        # Webhook HTTP server
│   └── workflows/briefing.js    # News briefing workflow
├── agents/                      # Agent definitions (markdown)
├── skills/                      # Skill definitions (markdown)
├── claudi.service               # systemd service file
├── .env.example                 # Configuration template
└── package.json
```

## License

MIT
