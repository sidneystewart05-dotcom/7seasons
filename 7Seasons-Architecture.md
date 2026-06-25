# 7 Seasons — Architecture

## How the System Works

7 Seasons runs as a self-hosted Node.js application. All user data stays on your own machine — nothing is stored by Anthropic or any third party.

### Request Flow

```
Browser (you)
  → your local server (server.js, port 3050)
    → Anthropic API (Claude processes the message, returns a reply)
    → your local SQLite database (conversation saved)
  → response streamed back to browser
```

Anthropic receives only the API call in the moment. They do not store or train on API conversation data by default.

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS |
| Backend | Node.js + Express |
| Database | SQLite via better-sqlite3 |
| AI | Anthropic Claude (claude-sonnet-4-6) via API |
| Voice Input | Browser Web Speech API (SpeechRecognition) |
| Voice Output | Browser Web Speech API (speechSynthesis) |

---

## Database Schema

All data lives in `data/7seasons.db`.

**couples** — one row per couple
- `id` — unique ID
- `invite_code` — 6-character code the first spouse shares with the second
- `status` — waiting_partner → both_joined → report_generated
- `created_at`

**individuals** — one row per person
- `id`, `couple_id`, `name`, `role` (spouse1 / spouse2)
- `current_domain` — which of the 10 discovery topics they're on (0–9)
- `onboarding_complete` — 1 when all 10 domains are done
- `dimensions` — JSON blob of all scored dimensions extracted from conversations
- `domain_summaries` — JSON blob of per-domain summaries and themes

**conversations** — one row per (individual × domain)
- `individual_id`, `domain_index`
- `messages` — full conversation history as JSON array
- `completed` — 1 when the domain is marked complete

**marriage_models** — one row per couple (generated after both complete discovery)
- `model` — JSON: strengths, growth areas, friction points, dynamic summary, counselor notes
- `report` — JSON: trajectory report across all 7 seasons

---

## Pages

| File | Route | Purpose |
|------|-------|---------|
| `public/index.html` | `/` | Landing — create couple or join with invite code |
| `public/onboarding.html` | `/onboarding.html` | AI discovery conversation (10 domains with Seven) |
| `public/dashboard.html` | `/dashboard.html` | Couple status, navigation hub |
| `public/report.html` | `/report.html` | Marriage Trajectory Report (couple-facing) |
| `public/counselor.html` | `/counselor.html?couple=ID` | Full counselor report with raw dimensions |

---

## API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/couple/create` | Create couple + first spouse |
| POST | `/api/couple/join` | Second spouse joins with invite code |
| GET | `/api/me/:id` | Get individual profile + couple status |
| GET | `/api/conversation/:id/:domain` | Load existing conversation history |
| POST | `/api/chat` | Send message → SSE stream of Seven's reply |
| POST | `/api/domain/complete` | Mark domain done, extract dimensions via AI |
| POST | `/api/couple/generate-report` | Generate marriage model + trajectory report (SSE) |
| GET | `/api/report/:couple_id` | Get trajectory report (couple view) |
| GET | `/api/counselor/:couple_id` | Get full counselor report with raw data |

---

## AI Design

**Discovery conversations** use `claude-sonnet-4-6`. Each of the 10 domain conversations is a fresh chat session with a domain-specific system prompt that instructs Seven on what to explore and how deep to go.

**Dimension extraction** runs after each domain is marked complete. A second Claude call reads the full conversation and outputs structured JSON scores (1–10) across domain-specific dimensions (e.g., `conflict_engagement`, `saving_orientation`).

**Marriage Model + Trajectory Report** are generated once both spouses complete all 10 domains. Two sequential Claude calls produce:
1. The Marriage Model — strengths, growth areas, friction points, couple dynamic summary
2. The Trajectory Report — personalized forecast across all 7 seasons

All AI prompts live in `prompts.js`.

---

## Data Privacy

- All conversation data is stored locally in `data/7seasons.db`
- Anthropic processes API calls in the moment but does not store or train on them
- No third-party analytics or tracking
- The counselor report URL (`/counselor.html?couple=ID`) is the only shareable link — it requires knowing the couple ID

---

## Voice Mode

Available in the discovery conversation (`onboarding.html`):

- **Input** — Browser `SpeechRecognition` API. Tap mic → speak → auto-transcribes and sends. Works in Chrome/Edge.
- **Output** — Browser `speechSynthesis` API. Seven's response is read aloud after streaming completes. Toggle with the 🔊 button in the top bar.
- No additional API keys or costs — runs entirely in the browser.

---

## Deployment

**Local (laptop):** `node server.js` — runs at `http://localhost:3050`

**Home server (Geekom):** Same setup, runs as a persistent process. Access from any device on the local network at `http://10.0.0.102:3050`.

**Configuration:** Requires a `.env` file (copy from `.env.example`) with:
- `PORT` — defaults to 3050
- `ANTHROPIC_API_KEY` — from console.anthropic.com
