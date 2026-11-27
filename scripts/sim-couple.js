#!/usr/bin/env node
// Simulates a fictional TEST couple end-to-end against a 7 Seasons server:
// register both spouses -> 10 discovery domains each -> joint Final Interview
// -> Marriage Report. Seven runs on the server exactly as for real users; the
// two spouses' replies come from a local Claude call playing fictional personas.
//
// Use it to get a test couple past the Final Interview gate. Never use it to
// fill in answers for a real person: the Final Interview transcript feeds the
// Marriage Report.
//
//   node scripts/sim-couple.js                  # new couple on production
//   BASE=http://localhost:3000 node scripts/sim-couple.js
//   REUSE_A=a@x.com REUSE_B=b@x.com SIM_PASSWORD=... node scripts/sim-couple.js
//                                               # resume an existing test couple
//
// Env: ANTHROPIC_API_KEY (read from .env if unset), BASE, SIM_PASSWORD,
// SIM_PERSONA_MODEL. Takes roughly 30 minutes and ~150 server-side model calls.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Anthropic = require("@anthropic-ai/sdk");

// Load .env by hand: it may have Windows (CRLF) line endings, and a trailing
// \r on the API key makes every Anthropic request fail with "Connection error".
try {
  for (const line of fs.readFileSync(path.join(__dirname, "..", ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

const BASE = process.env.BASE || "https://7seasons-production-fd66.up.railway.app";
const PASSWORD = process.env.SIM_PASSWORD || crypto.randomBytes(6).toString("hex");
const PERSONA_MODEL = process.env.SIM_PERSONA_MODEL || "claude-haiku-5-5";
const STAMP = Date.now().toString(36);
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const A = { name: "Test Marcus", email: `7s-test-marcus-${STAMP}@example.com`,
  bio: "Marcus, 34, project manager. Married 6 years, two kids (4 and 2). Grew up with a stoic father, tends to withdraw in conflict and fix things practically. Faith matters to him but he's been coasting. Saver, anxious about money. Wants more connection but struggles to say it." };
const B = { name: "Test Dana", email: `7s-test-dana-${STAMP}@example.com`,
  bio: "Dana, 33, nurse working three 12-hour shifts. Married 6 years, two kids. Grew up in a loud, expressive family; wants to talk things out immediately. Feels she carries the mental load at home. Spender on experiences, generous. Deeply wants to feel prioritized and pursued." };

// ── Persona replies ──────────────────────────────────────────────────────────
async function persona(p, transcript, extra = "") {
  for (let i = 0; i < 3; i++) {
    const r = await claude.messages.create({
      model: PERSONA_MODEL, max_tokens: 600,
      system: `You are role-playing ${p.name}, a fictional spouse testing a marriage app. Persona: ${p.bio}\nReply as ${p.name} would in a conversation with a relationship guide: honest, conversational, 2-4 sentences, no stage directions. If offered [A]/[B]/[C] options you may pick one and explain briefly. ${extra}`,
      messages: [{ role: "user", content: `Conversation so far:\n${transcript}\n\nWrite ${p.name}'s next reply only.` }],
    });
    const text = r.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    if (text) return text;
    console.log(`  (empty persona reply for ${p.name}, stop_reason=${r.stop_reason}; retrying)`);
  }
  return "That's a fair question. Honestly I'm still figuring out how to put it into words, but I think it matters a lot to me.";
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
const post = (p, body) => fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

async function json(p, body) {
  const res = await post(p, body);
  const data = await res.json();
  if (!res.ok) throw new Error(`${p}: ${JSON.stringify(data)}`);
  return data;
}

// Reads a whole server-sent-event response. Returns the concatenated text
// deltas; throws on an {error} event. Also used for generate-report, which
// streams {status} events and ends with {status: "done"}.
async function stream(p, body) {
  const res = await post(p, body);
  if (!res.ok) throw new Error(`${p}: ${res.status} ${await res.text()}`);
  const raw = await res.text();
  let text = "";
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const d = JSON.parse(line.slice(6));
    if (d.error) throw new Error(`${p}: ${d.error}`);
    if (d.status) console.log(`  ${d.status}`);
    text += d.text || "";
  }
  return text;
}

// ── Flow ─────────────────────────────────────────────────────────────────────
// Same phrases onboarding.html uses to decide a domain is ready to advance.
const DOMAIN_DONE = ["move on to the next", "next topic", "ready, you can move on", "covered a lot of meaningful ground", "wraps up this part"];

async function discovery(p) {
  const me = await (await fetch(`${BASE}/api/me/${p.id}`)).json();
  if (me.onboarding_complete) return console.log(`  ${p.name}: discovery already complete`);
  for (let d = me.current_domain || 0; d < 10; d++) {
    let transcript = "Seven: " + await stream("/api/chat", { individual_id: p.id, domain_index: d, message: "__START__" });
    for (let turn = 0; turn < 7; turn++) {
      const reply = await persona(p, transcript);
      transcript += `\n${p.name}: ${reply}`;
      const ai = await stream("/api/chat", { individual_id: p.id, domain_index: d, message: reply });
      transcript += `\nSeven: ${ai}`;
      if (DOMAIN_DONE.some(x => ai.toLowerCase().includes(x))) break;
    }
    await json("/api/domain/complete", { individual_id: p.id, domain_index: d });
    console.log(`  ${p.name}: domain ${d + 1}/10 done`);
  }
}

async function finalInterview(couple_id) {
  const state = await (await fetch(`${BASE}/api/final-interview/${couple_id}`)).json();
  if (state.completed) return console.log("Final Interview already complete");
  console.log("Generating Final Interview briefing...");
  await json("/api/final-interview/generate-briefing", { couple_id });
  let transcript = "Seven: " + await stream("/api/final-interview/message", { couple_id, message: "__START__" });
  const first = n => n.split(" ").pop(); // "Test Dana" -> "Dana"
  for (let turn = 0; turn < 18; turn++) {
    // Answer as whichever spouse Seven just addressed by name; alternate otherwise.
    const last = transcript.slice(transcript.lastIndexOf("Seven:"));
    const hasA = last.includes(first(A.name)), hasB = last.includes(first(B.name));
    const who = hasB && !hasA ? B : hasA && !hasB ? A : (turn % 2 ? B : A);
    const reply = await persona(who, transcript, "This is a joint session with your spouse present.");
    transcript += `\n${who.name}: ${reply}`;
    const ai = await stream("/api/final-interview/message", { couple_id, speaker: who.name, message: reply });
    transcript += `\nSeven: ${ai}`;
    console.log(`  interview turn ${turn + 1} (${who.name})`);
    if (ai.toLowerCase().includes("complete your final interview")) break;
  }
  await json("/api/final-interview/complete", { couple_id });
  console.log("Final Interview complete.");
}

(async () => {
  let couple_id;
  if (process.env.REUSE_A && process.env.REUSE_B) {
    const ra = await json("/api/auth/login", { email: process.env.REUSE_A, password: PASSWORD });
    const rb = await json("/api/auth/login", { email: process.env.REUSE_B, password: PASSWORD });
    Object.assign(A, { id: ra.individual_id, name: ra.name, email: process.env.REUSE_A });
    Object.assign(B, { id: rb.individual_id, name: rb.name, email: process.env.REUSE_B });
    couple_id = ra.couple_id;
    console.log(`Reusing couple ${couple_id}`);
  } else {
    const ra = await json("/api/auth/register", { name: A.name, email: A.email, password: PASSWORD });
    A.id = ra.individual_id; couple_id = ra.couple_id;
    const rb = await json("/api/auth/register", { name: B.name, email: B.email, password: PASSWORD, invite_code: ra.invite_code });
    B.id = rb.individual_id;
    console.log(`Couple ${couple_id} (invite ${ra.invite_code})\n  ${A.email}\n  ${B.email}\n  password: ${PASSWORD}`);
    for (const p of [A, B]) await json("/api/bio", { individual_id: p.id, bio: { summary: p.bio } });
  }

  await Promise.all([discovery(A), discovery(B)]);
  await finalInterview(couple_id);

  console.log("Generating Marriage Report...");
  for (let attempt = 1; ; attempt++) {
    try { await stream("/api/couple/generate-report", { couple_id }); break; }
    catch (e) { if (attempt >= 2) throw e; console.log(`  report attempt failed (${e.message}); retrying`); }
  }
  console.log(`Done. Log in at ${BASE}/login.html`);
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
