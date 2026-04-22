// db.js - SQLite database layer (v3: multi-hackathon + judge-team assignments)
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'app.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA foreign_keys = ON;`);
db.exec(`PRAGMA journal_mode = WAL;`);

// ============ SCHEMA ============
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'judge')),
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hackathons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hackathon_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'rubric' CHECK (kind IN ('rubric', 'simple')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (hackathon_id) REFERENCES hackathons(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    order_num INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS criteria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    section_id INTEGER,
    label TEXT NOT NULL,
    description TEXT,
    weight REAL NOT NULL DEFAULT 1.0,
    max_points INTEGER NOT NULL DEFAULT 10,
    order_num INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
    FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rubric_levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    criterion_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    description TEXT,
    min_points INTEGER NOT NULL,
    max_points INTEGER NOT NULL,
    order_num INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (criterion_id) REFERENCES criteria(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hackathon_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (hackathon_id) REFERENCES hackathons(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS phases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hackathon_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    order_num INTEGER NOT NULL DEFAULT 0,
    template_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (hackathon_id) REFERENCES hackathons(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS team_phases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    phase_id INTEGER NOT NULL,
    UNIQUE (team_id, phase_id),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (phase_id) REFERENCES phases(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS judge_hackathons (
    judge_id INTEGER NOT NULL,
    hackathon_id INTEGER NOT NULL,
    PRIMARY KEY (judge_id, hackathon_id),
    FOREIGN KEY (judge_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (hackathon_id) REFERENCES hackathons(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS judge_team_assignments (
    judge_id INTEGER NOT NULL,
    hackathon_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    PRIMARY KEY (judge_id, hackathon_id, team_id),
    FOREIGN KEY (judge_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (hackathon_id) REFERENCES hackathons(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS hackathon_state (
    hackathon_id INTEGER PRIMARY KEY,
    active_team_id INTEGER,
    active_phase_id INTEGER,
    FOREIGN KEY (hackathon_id) REFERENCES hackathons(id) ON DELETE CASCADE,
    FOREIGN KEY (active_team_id) REFERENCES teams(id) ON DELETE SET NULL,
    FOREIGN KEY (active_phase_id) REFERENCES phases(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS evaluations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    judge_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    phase_id INTEGER NOT NULL,
    template_id INTEGER NOT NULL,
    submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (judge_id, team_id, phase_id),
    FOREIGN KEY (judge_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (phase_id) REFERENCES phases(id) ON DELETE CASCADE,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    evaluation_id INTEGER NOT NULL,
    criterion_id INTEGER NOT NULL,
    level_id INTEGER,
    value INTEGER NOT NULL,
    note TEXT,
    UNIQUE (evaluation_id, criterion_id),
    FOREIGN KEY (evaluation_id) REFERENCES evaluations(id) ON DELETE CASCADE,
    FOREIGN KEY (criterion_id) REFERENCES criteria(id) ON DELETE CASCADE,
    FOREIGN KEY (level_id) REFERENCES rubric_levels(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_teams_hackathon ON teams(hackathon_id);
  CREATE INDEX IF NOT EXISTS idx_phases_hackathon ON phases(hackathon_id);
  CREATE INDEX IF NOT EXISTS idx_templates_hackathon ON templates(hackathon_id);
  CREATE INDEX IF NOT EXISTS idx_jh_judge ON judge_hackathons(judge_id);
  CREATE INDEX IF NOT EXISTS idx_jta_judge_hack ON judge_team_assignments(judge_id, hackathon_id);

  -- v4: panels (groups of judges) + self-paced phases
  CREATE TABLE IF NOT EXISTS panels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hackathon_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (hackathon_id) REFERENCES hackathons(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS panel_teams (
    panel_id INTEGER NOT NULL,
    team_id INTEGER NOT NULL,
    PRIMARY KEY (panel_id, team_id),
    FOREIGN KEY (panel_id) REFERENCES panels(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS panel_judges (
    panel_id INTEGER NOT NULL,
    judge_id INTEGER NOT NULL,
    PRIMARY KEY (panel_id, judge_id),
    FOREIGN KEY (panel_id) REFERENCES panels(id) ON DELETE CASCADE,
    FOREIGN KEY (judge_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_panels_hackathon ON panels(hackathon_id);
  CREATE INDEX IF NOT EXISTS idx_panel_judges_judge ON panel_judges(judge_id);
`);

// v4: add self_paced to phases if missing (migration for existing DBs)
const phaseCols = db.prepare(`PRAGMA table_info(phases)`).all().map(r => r.name);
if (!phaseCols.includes('self_paced')) {
  db.exec(`ALTER TABLE phases ADD COLUMN self_paced INTEGER NOT NULL DEFAULT 0`);
}

// ============ SEED ADMIN ============
const adminExists = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
if (!adminExists) {
  const defaultUser = process.env.ADMIN_USERNAME || 'admin';
  const defaultPass = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = bcrypt.hashSync(defaultPass, 10);
  db.prepare(
    `INSERT INTO users (username, password_hash, role, name) VALUES (?, ?, 'admin', ?)`
  ).run(defaultUser, hash, 'Administrator');
  console.log(`\n🔑 Default admin created: username="${defaultUser}", password="${defaultPass}"\n`);
}

// ============ USERS ============
export function findUserByUsername(username) {
  return db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
}
export function findUserById(id) {
  return db.prepare(`SELECT id, username, role, name FROM users WHERE id = ?`).get(id);
}
export function createJudge({ username, password, name }) {
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(`INSERT INTO users (username, password_hash, role, name) VALUES (?, ?, 'judge', ?)`)
    .run(username, hash, name);
  return { id: info.lastInsertRowid, username, name, role: 'judge' };
}
export function listJudges() {
  const judges = db
    .prepare(`SELECT id, username, name, created_at FROM users WHERE role = 'judge' ORDER BY created_at DESC`)
    .all();
  for (const j of judges) {
    j.hackathonIds = db
      .prepare(`SELECT hackathon_id FROM judge_hackathons WHERE judge_id = ? ORDER BY hackathon_id`)
      .all(j.id).map(r => r.hackathon_id);
  }
  return judges;
}
export function deleteUser(id) {
  return db.prepare(`DELETE FROM users WHERE id = ? AND role = 'judge'`).run(id);
}
export function updateUserPassword(id, newPassword) {
  const hash = bcrypt.hashSync(newPassword, 10);
  return db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(hash, id);
}

// ============ HACKATHONS ============
export function createHackathon({ name, description }) {
  const info = db
    .prepare(`INSERT INTO hackathons (name, description) VALUES (?, ?)`)
    .run(name, description || null);
  db.prepare(
    `INSERT OR IGNORE INTO hackathon_state (hackathon_id, active_team_id, active_phase_id) VALUES (?, NULL, NULL)`
  ).run(info.lastInsertRowid);
  return getHackathon(info.lastInsertRowid);
}
export function getHackathon(id) {
  return db.prepare(`SELECT * FROM hackathons WHERE id = ?`).get(id);
}
export function listHackathons({ includeArchived = false } = {}) {
  return includeArchived
    ? db.prepare(`SELECT * FROM hackathons ORDER BY archived ASC, created_at DESC`).all()
    : db.prepare(`SELECT * FROM hackathons WHERE archived = 0 ORDER BY created_at DESC`).all();
}
export function updateHackathon(id, { name, description, archived }) {
  const cur = getHackathon(id);
  if (!cur) return null;
  db.prepare(`UPDATE hackathons SET name = ?, description = ?, archived = ? WHERE id = ?`).run(
    name ?? cur.name,
    description !== undefined ? description : cur.description,
    archived !== undefined ? (archived ? 1 : 0) : cur.archived,
    id
  );
  return getHackathon(id);
}
export function deleteHackathon(id) {
  return db.prepare(`DELETE FROM hackathons WHERE id = ?`).run(id);
}

// ============ JUDGE ↔ HACKATHON MEMBERSHIPS ============
export function setJudgeHackathons(judgeId, hackathonIds) {
  db.prepare('BEGIN').run();
  try {
    db.prepare(`DELETE FROM judge_hackathons WHERE judge_id = ?`).run(judgeId);
    const ins = db.prepare(`INSERT OR IGNORE INTO judge_hackathons (judge_id, hackathon_id) VALUES (?, ?)`);
    for (const hid of hackathonIds) ins.run(judgeId, hid);
    db.prepare(
      `DELETE FROM judge_team_assignments WHERE judge_id = ?
       AND hackathon_id NOT IN (SELECT hackathon_id FROM judge_hackathons WHERE judge_id = ?)`
    ).run(judgeId, judgeId);
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
}
export function listJudgeHackathons(judgeId) {
  return db
    .prepare(
      `SELECT h.* FROM hackathons h
       JOIN judge_hackathons jh ON jh.hackathon_id = h.id
       WHERE jh.judge_id = ? AND h.archived = 0
       ORDER BY h.created_at DESC`
    )
    .all(judgeId);
}
export function judgeIsInHackathon(judgeId, hackathonId) {
  return !!db
    .prepare(`SELECT 1 FROM judge_hackathons WHERE judge_id = ? AND hackathon_id = ?`)
    .get(judgeId, hackathonId);
}

// ============ JUDGE ↔ TEAM ASSIGNMENTS ============
export function setJudgeTeamAssignments(judgeId, hackathonId, teamIds) {
  db.prepare('BEGIN').run();
  try {
    db.prepare(`DELETE FROM judge_team_assignments WHERE judge_id = ? AND hackathon_id = ?`)
      .run(judgeId, hackathonId);
    if (teamIds && teamIds.length > 0) {
      const ins = db.prepare(
        `INSERT OR IGNORE INTO judge_team_assignments (judge_id, hackathon_id, team_id) VALUES (?, ?, ?)`
      );
      for (const tid of teamIds) ins.run(judgeId, hackathonId, tid);
    }
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
}
export function getJudgeTeamAssignments(judgeId, hackathonId) {
  return db
    .prepare(`SELECT team_id FROM judge_team_assignments WHERE judge_id = ? AND hackathon_id = ?`)
    .all(judgeId, hackathonId).map(r => r.team_id);
}
export function judgeCanEvaluate(judgeId, hackathonId, teamId) {
  if (!judgeIsInHackathon(judgeId, hackathonId)) return false;

  // Check if judge has ANY restrictions (individual assignments OR panel memberships)
  const hasIndividual = db
    .prepare(`SELECT 1 FROM judge_team_assignments WHERE judge_id = ? AND hackathon_id = ? LIMIT 1`)
    .get(judgeId, hackathonId);
  const inPanels = db
    .prepare(
      `SELECT 1 FROM panel_judges pj
       JOIN panels p ON p.id = pj.panel_id
       WHERE pj.judge_id = ? AND p.hackathon_id = ? LIMIT 1`
    )
    .get(judgeId, hackathonId);

  // No restrictions at all → sees all teams
  if (!hasIndividual && !inPanels) return true;

  // Check individual assignment
  const individualMatch = db
    .prepare(
      `SELECT 1 FROM judge_team_assignments
       WHERE judge_id = ? AND hackathon_id = ? AND team_id = ?`
    )
    .get(judgeId, hackathonId, teamId);
  if (individualMatch) return true;

  // Check panel-based assignment
  const panelMatch = db
    .prepare(
      `SELECT 1 FROM panel_judges pj
       JOIN panels p ON p.id = pj.panel_id
       JOIN panel_teams pt ON pt.panel_id = p.id
       WHERE pj.judge_id = ? AND p.hackathon_id = ? AND pt.team_id = ?
       LIMIT 1`
    )
    .get(judgeId, hackathonId, teamId);
  return !!panelMatch;
}

// Get ALL teams a judge is allowed to evaluate in a given hackathon
// (union of individual assignments + panel assignments; if no restrictions, returns all teams)
export function listJudgeAllowedTeamIds(judgeId, hackathonId) {
  if (!judgeIsInHackathon(judgeId, hackathonId)) return [];

  const hasIndividual = db
    .prepare(`SELECT 1 FROM judge_team_assignments WHERE judge_id = ? AND hackathon_id = ? LIMIT 1`)
    .get(judgeId, hackathonId);
  const inPanels = db
    .prepare(
      `SELECT 1 FROM panel_judges pj
       JOIN panels p ON p.id = pj.panel_id
       WHERE pj.judge_id = ? AND p.hackathon_id = ? LIMIT 1`
    )
    .get(judgeId, hackathonId);

  if (!hasIndividual && !inPanels) {
    // No restrictions → all teams in the hackathon
    return db
      .prepare(`SELECT id FROM teams WHERE hackathon_id = ? ORDER BY id`)
      .all(hackathonId).map(r => r.id);
  }

  const rows = db
    .prepare(
      `SELECT DISTINCT team_id FROM (
         SELECT team_id FROM judge_team_assignments
         WHERE judge_id = ? AND hackathon_id = ?
         UNION
         SELECT pt.team_id FROM panel_judges pj
         JOIN panels p ON p.id = pj.panel_id
         JOIN panel_teams pt ON pt.panel_id = p.id
         WHERE pj.judge_id = ? AND p.hackathon_id = ?
       ) ORDER BY team_id`
    )
    .all(judgeId, hackathonId, judgeId, hackathonId);
  return rows.map(r => r.team_id);
}
export function autoSplitAssignments(hackathonId, overlap = 3) {
  const judges = db
    .prepare(
      `SELECT u.id FROM users u
       JOIN judge_hackathons jh ON jh.judge_id = u.id
       WHERE jh.hackathon_id = ? AND u.role = 'judge'
       ORDER BY u.id`
    )
    .all(hackathonId).map(r => r.id);
  const teams = db
    .prepare(`SELECT id FROM teams WHERE hackathon_id = ? ORDER BY id`)
    .all(hackathonId).map(r => r.id);

  if (judges.length === 0 || teams.length === 0) return {};
  const actualOverlap = Math.max(1, Math.min(overlap, judges.length));
  const assign = Object.fromEntries(judges.map(j => [j, []]));
  let cursor = 0;
  for (const tid of teams) {
    for (let k = 0; k < actualOverlap; k++) {
      const jid = judges[(cursor + k) % judges.length];
      assign[jid].push(tid);
    }
    cursor = (cursor + actualOverlap) % judges.length;
  }

  db.prepare('BEGIN').run();
  try {
    for (const jid of judges) {
      db.prepare(`DELETE FROM judge_team_assignments WHERE judge_id = ? AND hackathon_id = ?`)
        .run(jid, hackathonId);
    }
    const ins = db.prepare(
      `INSERT OR IGNORE INTO judge_team_assignments (judge_id, hackathon_id, team_id) VALUES (?, ?, ?)`
    );
    for (const jid of judges) {
      for (const tid of assign[jid]) ins.run(jid, hackathonId, tid);
    }
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
  return assign;
}

// ============ TEMPLATES (scoped to hackathon) ============
export function createTemplate({ hackathonId, name, kind = 'rubric', sections = [] }) {
  db.prepare('BEGIN').run();
  try {
    const info = db
      .prepare(`INSERT INTO templates (hackathon_id, name, kind) VALUES (?, ?, ?)`)
      .run(hackathonId, name, kind);
    const tplId = info.lastInsertRowid;

    const insSection = db.prepare(`INSERT INTO sections (template_id, name, order_num) VALUES (?, ?, ?)`);
    const insCrit = db.prepare(
      `INSERT INTO criteria (template_id, section_id, label, description, weight, max_points, order_num)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const insLevel = db.prepare(
      `INSERT INTO rubric_levels (criterion_id, label, description, min_points, max_points, order_num)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    sections.forEach((sec, si) => {
      const secInfo = insSection.run(tplId, sec.name, si);
      const secId = secInfo.lastInsertRowid;
      (sec.criteria || []).forEach((c, ci) => {
        const maxPoints = Number(c.maxPoints) || computeMaxFromLevels(c.levels);
        const cInfo = insCrit.run(
          tplId, secId, c.label, c.description || null,
          Number(c.weight) || 1, maxPoints, ci
        );
        const cId = cInfo.lastInsertRowid;
        (c.levels || []).forEach((lv, li) => {
          insLevel.run(cId, lv.label, lv.description || null, lv.minPoints, lv.maxPoints, li);
        });
      });
    });
    db.prepare('COMMIT').run();
    return getTemplate(tplId);
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
}
function computeMaxFromLevels(levels = []) {
  if (!levels.length) return 10;
  return Math.max(...levels.map((l) => Number(l.maxPoints) || 0));
}
export function getTemplate(id) {
  const tpl = db.prepare(`SELECT * FROM templates WHERE id = ?`).get(id);
  if (!tpl) return null;
  const sections = db
    .prepare(`SELECT * FROM sections WHERE template_id = ? ORDER BY order_num ASC`)
    .all(id);
  const allCrits = db
    .prepare(`SELECT * FROM criteria WHERE template_id = ? ORDER BY order_num ASC`)
    .all(id);
  const allLevels = allCrits.length
    ? db.prepare(
        `SELECT * FROM rubric_levels WHERE criterion_id IN (${allCrits.map(() => '?').join(',')}) ORDER BY order_num ASC`
      ).all(...allCrits.map((c) => c.id))
    : [];
  const levelsByCrit = {};
  for (const lv of allLevels) (levelsByCrit[lv.criterion_id] ||= []).push(lv);
  for (const c of allCrits) c.levels = levelsByCrit[c.id] || [];

  if (sections.length > 0) {
    const critsBySec = {};
    for (const c of allCrits) (critsBySec[c.section_id] ||= []).push(c);
    for (const s of sections) s.criteria = critsBySec[s.id] || [];
    tpl.sections = sections;
  } else {
    tpl.sections = allCrits.length ? [{ id: null, name: '', order_num: 0, criteria: allCrits }] : [];
  }
  tpl.criteria = allCrits;
  tpl.totalMaxPoints = allCrits.reduce((s, c) => s + (c.max_points || 0), 0);
  return tpl;
}
export function listTemplates(hackathonId) {
  const tpls = db
    .prepare(`SELECT * FROM templates WHERE hackathon_id = ? ORDER BY created_at DESC`)
    .all(hackathonId);
  return tpls.map((t) => getTemplate(t.id));
}
export function deleteTemplate(id) {
  return db.prepare(`DELETE FROM templates WHERE id = ?`).run(id);
}

// ============ TEAMS ============
export function createTeam({ hackathonId, name, description }) {
  const info = db
    .prepare(`INSERT INTO teams (hackathon_id, name, description) VALUES (?, ?, ?)`)
    .run(hackathonId, name, description || null);
  const firstPhase = db
    .prepare(`SELECT id FROM phases WHERE hackathon_id = ? ORDER BY order_num ASC LIMIT 1`)
    .get(hackathonId);
  if (firstPhase) {
    db.prepare(`INSERT OR IGNORE INTO team_phases (team_id, phase_id) VALUES (?, ?)`).run(
      info.lastInsertRowid, firstPhase.id
    );
  }
  return { id: info.lastInsertRowid, hackathon_id: hackathonId, name, description: description || null };
}
export function listTeams(hackathonId) {
  return db
    .prepare(`SELECT * FROM teams WHERE hackathon_id = ? ORDER BY created_at ASC`)
    .all(hackathonId);
}
export function getTeam(id) {
  return db.prepare(`SELECT * FROM teams WHERE id = ?`).get(id);
}
export function deleteTeam(id) {
  return db.prepare(`DELETE FROM teams WHERE id = ?`).run(id);
}

// ============ PHASES ============
export function createPhase({ hackathonId, name, templateId, selfPaced }) {
  const maxOrder = db
    .prepare(`SELECT COALESCE(MAX(order_num), -1) AS m FROM phases WHERE hackathon_id = ?`)
    .get(hackathonId).m;
  const info = db
    .prepare(`INSERT INTO phases (hackathon_id, name, order_num, template_id, self_paced) VALUES (?, ?, ?, ?, ?)`)
    .run(hackathonId, name, maxOrder + 1, templateId || null, selfPaced ? 1 : 0);
  if (maxOrder === -1) {
    const teams = listTeams(hackathonId);
    for (const t of teams) {
      db.prepare(`INSERT OR IGNORE INTO team_phases (team_id, phase_id) VALUES (?, ?)`).run(
        t.id, info.lastInsertRowid
      );
    }
  }
  return getPhase(info.lastInsertRowid);
}
export function listPhases(hackathonId) {
  const phases = db
    .prepare(`SELECT * FROM phases WHERE hackathon_id = ? ORDER BY order_num ASC`)
    .all(hackathonId);
  for (const p of phases) {
    p.teamIds = db
      .prepare(`SELECT team_id FROM team_phases WHERE phase_id = ? ORDER BY team_id`)
      .all(p.id).map((r) => r.team_id);
  }
  return phases;
}
export function getPhase(id) {
  const p = db.prepare(`SELECT * FROM phases WHERE id = ?`).get(id);
  if (!p) return null;
  p.teamIds = db
    .prepare(`SELECT team_id FROM team_phases WHERE phase_id = ? ORDER BY team_id`)
    .all(id).map((r) => r.team_id);
  return p;
}
export function updatePhase(id, { name, templateId, selfPaced }) {
  const cur = db.prepare(`SELECT * FROM phases WHERE id = ?`).get(id);
  if (!cur) return null;
  db.prepare(`UPDATE phases SET name = ?, template_id = ?, self_paced = ? WHERE id = ?`).run(
    name ?? cur.name,
    templateId === undefined ? cur.template_id : templateId,
    selfPaced === undefined ? cur.self_paced : (selfPaced ? 1 : 0),
    id
  );
  return getPhase(id);
}
export function deletePhase(id) {
  return db.prepare(`DELETE FROM phases WHERE id = ?`).run(id);
}
export function setPhaseTeams(phaseId, teamIds) {
  db.prepare('BEGIN').run();
  try {
    db.prepare(`DELETE FROM team_phases WHERE phase_id = ?`).run(phaseId);
    const ins = db.prepare(`INSERT OR IGNORE INTO team_phases (team_id, phase_id) VALUES (?, ?)`);
    for (const tid of teamIds) ins.run(tid, phaseId);
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
  return getPhase(phaseId);
}
export function resolvePhaseTemplateId(phaseId) {
  const phase = db.prepare(`SELECT * FROM phases WHERE id = ?`).get(phaseId);
  if (!phase) return null;
  if (phase.template_id) return phase.template_id;
  const earlier = db
    .prepare(
      `SELECT template_id FROM phases WHERE hackathon_id = ? AND order_num < ? AND template_id IS NOT NULL
       ORDER BY order_num DESC LIMIT 1`
    ).get(phase.hackathon_id, phase.order_num);
  return earlier ? earlier.template_id : null;
}

// ============ HACKATHON STATE ============
export function getHackathonState(hackathonId) {
  let s = db.prepare(`SELECT * FROM hackathon_state WHERE hackathon_id = ?`).get(hackathonId);
  if (!s) {
    db.prepare(
      `INSERT OR IGNORE INTO hackathon_state (hackathon_id, active_team_id, active_phase_id) VALUES (?, NULL, NULL)`
    ).run(hackathonId);
    s = db.prepare(`SELECT * FROM hackathon_state WHERE hackathon_id = ?`).get(hackathonId);
  }
  return s;
}
export function setHackathonActive(hackathonId, { teamId, phaseId }) {
  // Ensure row exists
  getHackathonState(hackathonId);
  db.prepare(
    `UPDATE hackathon_state SET active_team_id = ?, active_phase_id = ? WHERE hackathon_id = ?`
  ).run(teamId ?? null, phaseId ?? null, hackathonId);
  return getHackathonState(hackathonId);
}
export function getHackathonIdForPhase(phaseId) {
  const p = db.prepare(`SELECT hackathon_id FROM phases WHERE id = ?`).get(phaseId);
  return p ? p.hackathon_id : null;
}

// ============ EVALUATIONS ============
export function getEvaluation(judgeId, teamId, phaseId) {
  const ev = db
    .prepare(`SELECT * FROM evaluations WHERE judge_id = ? AND team_id = ? AND phase_id = ?`)
    .get(judgeId, teamId, phaseId);
  if (!ev) return null;
  ev.scores = db.prepare(`SELECT * FROM scores WHERE evaluation_id = ?`).all(ev.id);
  return ev;
}
export function submitEvaluation({ judgeId, teamId, phaseId, scores }) {
  const templateId = resolvePhaseTemplateId(phaseId);
  if (!templateId) throw new Error('No template resolved for this phase');
  const template = getTemplate(templateId);
  const critById = new Map(template.criteria.map((c) => [c.id, c]));

  for (const s of scores) {
    const c = critById.get(s.criterionId);
    if (!c) throw new Error(`Unknown criterion ${s.criterionId}`);
    if (!Number.isInteger(s.value)) throw new Error(`Score for "${c.label}" must be an integer`);
    let minAllowed = 0, maxAllowed = c.max_points;
    if (c.levels && c.levels.length) {
      minAllowed = Math.min(...c.levels.map((l) => l.min_points));
      maxAllowed = Math.max(...c.levels.map((l) => l.max_points));
    }
    if (s.value < minAllowed || s.value > maxAllowed) {
      throw new Error(`Score for "${c.label}" must be between ${minAllowed} and ${maxAllowed}`);
    }
  }

  db.prepare('BEGIN').run();
  try {
    let ev = db
      .prepare(`SELECT * FROM evaluations WHERE judge_id = ? AND team_id = ? AND phase_id = ?`)
      .get(judgeId, teamId, phaseId);
    let evalId;
    if (ev) {
      evalId = ev.id;
      db.prepare(`UPDATE evaluations SET updated_at = datetime('now'), template_id = ? WHERE id = ?`).run(
        templateId, evalId
      );
      db.prepare(`DELETE FROM scores WHERE evaluation_id = ?`).run(evalId);
    } else {
      const info = db
        .prepare(`INSERT INTO evaluations (judge_id, team_id, phase_id, template_id) VALUES (?, ?, ?, ?)`)
        .run(judgeId, teamId, phaseId, templateId);
      evalId = info.lastInsertRowid;
    }
    const insS = db.prepare(
      `INSERT INTO scores (evaluation_id, criterion_id, level_id, value, note) VALUES (?, ?, ?, ?, ?)`
    );
    for (const s of scores) {
      insS.run(evalId, s.criterionId, s.levelId || null, s.value, s.note || null);
    }
    db.prepare('COMMIT').run();
    return getEvaluation(judgeId, teamId, phaseId);
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
}

// ============ AGGREGATION ============
export function aggregatePhase(phaseId) {
  const phase = getPhase(phaseId);
  if (!phase) return null;
  const hackathonId = phase.hackathon_id;
  const templateId = resolvePhaseTemplateId(phaseId);
  const template = templateId ? getTemplate(templateId) : null;

  const teams = phase.teamIds.map((tid) => getTeam(tid)).filter(Boolean);

  const results = teams.map((team) => {
    const evals = db
      .prepare(
        `SELECT e.id as eval_id, e.judge_id, u.name as judge_name
         FROM evaluations e JOIN users u ON u.id = e.judge_id
         WHERE e.team_id = ? AND e.phase_id = ?`
      ).all(team.id, phaseId);

    const judgeScores = evals.map((e) => {
      const scoresRows = db.prepare(`SELECT * FROM scores WHERE evaluation_id = ?`).all(e.eval_id);
      const scoreByCriterion = {};
      let totalSum = 0, countScored = 0;
      if (template) {
        for (const c of template.criteria) {
          const s = scoresRows.find((r) => r.criterion_id === c.id);
          const v = s ? s.value : null;
          scoreByCriterion[c.id] = { value: v, note: s?.note || null, levelId: s?.level_id || null };
          if (v !== null) { totalSum += v; countScored++; }
        }
      }
      return {
        judgeId: e.judge_id, judgeName: e.judge_name,
        scores: scoreByCriterion, totalPoints: totalSum,
        simpleAvg: countScored > 0 ? totalSum / countScored : null,
      };
    });

    const criterionAverages = {};
    const sectionTotals = {};
    if (template) {
      for (const c of template.criteria) {
        const vals = judgeScores.map((j) => j.scores[c.id]?.value).filter((v) => v != null);
        criterionAverages[c.id] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      }
      for (const sec of template.sections) {
        const secVals = sec.criteria.map((c) => criterionAverages[c.id]).filter((v) => v != null);
        sectionTotals[sec.id] = secVals.length ? secVals.reduce((a, b) => a + b, 0) : null;
      }
    }
    const overallTotal = judgeScores.length > 0
      ? judgeScores.reduce((a, b) => a + b.totalPoints, 0) / judgeScores.length
      : null;

    return { team, judgeCount: judgeScores.length, judgeScores, criterionAverages, sectionTotals, overallTotal };
  });

  results.sort((a, b) => {
    if (a.overallTotal === null && b.overallTotal === null) return 0;
    if (a.overallTotal === null) return 1;
    if (b.overallTotal === null) return -1;
    return b.overallTotal - a.overallTotal;
  });

  return { hackathonId, phase, template, teams: results };
}

export function aggregateAllPhases(hackathonId) {
  const phases = listPhases(hackathonId);
  const allTeams = listTeams(hackathonId);
  return {
    hackathonId,
    phases: phases.map((p) => {
      const agg = aggregatePhase(p.id);
      const templateId = resolvePhaseTemplateId(p.id);
      return {
        id: p.id, name: p.name, order_num: p.order_num,
        template_id: p.template_id, effective_template_id: templateId,
        teams: agg
          ? agg.teams.map((row) => ({
              teamId: row.team.id, teamName: row.team.name,
              total: row.overallTotal, judgeCount: row.judgeCount,
            }))
          : [],
      };
    }),
    allTeams,
  };
}

// ============ PANELS (v4) ============
export function createPanel({ hackathonId, name, description }) {
  const info = db
    .prepare(`INSERT INTO panels (hackathon_id, name, description) VALUES (?, ?, ?)`)
    .run(hackathonId, name, description || null);
  return getPanel(info.lastInsertRowid);
}

export function getPanel(id) {
  const p = db.prepare(`SELECT * FROM panels WHERE id = ?`).get(id);
  if (!p) return null;
  p.teamIds = db
    .prepare(`SELECT team_id FROM panel_teams WHERE panel_id = ? ORDER BY team_id`)
    .all(id).map(r => r.team_id);
  p.judgeIds = db
    .prepare(`SELECT judge_id FROM panel_judges WHERE panel_id = ? ORDER BY judge_id`)
    .all(id).map(r => r.judge_id);
  return p;
}

export function listPanels(hackathonId) {
  const panels = db
    .prepare(`SELECT * FROM panels WHERE hackathon_id = ? ORDER BY created_at ASC`)
    .all(hackathonId);
  for (const p of panels) {
    p.teamIds = db
      .prepare(`SELECT team_id FROM panel_teams WHERE panel_id = ? ORDER BY team_id`)
      .all(p.id).map(r => r.team_id);
    p.judgeIds = db
      .prepare(`SELECT judge_id FROM panel_judges WHERE panel_id = ? ORDER BY judge_id`)
      .all(p.id).map(r => r.judge_id);
  }
  return panels;
}

export function updatePanel(id, { name, description }) {
  const cur = db.prepare(`SELECT * FROM panels WHERE id = ?`).get(id);
  if (!cur) return null;
  db.prepare(`UPDATE panels SET name = ?, description = ? WHERE id = ?`).run(
    name ?? cur.name,
    description !== undefined ? description : cur.description,
    id
  );
  return getPanel(id);
}

export function deletePanel(id) {
  return db.prepare(`DELETE FROM panels WHERE id = ?`).run(id);
}

export function setPanelTeams(panelId, teamIds) {
  db.prepare('BEGIN').run();
  try {
    db.prepare(`DELETE FROM panel_teams WHERE panel_id = ?`).run(panelId);
    if (teamIds && teamIds.length > 0) {
      const ins = db.prepare(`INSERT OR IGNORE INTO panel_teams (panel_id, team_id) VALUES (?, ?)`);
      for (const tid of teamIds) ins.run(panelId, tid);
    }
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
  return getPanel(panelId);
}

export function setPanelJudges(panelId, judgeIds) {
  db.prepare('BEGIN').run();
  try {
    db.prepare(`DELETE FROM panel_judges WHERE panel_id = ?`).run(panelId);
    if (judgeIds && judgeIds.length > 0) {
      // Ensure each judge is in the panel's hackathon; add if not
      const panel = db.prepare(`SELECT hackathon_id FROM panels WHERE id = ?`).get(panelId);
      if (!panel) throw new Error('Panel not found');
      const insP = db.prepare(`INSERT OR IGNORE INTO panel_judges (panel_id, judge_id) VALUES (?, ?)`);
      const insH = db.prepare(`INSERT OR IGNORE INTO judge_hackathons (judge_id, hackathon_id) VALUES (?, ?)`);
      for (const jid of judgeIds) {
        insP.run(panelId, jid);
        insH.run(jid, panel.hackathon_id); // auto-add to hackathon if missing
      }
    }
    db.prepare('COMMIT').run();
  } catch (e) {
    db.prepare('ROLLBACK').run();
    throw e;
  }
  return getPanel(panelId);
}

// ============ SELF-PACED PHASE HELPERS (v4) ============
export function updatePhaseSelfPaced(id, selfPaced) {
  db.prepare(`UPDATE phases SET self_paced = ? WHERE id = ?`).run(selfPaced ? 1 : 0, id);
  return getPhase(id);
}

// For a judge in a self-paced phase: list of (team, alreadyScored) pairs
export function listJudgeTeamsForPhase(judgeId, phaseId) {
  const phase = getPhase(phaseId);
  if (!phase) return { phase: null, teams: [] };
  const hackathonId = phase.hackathon_id;

  // Teams in this phase that the judge is allowed to score
  const allowedTeamIds = new Set(listJudgeAllowedTeamIds(judgeId, hackathonId));
  const phaseTeams = phase.teamIds.filter(tid => allowedTeamIds.has(tid));

  const teams = phaseTeams.map(tid => {
    const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(tid);
    const ev = db
      .prepare(`SELECT id FROM evaluations WHERE judge_id = ? AND team_id = ? AND phase_id = ?`)
      .get(judgeId, tid, phaseId);
    return { team, scored: !!ev };
  });
  return { phase, teams };
}
