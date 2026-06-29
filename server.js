require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const express    = require("express");
const Anthropic  = require("@anthropic-ai/sdk");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const path       = require("path");
const crypto     = require("crypto");
const db         = require("./db");

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

const app      = express();
const PORT     = process.env.PORT || 3050;
const JWT_SECRET = process.env.JWT_SECRET || "7seasons-dev-secret-change-before-deploy";
const anthropic  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId()         { return crypto.randomUUID(); }
function generateInviteCode() { return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function messagesToText(msgs) { return msgs.map(m => `${m.role === "user" ? "Person" : "Seven"}: ${m.content}`).join("\n\n"); }

async function getOrCreateConversation(individualId, domainIndex) {
  let conv = await db.getOne(
    "SELECT * FROM conversations WHERE individual_id = $1 AND domain_index = $2",
    [individualId, domainIndex]
  );
  if (!conv) {
    await db.run(
      "INSERT INTO conversations (individual_id, domain_index, messages) VALUES ($1, $2, $3)",
      [individualId, domainIndex, "[]"]
    );
    conv = await db.getOne(
      "SELECT * FROM conversations WHERE individual_id = $1 AND domain_index = $2",
      [individualId, domainIndex]
    );
  }
  return conv;
}

// ─── Auth Middleware ───────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const token = req.cookies?.token;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: "Session expired — please log in again" }); }
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

app.post("/api/auth/register", async (req, res) => {
  const { name, email, password, invite_code } = req.body;
  if (!name?.trim())  return res.status(400).json({ error: "Name is required." });
  if (!email?.trim()) return res.status(400).json({ error: "Email is required." });
  if (!password || password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

  const normalizedEmail = email.toLowerCase().trim();
  const existing = await db.getOne("SELECT id FROM individuals WHERE email = $1", [normalizedEmail]);
  if (existing) return res.status(400).json({ error: "An account with this email already exists." });

  const password_hash = await bcrypt.hash(password, 10);
  let individual_id, couple_id, invite_code_out;

  try {
    if (invite_code) {
      const couple = await db.getOne("SELECT * FROM couples WHERE invite_code = $1", [invite_code.toUpperCase()]);
      if (!couple) return res.status(404).json({ error: "Invite code not found." });
      const members = await db.getAll("SELECT id FROM individuals WHERE couple_id = $1", [couple.id]);
      if (members.length >= 2) return res.status(400).json({ error: "This couple already has two members." });

      individual_id   = generateId();
      couple_id       = couple.id;
      invite_code_out = couple.invite_code;
      await db.run(
        "INSERT INTO individuals (id, couple_id, role, name, email, password_hash) VALUES ($1,$2,$3,$4,$5,$6)",
        [individual_id, couple_id, "spouse2", name.trim(), normalizedEmail, password_hash]
      );
      await db.run("UPDATE couples SET status = 'both_joined' WHERE id = $1", [couple_id]);
    } else {
      couple_id     = generateId();
      individual_id = generateId();
      let code;
      for (let i = 0; i < 10; i++) {
        const c = generateInviteCode();
        const exists = await db.getOne("SELECT id FROM couples WHERE invite_code = $1", [c]);
        if (!exists) { code = c; break; }
      }
      if (!code) return res.status(500).json({ error: "Could not generate invite code." });

      const track = req.body.couple_track || "standard";
      await db.run("INSERT INTO couples (id, invite_code, couple_track) VALUES ($1,$2,$3)", [couple_id, code, track]);
      await db.run(
        "INSERT INTO individuals (id, couple_id, role, name, email, password_hash) VALUES ($1,$2,$3,$4,$5,$6)",
        [individual_id, couple_id, "spouse1", name.trim(), normalizedEmail, password_hash]
      );
      invite_code_out = code;
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const finalCouple = await db.getOne("SELECT * FROM couples WHERE id = $1", [couple_id]);
  setAuthCookie(res, { individual_id, couple_id, name: name.trim() });
  res.json({ individual_id, couple_id, invite_code: invite_code_out, name: name.trim(), couple_track: finalCouple?.couple_track || "standard" });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required." });

  const individual = await db.getOne("SELECT * FROM individuals WHERE email = $1", [email.toLowerCase().trim()]);
  if (!individual || !individual.password_hash) return res.status(401).json({ error: "Invalid email or password." });

  const valid = await bcrypt.compare(password, individual.password_hash);
  if (!valid) return res.status(401).json({ error: "Invalid email or password." });

  setAuthCookie(res, { individual_id: individual.id, couple_id: individual.couple_id, name: individual.name });
  res.json({ individual_id: individual.id, couple_id: individual.couple_id, name: individual.name });
});

app.get("/api/auth/me",    requireAuth, (req, res) => res.json(req.user));
app.post("/api/auth/logout", (req, res) => { res.clearCookie("token"); res.json({ success: true }); });

// ─── Couple / Individual ──────────────────────────────────────────────────────

app.post("/api/me/lookup", async (req, res) => {
  const { invite_code, name } = req.body;
  if (!invite_code || !name) return res.status(400).json({ error: "Invite code and name required." });

  const couple = await db.getOne("SELECT * FROM couples WHERE invite_code = $1", [invite_code.toUpperCase()]);
  if (!couple) return res.status(404).json({ error: "Invite code not found." });

  const members = await db.getAll("SELECT * FROM individuals WHERE couple_id = $1", [couple.id]);
  const match   = members.find(m => m.name.toLowerCase() === name.trim().toLowerCase());
  if (!match) return res.status(404).json({ error: "No account found with that name." });

  res.json({ individual_id: match.id, couple_id: couple.id, name: match.name });
});

app.get("/api/me/:individual_id", async (req, res) => {
  const individual = await db.getOne("SELECT * FROM individuals WHERE id = $1", [req.params.individual_id]);
  if (!individual) return res.status(404).json({ error: "Not found" });

  const members = await db.getAll("SELECT * FROM individuals WHERE couple_id = $1", [individual.couple_id]);
  const partner  = members.find(m => m.id !== individual.id);
  const couple   = await db.getOne("SELECT * FROM couples WHERE id = $1", [individual.couple_id]);

  res.json({
    id: individual.id, name: individual.name, role: individual.role,
    couple_id: individual.couple_id, invite_code: couple.invite_code,
    current_domain: individual.current_domain,
    onboarding_complete: !!individual.onboarding_complete,
    dimensions: JSON.parse(individual.dimensions || "{}"),
    domain_summaries: JSON.parse(individual.domain_summaries || "{}"),
    domains_total: DOMAINS.length,
    partner: partner ? { id: partner.id, name: partner.name, onboarding_complete: !!partner.onboarding_complete } : null,
    both_complete: partner ? (!!individual.onboarding_complete && !!partner.onboarding_complete) : false,
    couple_track: couple.couple_track || "standard"
  });
});

// ─── Discovery Conversation ───────────────────────────────────────────────────

app.get("/api/conversation/:individual_id/:domain_index", async (req, res) => {
  const conv = await db.getOne(
    "SELECT * FROM conversations WHERE individual_id = $1 AND domain_index = $2",
    [req.params.individual_id, parseInt(req.params.domain_index)]
  );
  if (!conv) return res.json({ messages: [], completed: false });
  res.json({ messages: JSON.parse(conv.messages || "[]"), completed: !!conv.completed });
});

app.post("/api/chat", async (req, res) => {
  const { individual_id, domain_index, message } = req.body;
  if (!individual_id || domain_index === undefined || !message?.trim())
    return res.status(400).json({ error: "individual_id, domain_index, and message required" });

  const individual = await db.getOne("SELECT * FROM individuals WHERE id = $1", [individual_id]);
  if (!individual) return res.status(404).json({ error: "Individual not found" });

  const conv    = await getOrCreateConversation(individual_id, domain_index);
  const history = JSON.parse(conv.messages || "[]");
  const isStart = message.trim() === "__START__";

  const messagesToSend = isStart
    ? [{ role: "user", content: "Please begin." }]
    : [...history, { role: "user", content: message.trim() }];

  if (!isStart) history.push({ role: "user", content: message.trim() });

  const couple          = await db.getOne("SELECT * FROM couples WHERE id = $1", [individual.couple_id]);
  const discContext     = couple?.couple_track === "premarital" ? "premarital" : "standard";
  const assistantCount  = history.filter(m => m.role === "assistant").length;
  const includeSynthesis = assistantCount > 0 && (assistantCount + 1) % 3 === 0;
  const systemPrompt    = buildDiscoveryPrompt(individual.name, domain_index, discContext, includeSynthesis);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";
  try {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6", max_tokens: 1024,
      system: systemPrompt, messages: messagesToSend
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullResponse += event.delta.text;
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }
    history.push({ role: "assistant", content: fullResponse });
    await db.run(
      "UPDATE conversations SET messages = $1, updated_at = NOW() WHERE id = $2",
      [JSON.stringify(history), conv.id]
    );
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (err) {
    console.error("Chat error:", err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

app.post("/api/domain/complete", async (req, res) => {
  const { individual_id, domain_index } = req.body;

  const individual = await db.getOne("SELECT * FROM individuals WHERE id = $1", [individual_id]);
  if (!individual) return res.status(404).json({ error: "Individual not found" });

  const conv = await db.getOne(
    "SELECT * FROM conversations WHERE individual_id = $1 AND domain_index = $2",
    [individual_id, domain_index]
  );
  if (!conv) return res.status(400).json({ error: "No conversation found for this domain" });

  await db.run("UPDATE conversations SET completed = 1, updated_at = NOW() WHERE id = $1", [conv.id]);

  const domain = DOMAINS[domain_index];
  const messages = JSON.parse(conv.messages || "[]");

  let extractedData = { dimensions: {}, domain_summary: "", themes: [] };
  try {
    const extraction = await anthropic.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 1024,
      messages: [{ role: "user", content: buildExtractionPrompt(individual.name, domain, messagesToText(messages)) }]
    });
    extractedData = JSON.parse(extraction.content[0].text);
  } catch (err) { console.error("Extraction error:", err.message); }

  const updatedDimensions  = { ...JSON.parse(individual.dimensions || "{}"), ...extractedData.dimensions };
  const existingSummaries  = JSON.parse(individual.domain_summaries || "{}");
  existingSummaries[domain.key] = { summary: extractedData.domain_summary, themes: extractedData.themes };

  const nextDomain   = domain_index + 1;
  const isLastDomain = nextDomain >= DOMAINS.length;

  await db.run(
    "UPDATE individuals SET dimensions = $1, domain_summaries = $2, current_domain = $3, onboarding_complete = $4 WHERE id = $5",
    [JSON.stringify(updatedDimensions), JSON.stringify(existingSummaries),
     isLastDomain ? domain_index : nextDomain, isLastDomain ? 1 : 0, individual_id]
  );

  res.json({ domain_summary: extractedData.domain_summary, themes: extractedData.themes, next_domain: isLastDomain ? null : nextDomain, onboarding_complete: isLastDomain });
});

// ─── Marriage Model & Report ──────────────────────────────────────────────────

app.post("/api/couple/generate-report", async (req, res) => {
  const { couple_id } = req.body;
  const members = await db.getAll("SELECT * FROM individuals WHERE couple_id = $1", [couple_id]);
  if (members.length < 2 || !members.every(m => m.onboarding_complete))
    return res.status(400).json({ error: "Both spouses must complete onboarding first" });

  const [s1, s2] = members;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    res.write(`data: ${JSON.stringify({ status: "Building marriage model..." })}\n\n`);
    const s1Profile = { name: s1.name, dimensions: JSON.parse(s1.dimensions || "{}"), domain_summaries: JSON.parse(s1.domain_summaries || "{}") };
    const s2Profile = { name: s2.name, dimensions: JSON.parse(s2.dimensions || "{}"), domain_summaries: JSON.parse(s2.domain_summaries || "{}") };

    const modelResponse = await anthropic.messages.create({
      model: "claude-opus-4-8", max_tokens: 2048,
      messages: [{ role: "user", content: buildMarriageModelPrompt(s1.name, s2.name, s1Profile, s2Profile) }]
    });
    const marriageModel = JSON.parse(modelResponse.content[0].text);

    res.write(`data: ${JSON.stringify({ status: "Generating trajectory report..." })}\n\n`);
    const reportResponse = await anthropic.messages.create({
      model: "claude-opus-4-8", max_tokens: 4096,
      messages: [{ role: "user", content: buildTrajectoryReportPrompt(s1.name, s2.name, marriageModel) }]
    });
    const trajectoryReport = JSON.parse(reportResponse.content[0].text);

    await db.run(
      `INSERT INTO marriage_models (couple_id, model, report, generated_at) VALUES ($1,$2,$3,NOW())
       ON CONFLICT(couple_id) DO UPDATE SET model=EXCLUDED.model, report=EXCLUDED.report, generated_at=EXCLUDED.generated_at`,
      [couple_id, JSON.stringify(marriageModel), JSON.stringify(trajectoryReport)]
    );

    res.write(`data: ${JSON.stringify({ status: "done", couple_id })}\n\n`);
    res.end();
  } catch (err) {
    console.error("Report generation error:", err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

app.get("/api/report/:couple_id", async (req, res) => {
  const members = await db.getAll("SELECT * FROM individuals WHERE couple_id = $1", [req.params.couple_id]);
  const model   = await db.getOne("SELECT * FROM marriage_models WHERE couple_id = $1", [req.params.couple_id]);
  if (!model || !model.report || model.report === "{}") return res.status(404).json({ error: "Report not yet generated" });

  const report       = JSON.parse(model.report);
  const marriageModel = JSON.parse(model.model);
  res.json({
    couple_id: req.params.couple_id,
    spouses: members.map(m => ({ id: m.id, name: m.name })),
    report_intro: report.report_intro,
    seasons: report.seasons,
    closing: report.closing,
    marriage_strengths: marriageModel.strengths,
    marriage_growth_areas: marriageModel.growth_areas,
    dynamic_summary: marriageModel.dynamic_summary,
    generated_at: model.generated_at
  });
});

app.get("/api/counselor/:couple_id", async (req, res) => {
  const members = await db.getAll("SELECT * FROM individuals WHERE couple_id = $1", [req.params.couple_id]);
  const model   = await db.getOne("SELECT * FROM marriage_models WHERE couple_id = $1", [req.params.couple_id]);
  if (!model) return res.status(404).json({ error: "Report not found" });

  const report       = JSON.parse(model.report || "{}");
  const marriageModel = JSON.parse(model.model || "{}");
  res.json({
    couple_id: req.params.couple_id,
    spouses: members.map(m => ({ id: m.id, name: m.name, role: m.role, dimensions: JSON.parse(m.dimensions || "{}"), domain_summaries: JSON.parse(m.domain_summaries || "{}"), onboarding_complete: !!m.onboarding_complete })),
    marriage_model: marriageModel, trajectory_seasons: report.seasons,
    counselor_notes: marriageModel.counselor_notes, generated_at: model.generated_at
  });
});

// ─── We Are Arguing ───────────────────────────────────────────────────────────

app.get("/api/argue/status/:individual_id", async (req, res) => {
  const individual = await db.getOne("SELECT * FROM individuals WHERE id = $1", [req.params.individual_id]);
  if (!individual) return res.status(404).json({ error: "Not found" });

  const members = await db.getAll("SELECT * FROM individuals WHERE couple_id = $1", [individual.couple_id]);
  const partner  = members.find(m => m.id !== individual.id);
  if (!partner) return res.json({ state: "no_partner" });

  const activeArg = await db.getOne(
    "SELECT * FROM arguments WHERE couple_id = $1 AND status IN ('open','synthesis_pending') ORDER BY created_at DESC LIMIT 1",
    [individual.couple_id]
  );
  if (!activeArg) return res.json({ state: "no_argument", partner: { name: partner.name } });

  if (activeArg.status === "complete") {
    const synthesis = await db.getOne("SELECT * FROM argument_synthesis WHERE argument_id = $1", [activeArg.id]);
    return res.json({ state: "synthesis", argument_id: activeArg.id, couple_view: JSON.parse(synthesis.couple_view), partner: { name: partner.name } });
  }

  const myResponse = await db.getOne("SELECT * FROM argument_responses WHERE argument_id = $1 AND individual_id = $2", [activeArg.id, individual.id]);
  if (!myResponse || !myResponse.completed) {
    const messages = myResponse ? JSON.parse(myResponse.messages || "[]") : [];
    return res.json({ state: "my_turn", argument_id: activeArg.id, has_messages: messages.length > 0, partner: { name: partner.name } });
  }
  return res.json({ state: "waiting", argument_id: activeArg.id, partner: { name: partner.name } });
});

app.post("/api/argue/start", async (req, res) => {
  const { individual_id } = req.body;
  if (!individual_id) return res.status(400).json({ error: "individual_id required" });

  const individual = await db.getOne("SELECT * FROM individuals WHERE id = $1", [individual_id]);
  if (!individual) return res.status(404).json({ error: "Not found" });

  const members = await db.getAll("SELECT id FROM individuals WHERE couple_id = $1", [individual.couple_id]);
  if (members.length < 2) return res.status(400).json({ error: "Partner has not joined yet" });

  const arg = await db.transaction(async (client) => {
    let existing = await client.query(
      "SELECT * FROM arguments WHERE couple_id = $1 AND status IN ('open','synthesis_pending') ORDER BY created_at DESC LIMIT 1",
      [individual.couple_id]
    );
    let a = existing.rows[0];
    if (!a) {
      const argId = generateId();
      await client.query("INSERT INTO arguments (id, couple_id) VALUES ($1,$2)", [argId, individual.couple_id]);
      existing = await client.query(
        "SELECT * FROM arguments WHERE couple_id = $1 AND status IN ('open','synthesis_pending') ORDER BY created_at DESC LIMIT 1",
        [individual.couple_id]
      );
      a = existing.rows[0];
    }
    const resp = await client.query("SELECT id FROM argument_responses WHERE argument_id = $1 AND individual_id = $2", [a.id, individual_id]);
    if (!resp.rows[0]) {
      await client.query("INSERT INTO argument_responses (id, argument_id, individual_id) VALUES ($1,$2,$3)", [generateId(), a.id, individual_id]);
    }
    return a;
  });

  res.json({ argument_id: arg.id });
});

app.get("/api/argue/:argument_id/messages/:individual_id", async (req, res) => {
  const resp = await db.getOne("SELECT * FROM argument_responses WHERE argument_id = $1 AND individual_id = $2", [req.params.argument_id, req.params.individual_id]);
  if (!resp) return res.json({ messages: [], completed: false });
  res.json({ messages: JSON.parse(resp.messages || "[]"), completed: !!resp.completed });
});

app.post("/api/argue/message", async (req, res) => {
  const { argument_id, individual_id, message } = req.body;
  if (!argument_id || !individual_id || !message?.trim()) return res.status(400).json({ error: "argument_id, individual_id, message required" });

  const individual = await db.getOne("SELECT * FROM individuals WHERE id = $1", [individual_id]);
  if (!individual) return res.status(404).json({ error: "Individual not found" });

  const argResp = await db.getOne("SELECT * FROM argument_responses WHERE argument_id = $1 AND individual_id = $2", [argument_id, individual_id]);
  if (!argResp) return res.status(404).json({ error: "Response record not found" });
  if (argResp.completed) return res.status(400).json({ error: "Already submitted" });

  const members = await db.getAll("SELECT * FROM individuals WHERE couple_id = $1", [individual.couple_id]);
  const partner  = members.find(m => m.id !== individual_id);
  const history  = JSON.parse(argResp.messages || "[]");
  const isStart  = message.trim() === "__START__";
  const messagesToSend = isStart ? [{ role: "user", content: "Please begin." }] : [...history, { role: "user", content: message.trim() }];
  if (!isStart) history.push({ role: "user", content: message.trim() });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";
  try {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6", max_tokens: 1024,
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
    await db.run("UPDATE argument_responses SET messages = $1 WHERE argument_id = $2 AND individual_id = $3", [JSON.stringify(history), argument_id, individual_id]);
    res.write("data: [DONE]\n\n");
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally { res.end(); }
});

app.post("/api/argue/submit", async (req, res) => {
  const { argument_id, individual_id } = req.body;

  const individual = await db.getOne("SELECT * FROM individuals WHERE id = $1", [individual_id]);
  if (!individual) return res.status(404).json({ error: "Not found" });

  const argResp = await db.getOne("SELECT * FROM argument_responses WHERE argument_id = $1 AND individual_id = $2", [argument_id, individual_id]);
  if (!argResp) return res.status(404).json({ error: "Response not found" });
  if (argResp.completed) return res.status(400).json({ error: "Already submitted" });

  const messages = JSON.parse(argResp.messages || "[]");
  let extracted = { snap_s: "", snap_n: "", snap_a: "", snap_p: "", ownership_level: "unclear" };
  try {
    const raw = await anthropic.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 1024,
      messages: [{ role: "user", content: buildSnapExtractionPrompt(individual.name, messagesToText(messages)) }]
    });
    extracted = JSON.parse(raw.content[0].text.replace(/^```json\n?|```$/gm, "").trim());
  } catch (err) { console.error("SNAP extraction error:", err.message); }

  await db.run(
    "UPDATE argument_responses SET snap_s=$1,snap_n=$2,snap_a=$3,snap_p=$4,ownership_level=$5,completed=1,submitted_at=NOW() WHERE argument_id=$6 AND individual_id=$7",
    [extracted.snap_s, extracted.snap_n, extracted.snap_a, extracted.snap_p, extracted.ownership_level, argument_id, individual_id]
  );

  const allResponses = await db.getAll("SELECT * FROM argument_responses WHERE argument_id = $1", [argument_id]);
  const bothComplete  = allResponses.length === 2 && allResponses.every(r => r.completed);
  if (!bothComplete) return res.json({ state: "waiting" });

  await db.run("UPDATE arguments SET status = 'synthesis_pending' WHERE id = $1", [argument_id]);
  try {
    const [r1, r2] = allResponses;
    const p1 = await db.getOne("SELECT * FROM individuals WHERE id = $1", [r1.individual_id]);
    const p2 = await db.getOne("SELECT * FROM individuals WHERE id = $1", [r2.individual_id]);

    const synthRaw = await anthropic.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 3000,
      messages: [{ role: "user", content: buildArgumentSynthesisPrompt(
        p1.name, { snap_s: r1.snap_s, snap_n: r1.snap_n, snap_a: r1.snap_a, snap_p: r1.snap_p, ownership_level: r1.ownership_level },
        p2.name, { snap_s: r2.snap_s, snap_n: r2.snap_n, snap_a: r2.snap_a, snap_p: r2.snap_p, ownership_level: r2.ownership_level }
      )}]
    });
    const synthesis = JSON.parse(synthRaw.content[0].text.replace(/^```json\n?|```$/gm, "").trim());
    await db.run("INSERT INTO argument_synthesis (argument_id, couple_view, counselor_view) VALUES ($1,$2,$3)", [argument_id, JSON.stringify(synthesis.couple_view), JSON.stringify(synthesis.counselor_view)]);
    await db.run("UPDATE arguments SET status = 'complete' WHERE id = $1", [argument_id]);
    return res.json({ state: "synthesis", couple_view: synthesis.couple_view });
  } catch (err) {
    await db.run("UPDATE arguments SET status = 'open' WHERE id = $1", [argument_id]);
    return res.status(500).json({ error: "Synthesis failed: " + err.message });
  }
});

app.get("/api/argue/:argument_id/counselor", async (req, res) => {
  const synthesis = await db.getOne("SELECT * FROM argument_synthesis WHERE argument_id = $1", [req.params.argument_id]);
  if (!synthesis) return res.status(404).json({ error: "No synthesis found" });

  const allResponses = await db.getAll("SELECT * FROM argument_responses WHERE argument_id = $1", [req.params.argument_id]);
  const enriched = await Promise.all(allResponses.map(async r => {
    const person = await db.getOne("SELECT name FROM individuals WHERE id = $1", [r.individual_id]);
    return { name: person.name, snap_s: r.snap_s, snap_n: r.snap_n, snap_a: r.snap_a, snap_p: r.snap_p, ownership_level: r.ownership_level };
  }));

  res.json({ argument_id: req.params.argument_id, counselor_view: JSON.parse(synthesis.counselor_view), responses: enriched, generated_at: synthesis.generated_at });
});

// ─── Season ───────────────────────────────────────────────────────────────────

app.get("/api/couple/:id/season", async (req, res) => {
  const row = await db.getOne("SELECT season_track, season_current, season_next, season_progress, season_updated FROM couples WHERE id = $1", [req.params.id]);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json({ season_track: row.season_track || "standard", season_current: row.season_current || null, season_next: row.season_next || null, season_progress: row.season_progress || 0.0, season_updated: row.season_updated || null });
});

app.post("/api/couple/:id/season", async (req, res) => {
  const { season_track, season_current, season_next, season_progress } = req.body;
  await db.run(
    "UPDATE couples SET season_track=$1, season_current=$2, season_next=$3, season_progress=$4, season_updated=NOW() WHERE id=$5",
    [season_track || "standard", season_current || null, season_next || null, season_progress || 0.0, req.params.id]
  );
  res.json({ success: true });
});

app.post("/api/couple/:id/season/infer", async (req, res) => {
  const couple  = await db.getOne("SELECT * FROM couples WHERE id = $1", [req.params.id]);
  if (!couple) return res.status(404).json({ error: "Not found" });

  const members = await db.getAll("SELECT * FROM individuals WHERE couple_id = $1", [req.params.id]);
  const [p1, p2] = members;
  const profile  = (ind) => ind ? { dimensions: JSON.parse(ind.dimensions || "{}"), summaries: JSON.parse(ind.domain_summaries || "{}") } : {};

  try {
    const raw = await anthropic.messages.create({
      model: "claude-sonnet-4-6", max_tokens: 512,
      messages: [{ role: "user", content: buildSeasonInferencePrompt(p1?.name || "Partner 1", p2?.name || "Partner 2", profile(p1), profile(p2), couple.season_track || "standard") }]
    });
    res.json(JSON.parse(raw.content[0].text.replace(/^```json\n?|```$/gm, "").trim()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Insight ──────────────────────────────────────────────────────────────────

app.post("/api/insight/deepen", async (req, res) => {
  const { individual_id, insight, user_response, domain_index } = req.body;
  const individual = await db.getOne("SELECT * FROM individuals WHERE id = $1", [individual_id]);
  if (!individual) return res.status(404).json({ error: "Individual not found" });

  const domain = DOMAINS[domain_index] || { name: "this topic" };
  const prompt = `You are a perceptive relationship psychologist analyzing a moment from a discovery conversation with ${individual.name}.

Domain: ${domain.name}
What ${individual.name} said: "${user_response}"
Seven's observation: "${insight}"

Provide a warm, specific, forward-looking analysis (3–4 paragraphs):
1. What behavioral patterns this suggests about ${individual.name}
2. How this might show up as a strength and a challenge across the seasons of marriage
3. One thing to lean into, one thing to stay aware of`;

  try {
    const response = await anthropic.messages.create({ model: "claude-sonnet-4-6", max_tokens: 1024, messages: [{ role: "user", content: prompt }] });
    res.json({ analysis: response.content[0].text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Timeline ──────────────────────────────────────────────────────────────────

app.get("/api/couple/:id/timeline", async (req, res) => {
  const entries = await db.getAll("SELECT * FROM timeline_entries WHERE couple_id = $1 ORDER BY entry_date DESC", [req.params.id]);
  res.json(entries);
});

app.post("/api/couple/:id/timeline", async (req, res) => {
  const { entry_type, title, description, entry_date } = req.body;
  if (!title || !entry_date || !entry_type) return res.status(400).json({ error: "entry_type, title, and entry_date required." });
  const result = await db.run(
    "INSERT INTO timeline_entries (couple_id, entry_type, title, description, entry_date) VALUES ($1,$2,$3,$4,$5) RETURNING id",
    [req.params.id, entry_type, title.trim(), description?.trim() || "", entry_date]
  );
  res.json({ id: result.rows[0].id, success: true });
});

app.delete("/api/couple/:id/timeline/:entry_id", async (req, res) => {
  await db.run("DELETE FROM timeline_entries WHERE id = $1 AND couple_id = $2", [req.params.entry_id, req.params.id]);
  res.json({ success: true });
});

// ─── Premarital Sessions ──────────────────────────────────────────────────────

app.get("/api/premarital/:couple_id/ready", async (req, res) => {
  const couple  = await db.getOne("SELECT * FROM couples WHERE id = $1", [req.params.couple_id]);
  if (!couple) return res.status(404).json({ error: "Not found" });

  const members = await db.getAll("SELECT * FROM individuals WHERE couple_id = $1", [req.params.couple_id]);
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

app.get("/api/premarital/:couple_id/progress", async (req, res) => {
  const rows = await db.getAll("SELECT session_num, completed FROM premarital_sessions WHERE couple_id = $1", [req.params.couple_id]);
  const completed = {};
  rows.forEach(r => { completed[r.session_num] = !!r.completed; });
  const sessions = PREMARITAL_SESSIONS.map(s => ({ num: s.num, title: s.title, completed: !!completed[s.num] }));
  res.json({ sessions, completed_count: rows.filter(r => r.completed).length });
});

app.get("/api/premarital/:couple_id/session/:num", async (req, res) => {
  const row = await db.getOne("SELECT * FROM premarital_sessions WHERE couple_id = $1 AND session_num = $2", [req.params.couple_id, parseInt(req.params.num)]);
  if (!row) return res.json({ messages: [], completed: false });
  res.json({ messages: JSON.parse(row.messages || "[]"), completed: !!row.completed });
});

app.post("/api/premarital/message", async (req, res) => {
  const { couple_id, session_num, message } = req.body;
  if (!couple_id || !session_num || !message?.trim()) return res.status(400).json({ error: "couple_id, session_num, message required." });

  const members = await db.getAll("SELECT * FROM individuals WHERE couple_id = $1", [couple_id]);
  const [p1, p2] = members;
  const row     = await db.getOne("SELECT * FROM premarital_sessions WHERE couple_id = $1 AND session_num = $2", [couple_id, parseInt(session_num)]);
  const history  = row ? JSON.parse(row.messages || "[]") : [];
  const isStart  = message.trim() === "__START__";
  const messagesToSend = isStart ? [{ role: "user", content: "Please begin." }] : [...history, { role: "user", content: message.trim() }];
  if (!isStart) history.push({ role: "user", content: message.trim() });

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";
  try {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-6", max_tokens: 1200,
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
    await db.run(
      `INSERT INTO premarital_sessions (couple_id, session_num, messages) VALUES ($1,$2,$3)
       ON CONFLICT(couple_id, session_num) DO UPDATE SET messages = EXCLUDED.messages`,
      [couple_id, parseInt(session_num), JSON.stringify(history)]
    );
    res.write("data: [DONE]\n\n");
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally { res.end(); }
});

app.post("/api/premarital/complete", async (req, res) => {
  const { couple_id, session_num } = req.body;
  await db.run("UPDATE premarital_sessions SET completed = 1, completed_at = NOW() WHERE couple_id = $1 AND session_num = $2", [couple_id, parseInt(session_num)]);
  res.json({ success: true });
});

// ─── Shared Insights ──────────────────────────────────────────────────────────

app.post("/api/insights/share", async (req, res) => {
  const { individual_id, insight_text, domain_index, season_tags } = req.body;
  if (!individual_id || !insight_text?.trim()) return res.status(400).json({ error: "individual_id and insight_text required" });

  const individual = await db.getOne("SELECT * FROM individuals WHERE id = $1", [individual_id]);
  if (!individual) return res.status(404).json({ error: "Individual not found" });

  const id = generateId();
  await db.run(
    "INSERT INTO shared_insights (id, couple_id, shared_by, domain_index, insight_text, season_tags) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, individual.couple_id, individual_id, domain_index ?? null, insight_text.trim(), JSON.stringify(season_tags || [])]
  );
  res.json({ id, success: true });
});

app.get("/api/insights/:couple_id", async (req, res) => {
  const viewer_id = req.query.viewer_id;
  const rows = await db.getAll(
    `SELECT si.*, i.name as shared_by_name FROM shared_insights si
     JOIN individuals i ON si.shared_by = i.id
     WHERE si.couple_id = $1 ORDER BY si.shared_at DESC`,
    [req.params.couple_id]
  );
  res.json(rows.map(r => ({
    id: r.id, shared_by: r.shared_by, shared_by_name: r.shared_by_name,
    domain_index: r.domain_index, domain_name: r.domain_index != null ? (DOMAINS[r.domain_index]?.name || null) : null,
    insight_text: r.insight_text, season_tags: JSON.parse(r.season_tags || "[]"),
    discussion_status: r.discussion_status, coffee_date: r.coffee_date,
    shared_at: r.shared_at, read_at: r.read_at, is_mine: r.shared_by === viewer_id
  })));
});

app.post("/api/insights/:id/read",    async (req, res) => { await db.run("UPDATE shared_insights SET discussion_status='read', read_at=NOW() WHERE id=$1 AND discussion_status='shared'", [req.params.id]); res.json({ success: true }); });
app.post("/api/insights/:id/discuss", async (req, res) => { await db.run("UPDATE shared_insights SET discussion_status='discussion_requested' WHERE id=$1", [req.params.id]); res.json({ success: true }); });
app.post("/api/insights/:id/coffee",  async (req, res) => {
  const { coffee_date } = req.body;
  if (!coffee_date?.trim()) return res.status(400).json({ error: "coffee_date required" });
  await db.run("UPDATE shared_insights SET discussion_status='scheduled', coffee_date=$1 WHERE id=$2", [coffee_date.trim(), req.params.id]);
  res.json({ success: true });
});

// ─── Start ────────────────────────────────────────────────────────────────────

db.initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`7 Seasons running at http://localhost:${PORT}`);
      if (!process.env.ANTHROPIC_API_KEY) console.warn("WARNING: ANTHROPIC_API_KEY not set");
    });
  })
  .catch(err => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
