<p align="center"><img src="assets/icon-1024.png" width="96" alt="Jawla"></p>

<h1 align="center">Jawla · جولة</h1>
<p align="center"><b>Your daily round of AI coding sessions.</b><br>
A local dashboard for <b>Claude Code</b> and <b>Codex</b>: every session across every project, organized by day, summarized by AI, and resumable in one click.</p>

<p align="center"><a href="#العربية">العربية ↓</a></p>

---

## Why

If you run many agent sessions a day, you hit the same problems:

- **You can't find an old session.** The built-in picker only matches titles, and sessions are tied to the folder you started them in.
- **You lose track of what got done and what's still open** across parallel sessions.
- **There's no single view** of yesterday, today, or this week across all projects and agents.

Jawla reads the session files Claude Code and Codex already write (`~/.claude/projects`, `~/.codex/sessions`). It doesn't change them and it doesn't upload anything.

## Features

| | |
|---|---|
| **Today** | A daily standup written by AI from all of today's sessions (done / open / next priorities), the sessions that need follow-up, and "pick up where you left off". |
| **Sessions** | Every session grouped by day. A session that spans several days shows up under each day it was active. Filter by range, project, or agent. |
| **AI summary per session** | Done, open, and next step. Written by your local `claude -p` (no API key needed). Runs automatically when a session goes idle and is marked outdated when the session changes. |
| **Full-text search** | Searches inside the conversations, not just the titles, using ripgrep. Shows the matching snippet. |
| **Resume anywhere** | Real terminals embedded in the app (xterm.js + node-pty). They keep running in the background when you close the page. If a session is active in another window, Jawla offers a fork instead of opening it twice. |
| **Ask Jawla** | A central assistant (Claude Code or Codex) running in a workspace that has a live digest of all your sessions. Ask "what's open across my projects?" or "plan my day". It can also pin sessions, set their status, and add notes. |
| **MCP server** | `jawla_sessions`, `jawla_search`, `jawla_session` and `jawla_open`. Any Claude Code session can query your history. |
| **Organize** | Statuses (follow up / waiting / done), pins, private notes, and local renames. |
| **Share** | Export a session as a self-contained HTML page or as Markdown, or as a secret GitHub Gist. Secret-looking values are redacted. |
| **Command palette** | <kbd>⌘K</kbd> to jump to any session or project, or to run a command. <kbd>/</kbd> searches, <kbd>j</kbd>/<kbd>k</kbd> move between sessions, <kbd>o</kbd> opens one. |
| **Arabic & English** | Full RTL support. A composer under the terminal so Arabic and other RTL text is typed correctly. Light and dark themes. |

## Install

Requirements: macOS (Linux works except for the "In Terminal" button and autostart), Node 20+, and Claude Code and/or Codex. `ripgrep` is optional but makes search much faster.

```bash
curl -fsSL https://raw.githubusercontent.com/osama300/jawla/main/install.sh | bash
```

That installs the `jawla` command, adds `/jawla` and the MCP server to Claude Code, creates Jawla.app, and opens it. Run it again to update. Optional: `jawla autostart on` to start at login.

<details><summary>Manual install (from source)</summary>

```bash
git clone https://github.com/osama300/jawla && cd jawla
npm install && npm link       # puts the `jawla` command on your PATH
jawla install                 # /jawla in Claude Code + MCP server + Jawla.app
jawla autostart on            # optional: start at login and open the window
```
</details>

## Daily use

1. **Morning:** Jawla opens with your Mac, or you run `jawla`, type `/jawla` inside Claude Code, or open "Jawla" from Spotlight.
2. **Today:** read the standup and the follow-ups, then press **Open** on the session you want to continue. It resumes in its own folder.
3. **During the day:** work in the embedded terminals or in your usual terminal. Jawla notices new sessions and summarizes the ones that go idle.
4. **Anytime:** use **Ask Jawla** for questions that span all your sessions.

```
jawla [open] [today|ask|sessions]   start if needed and open the app window
jawla stop | status
jawla autostart on|off [--no-window]
jawla install | uninstall
```

## Privacy

- Everything runs locally and the server binds to `127.0.0.1`. Requests from other origins are rejected, because the server can run terminals.
- Summaries are made by your own `claude` CLI on your existing subscription.
- Jawla's own data (index, summaries, notes, settings, exports) is stored in `~/.jawla`.
- Sharing is always explicit. Gists are created only when you click the button, and Jawla asks you to confirm first.

## Architecture

```
server.mjs          HTTP + WebSocket server (no framework)
lib/sources/        one adapter per agent: claude.mjs, codex.mjs
lib/index.mjs       cached index (re-parses only changed files)
lib/summarize.mjs   per-session summary + daily standup via `claude -p`
lib/terminals.mjs   node-pty terminals that survive page reloads
lib/hub.mjs         workspace + digest for the central assistant
lib/search.mjs      ripgrep-based content search
lib/share.mjs       HTML/Markdown export, secret redaction, gists
mcp/server.mjs      zero-dependency MCP server (stdio)
public/             vanilla JS UI (i18n.js, term.js, app.js)
```

To support another agent, add a file in `lib/sources/` that exports `listFiles`, `parse`, and `resumeCommand`.

---

<a id="العربية"></a>

<div dir="rtl">

## جولة: جولتك اليومية على جلساتك

لوحة محلية لجلسات **Claude Code** و**Codex**. تجمع كل جلساتك في كل المشاريع، مرتبة حسب اليوم وملخّصة بالذكاء الاصطناعي، وتستأنف أيّاً منها بنقرة واحدة.

### ماذا تقدّم
- **شاشة اليوم:**
  - ملخص يومي يكتبه Claude من كل جلسات اليوم: ما أُنجز، وما بقي معلّقاً، وأولويات الغد.
  - الجلسات التي تحتاج متابعة.
  - قائمة «أكمل من حيث توقفت».
- **الجلسات:**
  - مجمّعة حسب اليوم. الجلسة التي امتدت أياماً تظهر في كل يوم عملت فيه.
  - فلترة حسب الفترة والمشروع والأداة.
- **ملخص لكل جلسة:** ما أُنجز، وما بقي معلّقاً، والخطوة التالية.
  - يكتبه أمر `claude` المحلي بلا مفتاح API.
  - يعمل تلقائياً عندما تتوقف الجلسة.
- **بحث داخل المحادثات نفسها،** وليس العناوين فقط.
- **فتح الجلسة داخل الأداة:**
  - ترمينال حقيقي يبقى يعمل حتى لو أغلقت الصفحة.
  - تحته صندوق كتابة يعرض العربية بشكل صحيح.
- **اسأل جولة:** مساعد يعرف كل جلساتك.
  - اسأله مثلاً: «ما الذي بقي معلّقاً؟» أو «رتّب يومي».
  - يستطيع أن يثبّت الجلسات ويغيّر حالاتها.
- **خادم MCP:** يتيح لأي جلسة Claude أن تسأل عن تاريخ جلساتك.
- **التنظيم:** حالات للجلسات، وتثبيت، وملاحظات خاصة، وإعادة تسمية.
- **المشاركة:**
  - صفحة HTML مستقلة، أو ملف Markdown، أو رابط Gist سري.
  - ما يشبه الأسرار يُخفى تلقائياً.
- **لوحة أوامر ⌘K،** وعربي وإنجليزي، ووضع فاتح وداكن.

### التثبيت
</div>

```bash
curl -fsSL https://raw.githubusercontent.com/osama300/jawla/main/install.sh | bash
```

<div dir="rtl">

أمر واحد يثبّت أمر `jawla`، ويضيف `/jawla` وخادم MCP إلى Claude Code، وينشئ تطبيق Jawla.app ثم يفتحه. شغّله مرة أخرى للتحديث. اختياري: `jawla autostart on` للتشغيل مع الجهاز.

</div>

<details><summary>تثبيت يدوي من المصدر</summary>

```bash
git clone https://github.com/osama300/jawla && cd jawla
npm install && npm link
jawla install          # أمر /jawla داخل Claude Code + خادم MCP + تطبيق Jawla.app
jawla autostart on     # اختياري: تشغيل مع الجهاز وفتح النافذة
```
</details>

<div dir="rtl">

### الاستخدام اليومي
1. **صباحاً:** تفتح جولة مع الجهاز. أو اكتب `jawla` في الترمينال، أو `/jawla` داخل Claude Code، أو ابحث عن «Jawla» في Spotlight.
2. **في شاشة اليوم:** اقرأ الملخص والمتابعات، ثم اضغط **افتح** على الجلسة التي تريد إكمالها.
3. **خلال اليوم:** اعمل كالمعتاد. جولة تلتقط الجلسات الجديدة وتلخّص المتوقفة منها.
4. **في أي وقت:** اسأل جولة عن أي شيء يخص جلساتك.

**الخصوصية:**
- كل شيء يعمل على جهازك، ولا يُرفع شيء إلا عندما تضغط زر المشاركة بنفسك.
- بيانات جولة في `~/.jawla`.

صُنعت في [دائرة](https://daeerah.com) · ترخيص MIT
</div>
