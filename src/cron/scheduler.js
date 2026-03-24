/**
 * Cron Scheduler
 *
 * Runs scheduled prompts via Claude Code and delivers results to Telegram.
 * Cron jobs are defined in data/crons.json or via /cron Telegram command.
 *
 * Uses node-cron syntax: "minute hour day month weekday"
 * Examples:
 *   "0 9 * * *"       — every day at 09:00
 *   "0,30 * * * *"    — every 30 minutes
 *   "0 9 * * 1-5"     — weekdays at 09:00
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";

// Lightweight cron parser — no external dependency
const CRON_FIELDS = ["minute", "hour", "dayOfMonth", "month", "dayOfWeek"];

function parseCronField(field, min, max) {
  if (field === "*") return null; // matches all
  const values = new Set();

  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2]) : 1;
    const range = stepMatch ? stepMatch[1] : part;

    if (range === "*") {
      for (let i = min; i <= max; i += step) values.add(i);
    } else if (range.includes("-")) {
      const [start, end] = range.split("-").map(Number);
      for (let i = start; i <= end; i += step) values.add(i);
    } else {
      values.add(parseInt(range));
    }
  }
  return values;
}

function matchesCron(cronExpr, date) {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const checks = [
    [date.getMinutes(), 0, 59],
    [date.getHours(), 0, 23],
    [date.getDate(), 1, 31],
    [date.getMonth() + 1, 1, 12],
    [date.getDay(), 0, 6],
  ];

  for (let i = 0; i < 5; i++) {
    const allowed = parseCronField(parts[i], checks[i][1], checks[i][2]);
    if (allowed && !allowed.has(checks[i][0])) return false;
  }
  return true;
}

export class CronScheduler {
  constructor(sessionManager, sendFn, dataDir) {
    this.sessionManager = sessionManager;
    this.sendToChat = sendFn;
    this.filePath = resolve(dataDir, "crons.json");
    this.jobs = [];
    this._load();
    this._interval = null;
  }

  _load() {
    try {
      if (existsSync(this.filePath)) {
        this.jobs = JSON.parse(readFileSync(this.filePath, "utf-8"));
      }
    } catch {
      this.jobs = [];
    }
  }

  _save() {
    try {
      mkdirSync(resolve(this.filePath, ".."), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.jobs, null, 2), "utf-8");
    } catch (err) {
      console.error("[Cron] Failed to save:", err.message);
    }
  }

  /**
   * Add a new cron job.
   * @returns {object} The created job
   */
  addJob(chatId, schedule, prompt, name = "") {
    const job = {
      id: `cron_${Date.now()}`,
      chatId,
      schedule,
      prompt,
      name: name || prompt.substring(0, 30),
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    this.jobs.push(job);
    this._save();
    console.log(`[Cron] Added job: ${job.name} (${schedule})`);
    return job;
  }

  /**
   * Remove a cron job by ID.
   */
  removeJob(jobId) {
    const idx = this.jobs.findIndex((j) => j.id === jobId);
    if (idx === -1) return false;
    const removed = this.jobs.splice(idx, 1)[0];
    this._save();
    console.log(`[Cron] Removed job: ${removed.name}`);
    return true;
  }

  /**
   * List all jobs, optionally filtered by chatId.
   */
  listJobs(chatId = null) {
    if (chatId) return this.jobs.filter((j) => j.chatId === chatId);
    return this.jobs;
  }

  /**
   * Start the scheduler. Checks every 60 seconds.
   */
  start() {
    console.log(`[Cron] Scheduler started with ${this.jobs.length} jobs.`);

    this._interval = setInterval(() => {
      this._tick();
    }, 60_000);

    // Align to next minute boundary
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    setTimeout(() => this._tick(), msToNextMinute);
  }

  async _tick() {
    const now = new Date();
    for (const job of this.jobs) {
      if (!job.enabled) continue;
      if (!matchesCron(job.schedule, now)) continue;

      console.log(`[Cron] Executing job: ${job.name}`);

      try {
        const contextKey = `cron:${job.id}`;
        const response = await this.sessionManager.sendMessage(
          contextKey,
          job.prompt
        );
        await this.sendToChat(
          job.chatId,
          `⏰ *[${job.name}]*\n\n${response}`
        );
      } catch (err) {
        console.error(`[Cron] Job "${job.name}" failed:`, err.message);
        await this.sendToChat(
          job.chatId,
          `⏰ *[${job.name}]* — Error: ${err.message}`
        );
      }
    }
  }

  stop() {
    if (this._interval) {
      clearInterval(this._interval);
      this._interval = null;
    }
    console.log("[Cron] Scheduler stopped.");
  }
}
