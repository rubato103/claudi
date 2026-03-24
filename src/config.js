/**
 * claud.i Configuration
 *
 * Environment variables:
 *   TELEGRAM_BOT_TOKEN  - Telegram Bot API token (from @BotFather)
 *   TELEGRAM_ALLOWED_USERS - Comma-separated Telegram user IDs (security allowlist)
 *   CLAUDE_PATH         - Path to claude CLI (default: "claude")
 *   SESSIONS_DIR        - Directory for session data (default: ./data)
 *   SESSION_IDLE_TIMEOUT - Minutes before idle session is closed (default: 30)
 *   MAX_SESSIONS        - Maximum concurrent Claude sessions (default: 5)
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, "..");

const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || "",
    allowedUsers: process.env.TELEGRAM_ALLOWED_USERS
      ? process.env.TELEGRAM_ALLOWED_USERS.split(",").map((id) => id.trim())
      : [],
  },
  claude: {
    path: process.env.CLAUDE_PATH || "claude",
  },
  sessions: {
    dir: resolve(process.env.SESSIONS_DIR || `${ROOT_DIR}/data`),
    idleTimeoutMinutes: parseInt(process.env.SESSION_IDLE_TIMEOUT || "30", 10),
    maxConcurrent: parseInt(process.env.MAX_SESSIONS || "5", 10),
  },
};

export function validateConfig() {
  if (!config.telegram.token) {
    console.error("ERROR: TELEGRAM_BOT_TOKEN is required");
    console.error("  Get one from @BotFather on Telegram");
    process.exit(1);
  }
  if (config.telegram.allowedUsers.length === 0) {
    console.warn(
      "WARNING: TELEGRAM_ALLOWED_USERS is empty — bot will accept messages from ANYONE"
    );
    console.warn(
      '  Set it to your Telegram user ID(s) for security, e.g. "123456789"'
    );
  }
}

export default config;
