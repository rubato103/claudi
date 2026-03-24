/**
 * Claude Code Process Manager
 *
 * Spawns and manages Claude Code CLI processes.
 * Each session runs as a separate `claude` process with --resume support.
 */

import { spawn } from "child_process";
import config from "../config.js";

export class ClaudeProcess {
  constructor(sessionId, workdir) {
    this.sessionId = sessionId;
    this.workdir = workdir || process.cwd();
    this.process = null;
    this.alive = false;
    this.lastActivity = Date.now();
  }

  /**
   * Send a message to Claude Code and get the response.
   * Uses `claude -p` (print mode) for non-interactive single-shot execution.
   * Uses `--resume` to maintain conversation continuity.
   */
  send(message) {
    return new Promise((resolve, reject) => {
      this.lastActivity = Date.now();

      const args = [
        "-p", message,
        "--output-format", "text",
        "--verbose",
      ];

      // Resume existing session if available
      if (this.resumeSessionId) {
        args.push("--resume", this.resumeSessionId);
      }

      const proc = spawn(config.claude.path, args, {
        cwd: this.workdir,
        env: { ...process.env },
        shell: true,
        timeout: 300_000, // 5 minute timeout
      });

      this.process = proc;
      this.alive = true;

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        const text = data.toString();
        stderr += text;
        // Extract session ID from Claude's verbose output
        const match = text.match(/session:\s*([a-f0-9-]+)/i);
        if (match) {
          this.resumeSessionId = match[1];
        }
      });

      proc.on("close", (code) => {
        this.alive = false;
        this.process = null;
        this.lastActivity = Date.now();

        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(
            new Error(
              `Claude exited with code ${code}: ${stderr.trim() || "(no output)"}`
            )
          );
        }
      });

      proc.on("error", (err) => {
        this.alive = false;
        this.process = null;
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });
    });
  }

  /**
   * Kill the running process if any.
   */
  kill() {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
      this.alive = false;
    }
  }

  /**
   * Check if this session has been idle too long.
   */
  isIdle() {
    const idleMs = config.sessions.idleTimeoutMinutes * 60 * 1000;
    return Date.now() - this.lastActivity > idleMs;
  }
}
