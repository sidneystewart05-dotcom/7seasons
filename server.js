const express = require("express");
const Database = require("better-sqlite3");
const Anthropic = require("@anthropic-ai/sdk");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const JWT_SECRET = process.env.JWT_SECRET || "7seasons-dev-secret-change-before-deploy";

const {
  DOMAINS,
  buildDiscoveryPrompt,
  buildExtractionPrompt,
  buildMarriageModelPrompt,
  buildTrajectoryReportPrompt,
  buildSnapPrompt,
  buildSnapExtractionPrompt,
  buildArgumentSynthesisPrompt,
  buildSeasonInferencePrompt,
  PREMARITAL_SESSIONS,
  buildPremaritalSessionPrompt
} = require("./prompts");

const app = express();
const PORT = process.env.PORT || 3050;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ─── Database ────────────────────────────────────────────────────────────────

const dataDir = process.env.DATABASE_PATH || path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(path.join(dataDir, "7seasons.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS couples (
    id TEXT PRIMARY KEY,
    invite_code TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS individuals (
    id TEXT PRIMARY KEY,
    couple_id TEXT NOT NULL,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    current_domain INTEGER DEFAULT 0,
    onboarding_complete INTEGER DEFAULT 0,
    dimensions TEXT DEFAULT '{}',
    domain_summaries TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (couple_id) REFERENCES couples(id)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    individual_id TEXT NOT NULL,
    domain_index INTEGER NOT NULL,
    messages TEXT DEFAULT '[]',
    completed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (individual_id) REFERENCES individuals(id)
  );

  CREATE TABLE IF NOT EXISTS marriage_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    couple_id TEXT UNIQUE NOT NULL,
    model TEXT DEFAULT '{}',
    report TEXT DEFAULT '{}',
    generated_at TEXT,
    FOREIGN KEY (couple_id) REFERENCES couples(id)
  );

  CREATE TABLE IF NOT EXISTS arguments (
    id TEXT PRIMARY KEY,
    couple_id TEXT NOT NULL,
    status TEXT DEFAULT 'open',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (couple_id) REFERENCES couples(id)
  );

  CREATE TABLE IF NOT EXISTS argument_responses (
    id TEXT PRIMARY KEY,
    argument_id TEXT NOT NULL,
    individual_id TEXT NOT NULL,
    messages TEXT DEFAULT '[]',
    snap_s TEXT DEFAULT '',
    snap_n TEXT DEFAULT '',
    snap_a TEXT DEFAULT '',
    snap_p TEXT DEFAULT '',
    ownership_level TEXT DEFAULT '',
    completed INTEGER DEFAULT 0,
    submitted_at TEXT,
    UNIQUE(argument_id, individual_id),
    FOREIGN KEY (argument_id) REFERENCES arguments(id)
  );

  CREATE TABLE IF NOT EXISTS argument_synthesis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    argument_id TEXT UNIQUE NOT NULL,
    couple_view TEXT DEFAULT '{}',
    counselor_view TEXT DEFAULT '{}',
    generated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (argument_id) REFERENCES arguments(id)
  );
`);

// Timeline entries table
db.exec(`
  CREATE TABLE IF NOT EXISTS timeline_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    couple_id TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    entry_date TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (couple_id) REFERENCES couples(id)
  );

  CREATE TABLE IF NOT EXISTS premarital_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    couple_id TEXT NOT NULL,
    session_num INTEGER NOT NULL,
    messages TEXT DEFAULT '[]',
    completed INTEGER DEFAULT 0,
    completed_at TEXT,
    UNIQUE(couple_id, session_num),
    FOREIGN KEY (couple_id) REFERENCES couples(id)
  );
`);

// Safely add premarital track column
try { db.exec("ALTER TABLE couples ADD COLUMN couple_track TEXT DEFAULT 'standard'"); } catch {}

// Safely add season columns to existing databases
try { db.exec("ALTER TABLE couples ADD COLUMN season_track TEXT DEFAULT 'standard'"); } catch {}
try { db.exec("ALTER TABLE couples ADD COLUMN season_current INTEGER"); } catch {}
try { db.exec("ALTER TABLE couples ADD COLUMN season_next INTEGER"); } catch {}
try { db.exec("ALTER TABLE couples ADD COLUMN season_progress REAL DEFAULT 0.0"); } catch {}
try { db.exec("ALTER TABLE couples ADD COLUMN season_updated TEXT"); } catch {}

// Safely add auth columns to existing databases
try { db.exec("ALTER TABLE individuals ADD COLUMN email TEXT"); } catch {}
try { db.exec("ALTER TABLE individuals ADD COLUMN password_hash TEXT"); } catch {}
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_individuals_email ON individuals(email) WHERE email IS NOT NULL"); } catch {}

// Prepared statements
const stmts = {
  createCouple: db.prepare("INSERT INTO couples (id, invite_code) VALUES (?, ?)"),
  getCouple: db.prepare("SELECT * FROM couples WHERE id = ?"),
  getCoupleByInvite: db.prepare("SELECT * FROM couples WHERE invite_code = ?"),
  createIndividual: db.prepare("INSERT INTO individuals (id, couple_id, role, name) VALUES (?, ?, ?, ?)"),
  getIndividual: db.prepare("SELECT * FROM individuals WHERE id = ?"),
  getIndividualsByCouple: db.prepare("SELECT * FROM individuals WHERE couple_id = ?"),
  updateDomain: db.prepare("UPDATE individuals SET current_domain = ? WHERE id = ?"),
  updateDimensions: db.prepare("UPDATE individuals SET dimensions = ?, domain_summaries = ? WHERE id = ?"),
  setOnboardingComplete: db.prepare("UPDATE individuals SET onboarding_complete = 1 WHERE id = ?"),
  getConversation: db.prepare("SELECT * FROM conversations WHERE individual_id = ? AND domain_index = ?"),
  createConversation: db.prepare("INSERT INTO conversations (individual_id, domain_index, messages) VALUES (?, ?, ?)"),
  updateConversation: db.prepare("UPDATE conversations SET messages = ?, updated_at = datetime('now') WHERE id = ?"),
  completeConversation: db.prepare("UPDATE conversations SET completed = 1, updated_at = datetime('now') WHERE id = ?"),
  getMarriageModel: db.prepare("SELECT * FROM marriage_models WHERE couple_id = ?"),
  upsertMarriageModel: db.prepare(`
    INSERT INTO marriage_models (couple_id, model, report, generated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(couple_id) DO UPDATE SET model = excluded.model, report = excluded.report, generated_at = excluded.generated_at
  `),

  // Arguments
  createArgument: db.prepare("INSERT INTO arguments (id, couple_id) VALUES (?, ?)"),
  getActiveArgument: db.prepare("SELECT * FROM arguments WHERE couple_id = ? AND status IN ('open','synthesis_pending') ORDER BY created_at DESC LIMIT 1"),
  setArgumentStatus: db.prepare("UPDATE arguments SET status = ? WHERE id = ?"),

  // Argument responses
  getArgumentResponse: db.prepare("SELECT * FROM argument_responses WHERE argument_id = ? AND individual_id = ?"),
  createArgumentResponse: db.prepare("INSERT INTO argument_responses (id, argument_id, individual_id) VALUES (?, ?, ?)"),
  updateArgumentMessages: db.prepare("UPDATE argument_responses SET messages = ? WHERE argument_id = ? AND individual_id = ?"),
  submitArgumentResponse: db.prepare("UPDATE argument_responses SET snap_s=?, snap_n=?, snap_a=?, snap_p=?, ownership_level=?, completed=1, submitted_at=datetime('now') WHERE argument_id=? AND individual_id=?"),
  getArgumentResponsesByArgument: db.prepare("SELECT * FROM argument_responses WHERE argument_id = ?"),

  // Argument synthesis
  createSynthesis: db.prepare("INSERT INTO argument_synthesis (argument_id, couple_view, counselor_view) VALUES (?, ?, ?)"),
  getSynthesis: db.prepare("SELECT * FROM argument_synthesis WHERE argument_id = ?"),

  // Season
  getCoupleSeason: db.prepare("SELECT season_track, season_current, season_next, season_progress, season_updated FROM couples WHERE id = ?"),
  updateCoupleSeason: db.prepare("UPDATE couples SET season_track=?, season_current=?, season_next=?, season_progress=?, season_updated=datetime('now') WHERE id = ?"),

  // Timeline
  getTimeline: db.prepare("SELECT * FROM timeline_entries WHERE couple_id = ? ORDER BY entry_date DESC"),
  addTimelineEntry: db.prepare("INSERT INTO timeline_entries (couple_id, entry_type, title, description, entry_date) VALUES (?, ?, ?, ?, ?)"),
  deleteTimelineEntry: db.prepare("DELETE FROM timeline_entries WHERE id = ? AND couple_id = ?"),

  // Premarital sessions
  getPremaritalSession: db.prepare("SELECT * FROM premarital_sessions WHERE couple_id = ? AND session_num = ?"),
  getPremaritalSessions: db.prepare("SELECT session_num, completed FROM premarital_sessions WHERE couple_id = ?"),
  upsertPremaritalMessages: db.prepare("INSERT INTO premarital_sessions (couple_id, session_num, messages) VALUES (?, ?, ?) ON CONFLICT(couple_id, session_num) DO UPDATE SET messages = excluded.messages"),
  completePremaritalSession: db.prepare("UPDATE premarital_sessions SET completed = 1, completed_at = datetime('now') WHERE couple_id = ? AND session_num = ?")
};

// ─── Anthropic ───────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId() {
  return crypto.randomUUID();
}

function generateInviteCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function getOrCreateConversation(individualId, domainIndex) {
  let conv = stmts.getConversation.get(individualId, domainIndex);
  if (!conv) {
    stmts.createConversation.run(individualId, domainIndex, "[]");
    conv = stmts.getConversation.get(individualId, domainIndex);
  }
  return conv;
}

function messagesToText(messages) {
  return messages.map(m => `${m.role === "user" ? "Person" : "Seven"}: ${m.content}`).join("\n\n");
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Session expired — please log in again" });
  }
}

function setAuthCookie(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
  res.cookie("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────

// Register — handles both "begin journey" and "join partner"
app.post("/api/auth/register", async (req, res) => {
  const { name, email, password, invite_code } = req.body;
  if (!name?.trim())  return res.status(400).json({ error: "Name is required." });
  if (!email?.trim()) return res.status(400).json({ error: "Email is required." });
  if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

  const normalizedEmail = email.toLowerCase().trim();
  const existing = db.prepare("SELECT id FROM individuals WHERE email = ?").get(normalizedEmail);
  if (existing) return res.status(400).json({ error: "An account with this email already exists." });

  const password_hash = await bcrypt.hash(password, 10);
  let individual_id, couple_id, invite_code_out;

  try {
    if (invite_code) {
      const couple = stmts.getCoupleByInvite.get(invite_code.toUpperCase());
      if (!couple) return res.status(404).json({ error: "Invite code not found." });
      const members = stmts.getIndividualsByCouple.all(couple.id);
      if (members.length >= 2) return res.status(400).json({ error: "This couple already has two members." });

      individual_id = generateId();
      couple_id = couple.id;
      invite_code_out = couple.invite_code;
      db.prepare("INSERT INTO individuals (id, couple_id, role, name, email, password_hash) VALUES (?, ?, ?, ?, ?, ?)").run(individual_id, couple_id, "spouse2", name.trim(), normalizedEmail, password_hash);
      db.prepare("UPDATE couples SET status = 'both_joined' WHERE id = ?").run(couple_id);
    } else {
      couple_id = generateId();
      individual_id = generateId();
      let code;
      for (let i = 0; i < 10; i++) {
        const c = generateInviteCode();
        if (!db.prepare("SELECT id FROM couples WHERE invite_code = ?").get(c)) { code = c; break; }
      }
      if (!code) return res.status(500).json({ error: "Could not generate invite code." });

      const track = req.body.couple_track || "standard";
      db.prepare("INSERT INTO couples (id, invite_code, couple_track) VALUES (?, ?, ?)").run(couple_id, code, track);
      db.prepare("INSERT INTO individuals (id, couple_id, role, name, email, password_hash) VALUES (?, ?, ?, ?, ?, ?)").run(individual_id, couple_id, "spouse1", name.trim(), normalizedEmail, password_hash);
      invite_code_out = code;
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const finalCouple = stmts.getCouple.get(couple_id);
  setAuthCookie(res, { individual_id, couple_id, name: name.trim() });
  res.json({ individual_id, couple_id, invite_code: invite_code_out, name: name.trim(), couple_track: finalCouple?.couple_track || "standard" });
});

// Login
app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });

  const individual = db.prepare("SELECT * FROM individuals WHERE email = ?").get(email.toLowerCase().trim());
  if (!individual || !individual.password_hash) return res.status(401).json({ error: "Invalid email or password." });

  const valid = await bcrypt.compare(password, individual.password_hash);
  if (!valid) return res.status(401).json({ error: "Invalid email or password." });

  setAuthCookie(res, { individual_id: individual.id, couple_id: individual.couple_id, name: individual.name });
  res.json({ individual_id: individual.id, couple_id: individual.couple_id, name: individual.name });
});

// Current user (from cookie)
app.get("/api/auth/me", requireAuth, (req, res) => {
  res.json(req.user);
});

// Logout
app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

// ─── Routes: Couple Setup ─────────────────────────────────────────────────────

// Create new couple (first spouse)
app.post("/api/couple/create", (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name required" });

  const coupleId = generateId();
  const individualId = generateId();
  const inviteCode = generateInviteCode();

  stmts.createCouple.run(coupleId, inviteCode);
  stmts.createIndividual.run(individualId, coupleId, "spouse1", name.trim());

  res.json({ individual_id: individualId, couple_id: coupleId, invite_code: inviteCode, name: name.trim() });
});

// Join existing couple (second spouse)
app.post("/api/couple/join", (req, res) => {
  const { name, invite_code } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "Name required" });
  if (!invite_code) return res.status(400).json({ error: "Invite code required" });

  const couple = stmts.getCoupleByInvite.get(invite_code.trim().toUpperCase());
  if (!couple) return res.status(404).json({ error: "Invite code not found" });

  const members = stmts.getIndividualsByCouple.all(couple.id);
  if (members.length >= 2) return res.status(400).json({ error: "This couple already has two members" });

  const individualId = generateId();
  stmts.createIndividual.run(individualId, couple.id, "spouse2", name.trim());

  res.json({ individual_id: individualId, couple_id: couple.id, name: name.trim() });
});

// Look up existing account by invite code + name
app.post("/api/me/lookup", (req, res) => {
  const { invite_code, name } = req.body;
  if (!invite_code || !name) return res.status(400).json({ error: "Invite code and name required." });

  const couple = stmts.getCoupleByInvite.get(invite_code.toUpperCase());
  if (!couple) return res.status(404).json({ error: "Invite code not found. Check the code and try again." });

  const members = stmts.getIndividualsByCouple.all(couple.id);
  const match   = members.find(m => m.name.toLowerCase() === name.trim().toLowerCase());
  if (!match) return res.status(404).json({ error: "No account found with that name. Check your spelling and try again." });

  res.json({ individual_id: match.id, couple_id: couple.id, name: match.name });
});

// Get my profile + couple status
app.get("/api/me/:individual_id", (req, res) => {
  const individual = stmts.getIndividual.get(req.params.individual_id);
  if (!individual) return res.status(404).json({ error: "Not found" });

  const members = stmts.getIndividualsByCouple.all(individual.couple_id);
  const partner = members.find(m => m.id !== individual.id);
  const couple = stmts.getCouple.get(individual.couple_id);

  const dimensions = JSON.parse(individual.dimensions || "{}");
  const domainSummaries = JSON.parse(individual.domain_summaries || "{}");

  res.json({
    id: individual.id,
    name: individual.name,
    role: individual.role,
    couple_id: individual.couple_id,
    invite_code: couple.invite_code,
    current_domain: individual.current_domain,
    onboarding_complete: !!individual.onboarding_complete,
    dimensions,
    domain_summaries: domainSummaries,
    domains_total: DOMAINS.length,
    partner: partner ? { id: partner.id, name: partner.name, onboarding_complete: !!partner.onboarding_complete } : null,
    both_complete: partner ? (!!individual.onboarding_complete && !!partner.onboarding_complete) : false,
    couple_track: couple.couple_track || "standard"
  });
});

// ─── Routes: Discovery Conversation ──────────────────────────────────────────

// Get conversation history for a specific domain
app.get("/api/conversation/:individual_id/:domain_index", (req, res) => {
  const { individual_id, domain_index } = req.params;
  const conv = stmts.getConversation.get(individual_id, parseInt(domain_index));
  if (!conv) return res.json({ messages: [], completed: false });
  res.json({ messages: JSON.parse(conv.messages || "[]"), completed: !!conv.completed });
});

// Stream a chat message in the discovery conversation
app.post("/api/chat", async (req, res) => {
  const { individual_id, domain_index, message } = req.body;

  if (!individual_id || domain_index === undefined || !message?.trim()) {
    return res.status(400).json({ error: "individual_id, domain_index, and message required" });
  }

  const individual = stmts.getIndividual.get(individual_id);
  if (!individual) return res.status(404).json({ error: "Individual not found" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  const conv = getOrCreateConversation(individual_id, domain_index);
  const history = JSON.parse(conv.messages || "[]");

  const isStart = message.trim() === "__START__";

  // For domain start, send a hidden trigger — don't save it to history
  const messagesToSend = isStart
    ? [{ role: "user", content: "Please begin." }]
    : [...history, { role: "user", content: message.trim() }];

  if (!isStart) {
    history.push({ role: "user", content: message.trim() });
  }

  const couple          = stmts.getCouple.get(individual.couple_id);
  const discContext     = couple?.couple_track === "premarital" ? "premarital" : "standard";
  const assistantCount  = history.filter(m => m.role === "assistant").length;
  const includeSynthesis = assistantCount > 0 && (assistantCount + 1) % 3 === 0;
  const systemPrompt    = buildDiscoveryPrompt(individual.name, domain_index, discContext, includeSynthesis);

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  try {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      messages: messagesToSend
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const text = event.delta.text;
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    // Save full conversation
    history.push({ role: "assistant", content: fullResponse });
    stmts.updateConversation.run(JSON.stringify(history), conv.id);

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("Chat error:", err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// Mark current domain complete — extract dimensions and advance
app.post("/api/domain/complete", async (req, res) => {
  const { individual_id, domain_index } = req.body;

  const individual = stmts.getIndividual.get(individual_id);
  if (!individual) return res.status(404).json({ error: "Individual not found" });

  const conv = stmts.getConversation.get(individual_id, domain_index);
  if (!conv) return res.status(400).json({ error: "No conversation found for this domain" });

  stmts.completeConversation.run(conv.id);

  const domain = DOMAINS[domain_index];
  const messages = JSON.parse(conv.messages || "[]");
  const conversationText = messagesToText(messages);

  // Extract dimensions using Claude
  let extractedData = { dimensions: {}, domain_summary: "", themes: [] };
  try {
    const extractionPrompt = buildExtractionPrompt(individual.name, domain, conversationText);
    const extraction = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: extractionPrompt }]
    });
    extractedData = JSON.parse(extraction.content[0].text);
  } catch (err) {
    console.error("Extraction error:", err.message);
  }

  // Merge into existing dimensions
  const existingDimensions = JSON.parse(individual.dimensions || "{}");
  const existingSummaries = JSON.parse(individual.domain_summaries || "{}");

  const updatedDimensions = { ...existingDimensions, ...extractedData.dimensions };
  existingSummaries[domain.key] = {
    summary: extractedData.domain_summary,
    themes: extractedData.themes
  };

  stmts.updateDimensions.run(
    JSON.stringify(updatedDimensions),
    JSON.stringify(existingSummaries),
    individual_id
  );

  // Advance to next domain or complete onboarding
  const nextDomain = domain_index + 1;
  const isLastDomain = nextDomain >= DOMAINS.length;

  if (isLastDomain) {
    stmts.setOnboardingComplete.run(individual_id);
  } else {
    stmts.updateDomain.run(nextDomain, individual_id);
  }

  res.json({
    domain_summary: extractedData.domain_summary,
    themes: extractedData.themes,
    next_domain: isLastDomain ? null : nextDomain,
    onboarding_complete: isLastDomain
  });
});

// ─── Routes: Marriage Model & Report ─────────────────────────────────────────

// Generate marriage model + trajectory report (when both spouses done)
app.post("/api/couple/generate-report", async (req, res) => {
  const { couple_id } = req.body;

  const members = stmts.getIndividualsByCouple.all(couple_id);
  if (members.length < 2) return res.status(400).json({ error: "Both spouses must complete onboarding first" });
  if (!members.every(m => m.onboarding_complete)) return res.status(400).json({ error: "Both spouses must complete onboarding first" });

  const [s1, s2] = members;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    res.write(`data: ${JSON.stringify({ status: "Building marriage model..." })}\n\n`);

    const s1Profile = {
      name: s1.name,
      dimensions: JSON.parse(s1.dimensions || "{}"),
      domain_summaries: JSON.parse(s1.domain_summaries || "{}")
    };
    const s2Profile = {
      name: s2.name,
      dimensions: JSON.parse(s2.dimensions || "{}"),
      domain_summaries: JSON.parse(s2.domain_summaries || "{}")
    };

    // Generate marriage model
    const modelResponse = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      messages: [{ role: "user", content: buildMarriageModelPrompt(s1.name, s2.name, s1Profile, s2Profile) }]
    });

    const marriageModel = JSON.parse(modelResponse.content[0].text);

    res.write(`data: ${JSON.stringify({ status: "Generating trajectory report..." })}\n\n`);

    // Generate trajectory report
    const reportResponse = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      messages: [{ role: "user", content: buildTrajectoryReportPrompt(s1.name, s2.name, marriageModel) }]
    });

    const trajectoryReport = JSON.parse(reportResponse.content[0].text);

    stmts.upsertMarriageModel.run(couple_id, JSON.stringify(marriageModel), JSON.stringify(trajectoryReport));

    res.write(`data: ${JSON.stringify({ status: "done", couple_id })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Report generation error:", err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// Get trajectory report (couple-facing)
app.get("/api/report/:couple_id", (req, res) => {
  const members = stmts.getIndividualsByCouple.all(req.params.couple_id);
  const model = stmts.getMarriageModel.get(req.params.couple_id);

  if (!model || !model.report || model.report === "{}") {
    return res.status(404).json({ error: "Report not yet generated" });
  }

  const report = JSON.parse(model.report);
  const marriageModel = JSON.parse(model.model);

  res.json({
    couple_id: req.params.couple_id,
    spouses: members.map(m => ({ id: m.id, name: m.name })),
    report_intro: report.report_intro,
    seasons: report.seasons?.map(s => ({
      season: s.season,
      name: s.name,
      strengths: s.strengths,
      challenges: s.challenges,
      conversations_to_have: s.conversations_to_have,
      habits_to_build: s.habits_to_build,
      season_summary: s.season_summary
    })),
    closing: report.closing,
    marriage_strengths: marriageModel.strengths,
    marriage_growth_areas: marriageModel.growth_areas,
    dynamic_summary: marriageModel.dynamic_summary,
    generated_at: model.generated_at
  });
});

// Counselor view — includes raw dimensions and all data
app.get("/api/counselor/:couple_id", (req, res) => {
  const members = stmts.getIndividualsByCouple.all(req.params.couple_id);
  const model = stmts.getMarriageModel.get(req.params.couple_id);

  if (!model) return res.status(404).json({ error: "Report not found" });

  const report = JSON.parse(model.report || "{}");
  const marriageModel = JSON.parse(model.model || "{}");

  res.json({
    couple_id: req.params.couple_id,
    spouses: members.map(m => ({
      id: m.id,
      name: m.name,
      role: m.role,
      dimensions: JSON.parse(m.dimensions || "{}"),
      domain_summaries: JSON.parse(m.domain_summaries || "{}"),
      onboarding_complete: !!m.onboarding_complete
    })),
    marriage_model: marriageModel,
    trajectory_seasons: report.seasons,
    counselor_notes: marriageModel.counselor_notes,
    generated_at: model.generated_at
  });
});

// ─── We Are Arguing ──────────────────────────────────────────────────────────

// Status — single poll endpoint for all frontend state decisions
app.get("/api/argue/status/:individual_id", (req, res) => {
  const individual = stmts.getIndividual.get(req.params.individual_id);
  if (!individual) return res.status(404).json({ error: "Not found" });

  const members = stmts.getIndividualsByCouple.all(individual.couple_id);
  const partner = members.find(m => m.id !== individual.id);
  if (!partner) return res.json({ state: "no_partner" });

  const activeArg = stmts.getActiveArgument.get(individual.couple_id);
  if (!activeArg) return res.json({ state: "no_argument", partner: { name: partner.name } });

  if (activeArg.status === "complete") {
    const synthesis = stmts.getSynthesis.get(activeArg.id);
    const cv = JSON.parse(synthesis.couple_view);
    return res.json({ state: "synthesis", argument_id: activeArg.id, couple_view: cv, partner: { name: partner.name } });
  }

  const myResponse = stmts.getArgumentResponse.get(activeArg.id, individual.id);
  const partnerResponse = stmts.getArgumentResponse.get(activeArg.id, partner.id);

  if (!myResponse || !myResponse.completed) {
    const messages = myResponse ? JSON.parse(myResponse.messages || "[]") : [];
    return res.json({
      state: "my_turn",
      argument_id: activeArg.id,
      has_messages: messages.length > 0,
      partner: { name: partner.name }
    });
  }

  return res.json({ state: "waiting", argument_id: activeArg.id, partner: { name: partner.name } });
});

// Start — create or return active argument, ensure response row exists
app.post("/api/argue/start", (req, res) => {
  const { individual_id } = req.body;
  if (!individual_id) return res.status(400).json({ error: "individual_id required" });

  const individual = stmts.getIndividual.get(individual_id);
  if (!individual) return res.status(404).json({ error: "Not found" });

  const members = stmts.getIndividualsByCouple.all(individual.couple_id);
  if (members.length < 2) return res.status(400).json({ error: "Partner has not joined yet" });

  const startTransaction = db.transaction(() => {
    let arg = stmts.getActiveArgument.get(individual.couple_id);
    if (!arg) {
      stmts.createArgument.run(generateId(), individual.couple_id);
      arg = stmts.getActiveArgument.get(individual.couple_id);
    }
    let resp = stmts.getArgumentResponse.get(arg.id, individual_id);
    if (!resp) {
      stmts.createArgumentResponse.run(generateId(), arg.id, individual_id);
    }
    return arg;
  });

  const arg = startTransaction();
  res.json({ argument_id: arg.id });
});

// Load messages for resumption
app.get("/api/argue/:argument_id/messages/:individual_id", (req, res) => {
  const { argument_id, individual_id } = req.params;
  const resp = stmts.getArgumentResponse.get(argument_id, individual_id);
  if (!resp) return res.json({ messages: [], completed: false });
  res.json({ messages: JSON.parse(resp.messages || "[]"), completed: !!resp.completed });
});

// SNAP conversation — SSE streaming
app.post("/api/argue/message", async (req, res) => {
  const { argument_id, individual_id, message } = req.body;
  if (!argument_id || !individual_id || !message?.trim()) {
    return res.status(400).json({ error: "argument_id, individual_id, message required" });
  }

  const individual = stmts.getIndividual.get(individual_id);
  if (!individual) return res.status(404).json({ error: "Individual not found" });

  const argResp = stmts.getArgumentResponse.get(argument_id, individual_id);
  if (!argResp) return res.status(404).json({ error: "Response record not found" });
  if (argResp.completed) return res.status(400).json({ error: "Already submitted" });

  const members = stmts.getIndividualsByCouple.all(individual.couple_id);
  const partner = members.find(m => m.id !== individual_id);

  const history = JSON.parse(argResp.messages || "[]");
  const isStart = message.trim() === "__START__";
  const messagesToSend = isStart
    ? [{ role: "user", content: "Please begin." }]
    : [...history, { role: "user", content: message.trim() }];

  if (!isStart) history.push({ role: "user", content: message.trim() });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";
  try {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: buildSnapPrompt(individual.name, partner?.name || "your partner"),
      messages: messagesToSend
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    history.push({ role: "assistant", content: fullResponse });
    stmts.updateArgumentMessages.run(JSON.stringify(history), argument_id, individual_id);
    res.write("data: [DONE]\n\n");
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// Submit my side — extraction + synthesis if both done
app.post("/api/argue/submit", async (req, res) => {
  const { argument_id, individual_id } = req.body;

  const individual = stmts.getIndividual.get(individual_id);
  if (!individual) return res.status(404).json({ error: "Not found" });

  const argResp = stmts.getArgumentResponse.get(argument_id, individual_id);
  if (!argResp) return res.status(404).json({ error: "Response not found" });
  if (argResp.completed) return res.status(400).json({ error: "Already submitted" });

  const messages = JSON.parse(argResp.messages || "[]");
  const conversationText = messagesToText(messages);

  let extracted = { snap_s: "", snap_n: "", snap_a: "", snap_p: "", ownership_level: "unclear" };
  try {
    const raw = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: buildSnapExtractionPrompt(individual.name, conversationText) }]
    });
    extracted = JSON.parse(raw.content[0].text.replace(/^```json\n?|```$/gm, "").trim());
  } catch (err) {
    console.error("SNAP extraction error:", err.message);
  }

  stmts.submitArgumentResponse.run(
    extracted.snap_s, extracted.snap_n, extracted.snap_a, extracted.snap_p,
    extracted.ownership_level, argument_id, individual_id
  );

  const allResponses = stmts.getArgumentResponsesByArgument.all(argument_id);
  const bothComplete = allResponses.length === 2 && allResponses.every(r => r.completed);

  if (!bothComplete) return res.json({ state: "waiting" });

  stmts.setArgumentStatus.run("synthesis_pending", argument_id);

  try {
    const [r1, r2] = allResponses;
    const p1 = stmts.getIndividual.get(r1.individual_id);
    const p2 = stmts.getIndividual.get(r2.individual_id);

    const synthRaw = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      messages: [{
        role: "user",
        content: buildArgumentSynthesisPrompt(
          p1.name, { snap_s: r1.snap_s, snap_n: r1.snap_n, snap_a: r1.snap_a, snap_p: r1.snap_p, ownership_level: r1.ownership_level },
          p2.name, { snap_s: r2.snap_s, snap_n: r2.snap_n, snap_a: r2.snap_a, snap_p: r2.snap_p, ownership_level: r2.ownership_level }
        )
      }]
    });

    const synthesis = JSON.parse(synthRaw.content[0].text.replace(/^```json\n?|```$/gm, "").trim());
    stmts.createSynthesis.run(argument_id, JSON.stringify(synthesis.couple_view), JSON.stringify(synthesis.counselor_view));
    stmts.setArgumentStatus.run("complete", argument_id);

    return res.json({ state: "synthesis", couple_view: synthesis.couple_view });
  } catch (err) {
    stmts.setArgumentStatus.run("open", argument_id);
    return res.status(500).json({ error: "Synthesis failed: " + err.message });
  }
});

// Counselor view
app.get("/api/argue/:argument_id/counselor", (req, res) => {
  const synthesis = stmts.getSynthesis.get(req.params.argument_id);
  if (!synthesis) return res.status(404).json({ error: "No synthesis found" });

  const allResponses = stmts.getArgumentResponsesByArgument.all(req.params.argument_id);
  const enriched = allResponses.map(r => {
    const person = stmts.getIndividual.get(r.individual_id);
    return { name: person.name, snap_s: r.snap_s, snap_n: r.snap_n, snap_a: r.snap_a, snap_p: r.snap_p, ownership_level: r.ownership_level };
  });

  res.json({
    argument_id: req.params.argument_id,
    counselor_view: JSON.parse(synthesis.counselor_view),
    responses: enriched,
    generated_at: synthesis.generated_at
  });
});

// ─── Season ───────────────────────────────────────────────────────────────────

app.get("/api/couple/:id/season", (req, res) => {
  const row = stmts.getCoupleSeason.get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({
    season_track:    row.season_track    || "standard",
    season_current:  row.season_current  || null,
    season_next:     row.season_next     || null,
    season_progress: row.season_progress || 0.0,
    season_updated:  row.season_updated  || null
  });
});

app.post("/api/couple/:id/season", (req, res) => {
  const { season_track, season_current, season_next, season_progress } = req.body;
  stmts.updateCoupleSeason.run(
    season_track || "standard",
    season_current || null,
    season_next    || null,
    season_progress || 0.0,
    req.params.id
  );
  res.json({ success: true });
});

app.post("/api/couple/:id/season/infer", async (req, res) => {
  const couple  = stmts.getCouple.get(req.params.id);
  if (!couple) return res.status(404).json({ error: "Not found" });

  const members = stmts.getIndividualsByCouple.all(req.params.id);
  const [p1, p2] = members;

  const profile = (ind) => ind ? {
    dimensions: JSON.parse(ind.dimensions || "{}"),
    summaries:  JSON.parse(ind.domain_summaries || "{}")
  } : {};

  try {
    const raw = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      messages: [{ role: "user", content: buildSeasonInferencePrompt(
        p1?.name || "Partner 1",
        p2?.name || "Partner 2",
        profile(p1), profile(p2),
        couple.season_track || "standard"
      )}]
    });
    const result = JSON.parse(raw.content[0].text.replace(/^```json\n?|```$/gm, "").trim());
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Insight: deeper behavioral analysis ─────────────────────────────────────

app.post("/api/insight/deepen", async (req, res) => {
  const { individual_id, insight, user_response, domain_index } = req.body;

  const individual = stmts.getIndividual.get(individual_id);
  if (!individual) return res.status(404).json({ error: "Individual not found" });

  const domain = DOMAINS[domain_index] || { name: "this topic" };

  const prompt = `You are a perceptive relationship psychologist. You are analyzing a moment from a discovery conversation with ${individual.name}.

Domain: ${domain.name}

What ${individual.name} said:
"${user_response}"

Seven's observation about this response:
"${insight}"

Based on this exchange, provide a warm, specific, forward-looking analysis covering:
1. What behavioral characteristics or emotional patterns this response suggests about ${individual.name} — be concrete, not generic
2. How this characteristic might show up — as both a strength and a challenge — across the seasons of marriage (you can reference specific seasons: Engagement & Newlyweds, Young Children, Empty Nest, etc. where relevant)
3. One thing ${individual.name} could lean into, and one thing worth staying aware of

Keep it warm and human — never clinical. Reference what they actually said. 3–4 paragraphs.`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }]
    });
    res.json({ analysis: response.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Timeline ────────────────────────────────────────────────────────────────

app.get("/api/couple/:id/timeline", (req, res) => {
  res.json(stmts.getTimeline.all(req.params.id));
});

app.post("/api/couple/:id/timeline", (req, res) => {
  const { entry_type, title, description, entry_date } = req.body;
  if (!title || !entry_date || !entry_type) return res.status(400).json({ error: "entry_type, title, and entry_date required." });
  const info = stmts.addTimelineEntry.run(req.params.id, entry_type, title.trim(), description?.trim() || "", entry_date);
  res.json({ id: info.lastInsertRowid, success: true });
});

app.delete("/api/couple/:id/timeline/:entry_id", (req, res) => {
  stmts.deleteTimelineEntry.run(req.params.entry_id, req.params.id);
  res.json({ success: true });
});

// ─── Premarital Sessions ──────────────────────────────────────────────────────

app.get("/api/premarital/:couple_id/ready", (req, res) => {
  const couple  = stmts.getCouple.get(req.params.couple_id);
  if (!couple) return res.status(404).json({ error: "Not found" });

  const members = stmts.getIndividualsByCouple.all(req.params.couple_id);
  const me      = members.find(m => m.id === req.query.individual_id) || members[0];
  const partner = members.find(m => m.id !== me?.id);

  res.json({
    my_discovery_complete:      !!me?.onboarding_complete,
    partner_joined:             !!partner,
    partner_name:               partner?.name || null,
    partner_discovery_complete: !!partner?.onboarding_complete,
    sessions_unlocked:          !!(me?.onboarding_complete && partner?.onboarding_complete),
    invite_code:                couple.invite_code
  });
});

app.get("/api/premarital/:couple_id/progress", (req, res) => {
  const rows = stmts.getPremaritalSessions.all(req.params.couple_id);
  const completed = {};
  rows.forEach(r => { completed[r.session_num] = !!r.completed; });
  const sessions = PREMARITAL_SESSIONS.map(s => ({
    num: s.num, title: s.title, completed: !!completed[s.num]
  }));
  res.json({ sessions, completed_count: rows.filter(r => r.completed).length });
});

app.get("/api/premarital/:couple_id/session/:num", (req, res) => {
  const row = stmts.getPremaritalSession.get(req.params.couple_id, parseInt(req.params.num));
  if (!row) return res.json({ messages: [], completed: false });
  res.json({ messages: JSON.parse(row.messages || "[]"), completed: !!row.completed });
});

app.post("/api/premarital/message", async (req, res) => {
  const { couple_id, session_num, message } = req.body;
  if (!couple_id || !session_num || !message?.trim()) return res.status(400).json({ error: "couple_id, session_num, message required." });

  const members = stmts.getIndividualsByCouple.all(couple_id);
  const [p1, p2] = members;
  const row = stmts.getPremaritalSession.get(couple_id, parseInt(session_num));
  const history = row ? JSON.parse(row.messages || "[]") : [];

  const isStart = message.trim() === "__START__";
  const messagesToSend = isStart ? [{ role: "user", content: "Please begin." }] : [...history, { role: "user", content: message.trim() }];
  if (!isStart) history.push({ role: "user", content: message.trim() });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";
  try {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: buildPremaritalSessionPrompt(p1?.name || "Partner 1", p2?.name || "Partner 2", parseInt(session_num)),
      messages: messagesToSend
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    history.push({ role: "assistant", content: fullResponse });
    stmts.upsertPremaritalMessages.run(couple_id, parseInt(session_num), JSON.stringify(history));
    res.write("data: [DONE]\n\n");
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

app.post("/api/premarital/complete", (req, res) => {
  const { couple_id, session_num } = req.body;
  stmts.completePremaritalSession.run(couple_id, parseInt(session_num));
  res.json({ success: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`7 Seasons running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("WARNING: ANTHROPIC_API_KEY not set — AI features will not work");
  }
});
