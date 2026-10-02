<p align="center"><img src="assets/icon-1024.png" width="96" alt="Dawra"></p>

<h1 align="center">Dawra · دورة</h1>
<p align="center"><b>Your daily round of AI coding sessions.</b><br>
A local dashboard for <b>Claude Code</b> and <b>Codex</b>: every session across every project, organized by day, summarized by AI, and resumable in one click.</p>

<p align="center"><a href="#العربية">العربية ↓</a></p>

---

## Why

If you run many agent sessions a day, you hit the same problems:

- **You can't find an old session.** The built-in picker only matches titles, and sessions are tied to the folder you started them in.
- **You lose track of what got done and what's still open** across parallel sessions.
- **There's no single view** of yesterday, today, or this week across all projects and agents.

Dawra reads the session files Claude Code and Codex already write (`~/.claude/projects`, `~/.codex/sessions`). It doesn't change them and it doesn't upload anything.

## Features

| | |
|---|---|
| **Today** | A daily standup written by AI from all of today's sessions (done / open / next priorities), the sessions that need follow-up, and "pick up where you left off". |
| **Sessions** | Every session grouped by day. A session that spans several days shows up under each day it was active. Filter by range, project, or agent. |
| **AI summary per session** | Done, open, and next step. Written by your local `claude -p` (no API key needed). Runs automatically when a session goes idle and is marked outdated when the session changes. |
| **Full-text search** | Searches inside the conversations, not just the titles, using ripgrep. Shows the matching snippet. |
| **Resume anywhere** | Real terminals embedded in the app (xterm.js + node-pty). They keep running in the background when you close the page. If a session is active in another window, Dawra offers a fork instead of opening it twice. |
| **Ask Dawra** | A central assistant (Claude Code or Codex) running in a workspace that has a live digest of all your sessions. Ask "what's open across my projects?" or "plan my day". It can also pin sessions, set their status, and add notes. |
| **MCP server** | `dawra_sessions`, `dawra_search`, `dawra_session` and `dawra_open`. Any Claude Code session can query your history. |
| **Organize** | Statuses (follow up / waiting / done), pins, private notes, and local renames. |
| **Share** | Export a session as a self-contained HTML page or as Markdown, or as a secret GitHub Gist. Secret-looking values are redacted. |
| **Command palette** | <kbd>⌘K</kbd> to jump to any session or project, or to run a command. <kbd>/</kbd> searches, <kbd>j</kbd>/<kbd>k</kbd> move between sessions, <kbd>o</kbd> opens one. |
| **Arabic & English** | Full RTL support. A composer under the terminal so Arabic and other RTL text is typed correctly. Light and dark themes. |

## Install

Requirements: macOS (Linux works except for the "In Terminal" button and autostart), Node 20+, and Claude Code and/or Codex. `ripgrep` is optional but makes search much faster.

```bash
git clone https://github.com/daeerah/dawra && cd dawra
npm install && npm link       # puts the `dawra` command on your PATH
dawra install                 # /dawra in Claude Code + MCP server + Dawra.app
dawra autostart on            # optional: start at login and open the window
```

## Daily use

1. **Morning:** Dawra opens with your Mac, or you run `dawra`, type `/dawra` inside Claude Code, or open "Dawra" from Spotlight.
2. **Today:** read the standup and the follow-ups, then press **Open** on the session you want to continue. It resumes in its own folder.
3. **During the day:** work in the embedded terminals or in your usual terminal. Dawra notices new sessions and summarizes the ones that go idle.
4. **Anytime:** use **Ask Dawra** for questions that span all your sessions.

```
dawra [open] [today|ask|sessions]   start if needed and open the app window
dawra stop | status
dawra autostart on|off [--no-window]
dawra install | uninstall
```

## Privacy

- Everything runs locally and the server binds to `127.0.0.1`. Requests from other origins are rejected, because the server can run terminals.
- Summaries are made by your own `claude` CLI on your existing subscription.
- Dawra's own data (index, summaries, notes, settings, exports) is stored in `~/.dawra`.
- Sharing is always explicit. Gists are created only when you click the button, and Dawra asks you to confirm first.

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

## دورة: جولتك اليومية على جلساتك

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
- **اسأل دورة:** مساعد يعرف كل جلساتك.
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
git clone https://github.com/daeerah/dawra && cd dawra
npm install && npm link
dawra install          # أمر /dawra داخل Claude Code + خادم MCP + تطبيق Dawra.app
dawra autostart on     # اختياري: تشغيل مع الجهاز وفتح النافذة
```

<div dir="rtl">

### الاستخدام اليومي
1. **صباحاً:** تفتح دورة مع الجهاز. أو اكتب `dawra` في الترمينال، أو `/dawra` داخل Claude Code، أو ابحث عن «Dawra» في Spotlight.
2. **في شاشة اليوم:** اقرأ الملخص والمتابعات، ثم اضغط **افتح** على الجلسة التي تريد إكمالها.
3. **خلال اليوم:** اعمل كالمعتاد. دورة تلتقط الجلسات الجديدة وتلخّص المتوقفة منها.
4. **في أي وقت:** اسأل دورة عن أي شيء يخص جلساتك.

**الخصوصية:**
- كل شيء يعمل على جهازك، ولا يُرفع شيء إلا عندما تضغط زر المشاركة بنفسك.
- بيانات دورة في `~/.dawra`.

صُنعت في [دائرة](https://daeerah.com) · ترخيص MIT
</div>
