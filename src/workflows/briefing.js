/**
 * Briefing Workflow
 *
 * Morning/evening briefing system that generates news summaries.
 * Produces two versions:
 *   - Full (for Notion via MCP)
 *   - Short (for Telegram)
 *
 * Callable from cron scheduler or via /briefing command.
 */

/**
 * Determine briefing period based on current hour (KST).
 * @returns {"오전"|"오후"}
 */
function getBriefingPeriod() {
  const now = new Date();
  // Convert to KST (UTC+9)
  const kstHour = (now.getUTCHours() + 9) % 24;
  return kstHour < 12 ? "오전" : "오후";
}

/**
 * Get formatted date string for briefing header (MM/DD).
 * @returns {string}
 */
function getBriefingDate() {
  const now = new Date();
  const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const month = String(kstTime.getUTCMonth() + 1).padStart(2, "0");
  const day = String(kstTime.getUTCDate()).padStart(2, "0");
  return `${month}/${day}`;
}

/**
 * Build the prompt that asks Claude to generate a full briefing.
 * @param {object} opts
 * @param {"오전"|"오후"} [opts.period] - Override period
 * @param {string} [opts.date] - Override date string
 * @returns {string}
 */
export function buildBriefingPrompt(opts = {}) {
  const period = opts.period || getBriefingPeriod();
  const date = opts.date || getBriefingDate();

  return `오늘 ${period} 브리핑을 작성해 주세요. 날짜: ${date}

다음 항목을 포함하여 브리핑을 작성하세요:

1. 오늘의 날씨 (서울 기준)
2. 미국 시장/뉴스 핵심 1줄
3. 코스피 지수 및 원/달러 환율
4. 국내 핵심 뉴스 1줄
5. 국제 핵심 뉴스 1줄
6. 스포츠 뉴스 (해당 시)
7. 오늘의 인사이트 포인트

두 가지 버전으로 작성해 주세요:

=== FULL VERSION (Notion용) ===
각 항목에 대해 2-3문장으로 상세 설명을 포함한 전체 버전.

=== SHORT VERSION (Telegram용) ===
아래 형식으로 간결하게 작성:

📰 [${period}] 브리핑 (${date})

🌤️ [날씨]
🇺🇸 [미국 핵심 1줄]
📈 코스피/원달러
🏭 [국내 핵심 1줄]
🌍 [국제 핵심 1줄]
⚽ [스포츠] (해당시)

💡 오늘의 포인트: [인사이트]

형님에게 보고하는 어투로 작성하세요. 한국어로 작성합니다.`;
}

/**
 * Parse Claude's briefing response into full and short versions.
 * @param {string} response - Claude's raw response
 * @returns {{full: string, short: string}}
 */
export function parseBriefingResponse(response) {
  if (!response) {
    return { full: "", short: "" };
  }

  // Try to split by version markers
  const fullMatch = response.match(
    /=== FULL VERSION[^=]*===\s*([\s\S]*?)(?:=== SHORT VERSION|$)/i
  );
  const shortMatch = response.match(
    /=== SHORT VERSION[^=]*===\s*([\s\S]*?)$/i
  );

  const full = fullMatch ? fullMatch[1].trim() : response.trim();
  const short = shortMatch ? shortMatch[1].trim() : extractShortVersion(response);

  return { full, short };
}

/**
 * Fallback: extract the short version from a response that
 * doesn't have clear markers.
 * @param {string} response
 * @returns {string}
 */
function extractShortVersion(response) {
  // Look for the emoji-based briefing format
  const briefingStart = response.indexOf("📰");
  if (briefingStart !== -1) {
    // Find the end — look for the insight point line
    const afterStart = response.substring(briefingStart);
    const insightMatch = afterStart.match(/💡[^\n]+/);
    if (insightMatch) {
      const insightEnd =
        afterStart.indexOf(insightMatch[0]) + insightMatch[0].length;
      return afterStart.substring(0, insightEnd).trim();
    }
    return afterStart.trim();
  }

  // If no emoji format found, return first 500 chars as fallback
  return response.substring(0, 500).trim();
}

/**
 * Execute a briefing workflow.
 * Sends the briefing prompt to Claude via sessionManager,
 * parses the response, and returns both versions.
 *
 * @param {object} sessionManager - SessionManager instance
 * @param {object} [opts]
 * @param {"오전"|"오후"} [opts.period]
 * @param {string} [opts.date]
 * @param {function} [opts.onChunk] - Streaming callback
 * @returns {Promise<{full: string, short: string, raw: string}>}
 */
export async function runBriefing(sessionManager, opts = {}) {
  const prompt = buildBriefingPrompt(opts);
  const contextKey = `briefing:${Date.now()}`;

  const response = await sessionManager.sendMessage(contextKey, prompt, undefined, {
    onChunk: opts.onChunk,
  });

  const { full, short } = parseBriefingResponse(response);

  return { full, short, raw: response };
}
