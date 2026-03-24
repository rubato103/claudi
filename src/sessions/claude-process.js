/**
 * Claude Code Process Manager
 *
 * Spawns and manages Claude Code CLI processes.
 * Each session runs as a separate `claude` process with --resume support.
 * Supports streaming output via callback.
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
   * @param {string} message
   * @param {object} opts
   * @param {function} [opts.onChunk] - Callback for streaming chunks: (textSoFar) => void
   * @param {string[]} [opts.files] - File paths to include in the message
   */
  send(message, opts = {}) {
    return new Promise((resolve, reject) => {
      this.lastActivity = Date.now();

      const args = ["-p", message, "--output-format", "stream-json"];

      if (this.resumeSessionId) {
        args.push("--resume", this.resumeSessionId);
      }

      // Append file references
      if (opts.files?.length) {
        for (const f of opts.files) {
          args.push("--file", f);
        }
      }

      const proc = spawn(config.claude.path, args, {
        cwd: this.workdir,
        env: { ...process.env },
        shell: true,
        timeout: 300_000,
      });

      this.process = proc;
      this.alive = true;

      let fullText = "";
      let buffer = "";

      proc.stdout.on("data", (data) => {
        buffer += data.toString();
        // stream-json outputs one JSON object per line
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "assistant" && event.message) {
              // Extract text from content blocks
              const textBlocks = (event.message.content || []).filter(
                (b) => b.type === "text"
              );
              if (textBlocks.length) {
                fullText = textBlocks.map((b) => b.text).join("");
                if (opts.onChunk) opts.onChunk(fullText);
              }
            } else if (event.type === "result") {
              // Final result
              if (event.result) fullText = event.result;
              if (event.session_id) {
                this.resumeSessionId = event.session_id;
              }
            }
          } catch {
            // Not valid JSON, accumulate as plain text
            fullText += line;
            if (opts.onChunk) opts.onChunk(fullText);
          }
        }
      });

      let stderr = "";
      proc.stderr.on("data", (data) => {
        const text = data.toString();
        stderr += text;
        const match = text.match(/session:\s*([a-f0-9-]+)/i);
        if (match) this.resumeSessionId = match[1];
      });

      proc.on("close", (code) => {
        this.alive = false;
        this.process = null;
        this.lastActivity = Date.now();

        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer);
            if (event.type === "result" && event.result) {
              fullText = event.result;
            }
            if (event.session_id) {
              this.resumeSessionId = event.session_id;
            }
          } catch {
            fullText += buffer;
          }
        }

        if (code === 0 || fullText) {
          resolve(fullText.trim());
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

  kill() {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
      this.alive = false;
    }
  }

  isIdle() {
    const idleMs = config.sessions.idleTimeoutMinutes * 60 * 1000;
    return Date.now() - this.lastActivity > idleMs;
  }
}
