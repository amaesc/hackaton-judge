// server.js - Express app (v3: multi-hackathon)
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findUserByUsername, findUserById, createJudge, listJudges,
  deleteUser, updateUserPassword,
  // Hackathons
  createHackathon, getHackathon, listHackathons, updateHackathon, deleteHackathon,
  // Judge memberships & assignments
  setJudgeHackathons, listJudgeHackathons, judgeIsInHackathon,
  setJudgeTeamAssignments, getJudgeTeamAssignments, judgeCanEvaluate, autoSplitAssignments,
  listJudgeAllowedTeamIds,
  // Panels (v4)
  createPanel, getPanel, listPanels, updatePanel, deletePanel,
  setPanelTeams, setPanelJudges,
  // Templates / teams / phases
  createTemplate, listTemplates, getTemplate, deleteTemplate,
  createTeam, listTeams, deleteTeam,
  createPhase, listPhases, getPhase, updatePhase, deletePhase, setPhaseTeams,
  resolvePhaseTemplateId, updatePhaseSelfPaced, listJudgeTeamsForPhase,
  // State + evaluations
  getHackathonState, setHackathonActive, getHackathonIdForPhase,
  submitEvaluation, getEvaluation,
  aggregatePhase, aggregateAllPhases,
} from './db.js';
import { seedIfEmpty } from './seed.js';
import {
  signToken, setAuthCookie, clearAuthCookie,
  authenticate, requireRole, softAuth,
} from './auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

seedIfEmpty();

app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

// ============ SSE (single stream, admin gets all hackathons) ============
const sseClients = new Set();

function broadcastAll() {
  const hackathons = listHackathons({ includeArchived: false });
  const payload = {
    hackathons: hackathons.map((h) => {
      const state = getHackathonState(h.id);
      const phaseAgg = state.active_phase_id ? aggregatePhase(state.active_phase_id) : null;
      const raceAgg = aggregateAllPhases(h.id);
      return { hackathon: h, state, phase: phaseAgg, race: raceAgg };
    }),
  };
  const data = JSON.stringify(payload);
  for (const res of sseClients) {
    try { res.write(`event: update\ndata: ${data}\n\n`); } catch {}
  }
}

app.get('/api/admin/stream', authenticate, requireRole('admin'), (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Initial push (same shape as broadcastAll)
  const hackathons = listHackathons({ includeArchived: false });
  const payload = {
    hackathons: hackathons.map((h) => {
      const state = getHackathonState(h.id);
      const phaseAgg = state.active_phase_id ? aggregatePhase(state.active_phase_id) : null;
      const raceAgg = aggregateAllPhases(h.id);
      return { hackathon: h, state, phase: phaseAgg, race: raceAgg };
    }),
  };
  res.write(`event: update\ndata: ${JSON.stringify(payload)}\n\n`);

  sseClients.add(res);
  const hb = setInterval(() => { try { res.write(`: hb\n\n`); } catch {} }, 25000);
  req.on('close', () => { clearInterval(hb); sseClients.delete(res); });
});

// ============ AUTH ============
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const user = findUserByUsername(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  setAuthCookie(res, signToken(user));
  res.json({ id: user.id, username: user.username, role: user.role, name: user.name });
});

app.post('/api/auth/logout', (req, res) => { clearAuthCookie(res); res.json({ ok: true }); });

app.get('/api/auth/me', authenticate, (req, res) => {
  const user = findUserById(req.user.id);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json(user);
});

app.post('/api/auth/change-password', authenticate, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'newPassword must be at least 6 characters' });
  }
  const user = findUserByUsername(req.user.username);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: 'Current password incorrect' });
  }
  updateUserPassword(user.id, newPassword);
  res.json({ ok: true });
});

// Helper to parse+validate hackathonId from query
function hackParam(req, res) {
  const hid = Number(req.query.hackathonId || req.body?.hackathonId);
  if (!Number.isInteger(hid) || hid <= 0) {
    res.status(400).json({ error: 'hackathonId required' });
    return null;
  }
  if (!getHackathon(hid)) {
    res.status(404).json({ error: 'hackathon not found' });
    return null;
  }
  return hid;
}

// ============ ADMIN: HACKATHONS ============
app.get('/api/admin/hackathons', authenticate, requireRole('admin'), (req, res) => {
  res.json(listHackathons({ includeArchived: req.query.includeArchived === 'true' }));
});
app.post('/api/admin/hackathons', authenticate, requireRole('admin'), (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const h = createHackathon({ name, description });
  broadcastAll();
  res.status(201).json(h);
});
app.put('/api/admin/hackathons/:id', authenticate, requireRole('admin'), (req, res) => {
  const h = updateHackathon(Number(req.params.id), req.body || {});
  if (!h) return res.status(404).json({ error: 'not found' });
  broadcastAll();
  res.json(h);
});
app.delete('/api/admin/hackathons/:id', authenticate, requireRole('admin'), (req, res) => {
  deleteHackathon(Number(req.params.id));
  broadcastAll();
  res.json({ ok: true });
});

// ============ ADMIN: JUDGES ============
app.get('/api/admin/judges', authenticate, requireRole('admin'), (req, res) => res.json(listJudges()));

app.post('/api/admin/judges', authenticate, requireRole('admin'), (req, res) => {
  const { username, password, name, hackathonIds } = req.body || {};
  if (!username || !password || !name) return res.status(400).json({ error: 'username, password, name required' });
  if (password.length < 4) return res.status(400).json({ error: 'password min length 4' });
  if (findUserByUsername(username)) return res.status(409).json({ error: 'Username taken' });
  const judge = createJudge({ username, password, name });
  if (Array.isArray(hackathonIds) && hackathonIds.length) {
    setJudgeHackathons(judge.id, hackathonIds.map(Number).filter(Number.isInteger));
  }
  broadcastAll();
  res.status(201).json({ ...judge, hackathonIds: hackathonIds || [] });
});

app.delete('/api/admin/judges/:id', authenticate, requireRole('admin'), (req, res) => {
  deleteUser(Number(req.params.id));
  broadcastAll();
  res.json({ ok: true });
});

// Set which hackathons a judge is invited to
app.put('/api/admin/judges/:id/hackathons', authenticate, requireRole('admin'), (req, res) => {
  const { hackathonIds } = req.body || {};
  if (!Array.isArray(hackathonIds)) return res.status(400).json({ error: 'hackathonIds array required' });
  setJudgeHackathons(Number(req.params.id), hackathonIds.map(Number).filter(Number.isInteger));
  broadcastAll();
  res.json({ ok: true });
});

// Get a judge's team assignment for a specific hackathon
app.get('/api/admin/judges/:id/teams', authenticate, requireRole('admin'), (req, res) => {
  const hid = hackParam(req, res); if (hid === null) return;
  res.json({
    hackathonId: hid,
    teamIds: getJudgeTeamAssignments(Number(req.params.id), hid),
  });
});

// Set a judge's team assignment for a specific hackathon. Empty array = "all teams".
app.put('/api/admin/judges/:id/teams', authenticate, requireRole('admin'), (req, res) => {
  const { hackathonId, teamIds } = req.body || {};
  const hid = Number(hackathonId);
  if (!Number.isInteger(hid) || !getHackathon(hid)) return res.status(400).json({ error: 'valid hackathonId required' });
  if (!Array.isArray(teamIds)) return res.status(400).json({ error: 'teamIds array required' });
  setJudgeTeamAssignments(Number(req.params.id), hid, teamIds.map(Number).filter(Number.isInteger));
  broadcastAll();
  res.json({ ok: true });
});

// Auto-split teams among judges for a hackathon
app.post('/api/admin/hackathons/:id/auto-split', authenticate, requireRole('admin'), (req, res) => {
  const hid = Number(req.params.id);
  if (!getHackathon(hid)) return res.status(404).json({ error: 'hackathon not found' });
  const overlap = Number(req.body?.overlap) || 3;
  const assign = autoSplitAssignments(hid, overlap);
  broadcastAll();
  res.json({ hackathonId: hid, overlap, assignments: assign });
});

// ============ ADMIN: PANELS (v4) ============
app.get('/api/admin/panels', authenticate, requireRole('admin'), (req, res) => {
  const hid = hackParam(req, res); if (hid === null) return;
  res.json(listPanels(hid));
});
app.post('/api/admin/panels', authenticate, requireRole('admin'), (req, res) => {
  const { hackathonId, name, description } = req.body || {};
  const hid = Number(hackathonId);
  if (!Number.isInteger(hid) || !getHackathon(hid)) return res.status(400).json({ error: 'valid hackathonId required' });
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const p = createPanel({ hackathonId: hid, name: name.trim(), description: description || null });
  broadcastAll();
  res.status(201).json(p);
});
app.put('/api/admin/panels/:id', authenticate, requireRole('admin'), (req, res) => {
  const p = updatePanel(Number(req.params.id), req.body || {});
  if (!p) return res.status(404).json({ error: 'panel not found' });
  broadcastAll();
  res.json(p);
});
app.delete('/api/admin/panels/:id', authenticate, requireRole('admin'), (req, res) => {
  deletePanel(Number(req.params.id));
  broadcastAll();
  res.json({ ok: true });
});
app.put('/api/admin/panels/:id/teams', authenticate, requireRole('admin'), (req, res) => {
  const { teamIds } = req.body || {};
  if (!Array.isArray(teamIds)) return res.status(400).json({ error: 'teamIds array required' });
  const p = setPanelTeams(Number(req.params.id), teamIds.map(Number).filter(Number.isInteger));
  if (!p) return res.status(404).json({ error: 'panel not found' });
  broadcastAll();
  res.json(p);
});
app.put('/api/admin/panels/:id/judges', authenticate, requireRole('admin'), (req, res) => {
  const { judgeIds } = req.body || {};
  if (!Array.isArray(judgeIds)) return res.status(400).json({ error: 'judgeIds array required' });
  const p = setPanelJudges(Number(req.params.id), judgeIds.map(Number).filter(Number.isInteger));
  if (!p) return res.status(404).json({ error: 'panel not found' });
  broadcastAll();
  res.json(p);
});

// ============ ADMIN: TEMPLATES (scoped) ============
app.get('/api/admin/templates', authenticate, requireRole('admin'), (req, res) => {
  const hid = hackParam(req, res); if (hid === null) return;
  res.json(listTemplates(hid));
});
app.post('/api/admin/templates', authenticate, requireRole('admin'), (req, res) => {
  const { hackathonId, name, kind, sections } = req.body || {};
  const hid = Number(hackathonId);
  if (!Number.isInteger(hid) || !getHackathon(hid)) return res.status(400).json({ error: 'valid hackathonId required' });
  if (!name) return res.status(400).json({ error: 'name required' });
  if (!Array.isArray(sections) || sections.length === 0) {
    return res.status(400).json({ error: 'at least one section required' });
  }
  const totalCriteria = sections.reduce((n, s) => n + (s.criteria?.length || 0), 0);
  if (totalCriteria === 0) return res.status(400).json({ error: 'at least one criterion required' });

  for (const sec of sections) {
    if (!sec.name) return res.status(400).json({ error: 'each section needs a name' });
    for (const c of (sec.criteria || [])) {
      if (!c.label) return res.status(400).json({ error: 'each criterion needs a label' });
      if (kind === 'rubric' && (!Array.isArray(c.levels) || c.levels.length === 0)) {
        return res.status(400).json({ error: `criterion "${c.label}" needs at least one rubric level` });
      }
      for (const lv of (c.levels || [])) {
        if (!lv.label) return res.status(400).json({ error: 'each rubric level needs a label' });
        if (!Number.isInteger(lv.minPoints) || !Number.isInteger(lv.maxPoints) || lv.minPoints > lv.maxPoints) {
          return res.status(400).json({ error: `level "${lv.label}" has invalid min/max points` });
        }
      }
    }
  }
  const tpl = createTemplate({ hackathonId: hid, name, kind: kind || 'rubric', sections });
  broadcastAll();
  res.status(201).json(tpl);
});
app.delete('/api/admin/templates/:id', authenticate, requireRole('admin'), (req, res) => {
  deleteTemplate(Number(req.params.id));
  broadcastAll();
  res.json({ ok: true });
});

// ============ ADMIN: TEAMS (scoped) ============
app.get('/api/admin/teams', authenticate, requireRole('admin'), (req, res) => {
  const hid = hackParam(req, res); if (hid === null) return;
  res.json(listTeams(hid));
});
app.post('/api/admin/teams', authenticate, requireRole('admin'), (req, res) => {
  const { hackathonId, name, description } = req.body || {};
  const hid = Number(hackathonId);
  if (!Number.isInteger(hid) || !getHackathon(hid)) return res.status(400).json({ error: 'valid hackathonId required' });
  if (!name) return res.status(400).json({ error: 'name required' });
  const t = createTeam({ hackathonId: hid, name, description });
  broadcastAll();
  res.status(201).json(t);
});
app.delete('/api/admin/teams/:id', authenticate, requireRole('admin'), (req, res) => {
  deleteTeam(Number(req.params.id));
  broadcastAll();
  res.json({ ok: true });
});

// ============ ADMIN: PHASES (scoped) ============
app.get('/api/admin/phases', authenticate, requireRole('admin'), (req, res) => {
  const hid = hackParam(req, res); if (hid === null) return;
  const phases = listPhases(hid).map((p) => ({
    ...p, effective_template_id: resolvePhaseTemplateId(p.id),
  }));
  res.json(phases);
});
app.post('/api/admin/phases', authenticate, requireRole('admin'), (req, res) => {
  const { hackathonId, name, templateId, selfPaced } = req.body || {};
  const hid = Number(hackathonId);
  if (!Number.isInteger(hid) || !getHackathon(hid)) return res.status(400).json({ error: 'valid hackathonId required' });
  if (!name) return res.status(400).json({ error: 'name required' });
  const p = createPhase({ hackathonId: hid, name, templateId: templateId || null, selfPaced: !!selfPaced });
  broadcastAll();
  res.status(201).json(p);
});
app.put('/api/admin/phases/:id', authenticate, requireRole('admin'), (req, res) => {
  const p = updatePhase(Number(req.params.id), req.body || {});
  if (!p) return res.status(404).json({ error: 'phase not found' });
  broadcastAll();
  res.json(p);
});
app.put('/api/admin/phases/:id/teams', authenticate, requireRole('admin'), (req, res) => {
  const { teamIds } = req.body || {};
  if (!Array.isArray(teamIds)) return res.status(400).json({ error: 'teamIds array required' });
  const p = setPhaseTeams(Number(req.params.id), teamIds.map(Number).filter(Number.isInteger));
  broadcastAll();
  res.json(p);
});
app.delete('/api/admin/phases/:id', authenticate, requireRole('admin'), (req, res) => {
  deletePhase(Number(req.params.id));
  broadcastAll();
  res.json({ ok: true });
});

// ============ ADMIN: ACTIVE STATE (per hackathon) ============
app.get('/api/admin/active', authenticate, requireRole('admin'), (req, res) => {
  const hid = hackParam(req, res); if (hid === null) return;
  res.json(getHackathonState(hid));
});
app.put('/api/admin/active', authenticate, requireRole('admin'), (req, res) => {
  const { hackathonId, teamId, phaseId } = req.body || {};
  const hid = Number(hackathonId);
  if (!Number.isInteger(hid) || !getHackathon(hid)) return res.status(400).json({ error: 'valid hackathonId required' });
  const state = setHackathonActive(hid, { teamId, phaseId });
  broadcastAll();
  res.json(state);
});

// ============ ADMIN: RESULTS + RACE (per hackathon) ============
app.get('/api/admin/results', authenticate, requireRole('admin'), (req, res) => {
  const hid = hackParam(req, res); if (hid === null) return;
  const state = getHackathonState(hid);
  res.json(state.active_phase_id ? aggregatePhase(state.active_phase_id) : null);
});
app.get('/api/admin/race', authenticate, requireRole('admin'), (req, res) => {
  const hid = hackParam(req, res); if (hid === null) return;
  res.json(aggregateAllPhases(hid));
});

// ============ JUDGE: multi-hackathon picker ============
app.get('/api/judge/hackathons', authenticate, requireRole('judge'), (req, res) => {
  res.json(listJudgeHackathons(req.user.id));
});

// Judge: list phases they're relevant to in a hackathon, with self_paced flag
app.get('/api/judge/phases', authenticate, requireRole('judge'), (req, res) => {
  const hid = Number(req.query.hackathonId);
  if (!Number.isInteger(hid)) return res.status(400).json({ error: 'hackathonId required' });
  if (!judgeIsInHackathon(req.user.id, hid)) return res.status(403).json({ error: 'Not a judge for this hackathon' });

  const phases = listPhases(hid).map((p) => ({
    id: p.id, name: p.name, order_num: p.order_num,
    self_paced: !!p.self_paced,
    effective_template_id: resolvePhaseTemplateId(p.id),
  }));
  res.json(phases);
});

// Judge: in a self-paced phase, list the teams they can score with already-scored flags
app.get('/api/judge/phase-teams', authenticate, requireRole('judge'), (req, res) => {
  const hid = Number(req.query.hackathonId);
  const phaseId = Number(req.query.phaseId);
  if (!Number.isInteger(hid) || !Number.isInteger(phaseId)) {
    return res.status(400).json({ error: 'hackathonId and phaseId required' });
  }
  if (!judgeIsInHackathon(req.user.id, hid)) return res.status(403).json({ error: 'Not a judge for this hackathon' });

  const phase = getPhase(phaseId);
  if (!phase || phase.hackathon_id !== hid) return res.status(404).json({ error: 'phase not found in this hackathon' });
  if (!phase.self_paced) return res.status(400).json({ error: 'phase is not self-paced' });

  const { teams } = listJudgeTeamsForPhase(req.user.id, phaseId);
  const templateId = resolvePhaseTemplateId(phaseId);
  const template = templateId ? getTemplate(templateId) : null;
  res.json({ phase, template, teams });
});

// Judge: fetch existing evaluation + template for a specific team (self-paced mode)
app.get('/api/judge/team-eval', authenticate, requireRole('judge'), (req, res) => {
  const hid = Number(req.query.hackathonId);
  const phaseId = Number(req.query.phaseId);
  const teamId = Number(req.query.teamId);
  if (!Number.isInteger(hid) || !Number.isInteger(phaseId) || !Number.isInteger(teamId)) {
    return res.status(400).json({ error: 'hackathonId, phaseId, teamId required' });
  }
  if (!judgeIsInHackathon(req.user.id, hid)) return res.status(403).json({ error: 'Not a judge for this hackathon' });
  if (!judgeCanEvaluate(req.user.id, hid, teamId)) return res.status(403).json({ error: 'Not assigned to this team' });

  const phase = getPhase(phaseId);
  if (!phase || phase.hackathon_id !== hid) return res.status(404).json({ error: 'phase not found' });
  if (!phase.teamIds.includes(teamId)) return res.status(400).json({ error: 'team not in phase' });

  const templateId = resolvePhaseTemplateId(phaseId);
  if (!templateId) return res.status(400).json({ error: 'no template for phase' });
  const template = getTemplate(templateId);
  const team = listTeams(hid).find(t => t.id === teamId);
  const existing = getEvaluation(req.user.id, teamId, phaseId);
  res.json({ phase, team, template, existing });
});

// Current active team in a specific hackathon (admin-controlled mode)
app.get('/api/judge/current', authenticate, requireRole('judge'), (req, res) => {
  const hid = Number(req.query.hackathonId);
  if (!Number.isInteger(hid)) return res.status(400).json({ error: 'hackathonId required' });
  if (!judgeIsInHackathon(req.user.id, hid)) return res.status(403).json({ error: 'Not a judge for this hackathon' });

  const state = getHackathonState(hid);
  if (!state.active_team_id || !state.active_phase_id) return res.json({ active: false });
  const phase = getPhase(state.active_phase_id);
  if (!phase || phase.hackathon_id !== hid) return res.json({ active: false });
  // If phase is self-paced, tell client to use the phase-teams endpoint instead
  if (phase.self_paced) return res.json({ active: false, reason: 'phase is self-paced', selfPaced: true, phaseId: phase.id });
  if (!phase.teamIds.includes(state.active_team_id)) {
    return res.json({ active: false, reason: 'team not in phase' });
  }
  if (!judgeCanEvaluate(req.user.id, hid, state.active_team_id)) {
    return res.json({ active: false, reason: 'team not assigned to you' });
  }
  const templateId = resolvePhaseTemplateId(state.active_phase_id);
  if (!templateId) return res.json({ active: false, reason: 'no template for phase' });

  const template = getTemplate(templateId);
  const team = listTeams(hid).find((t) => t.id === state.active_team_id);
  const existing = getEvaluation(req.user.id, state.active_team_id, state.active_phase_id);
  res.json({ active: true, team, phase, template, existing });
});

app.post('/api/judge/submit', authenticate, requireRole('judge'), (req, res) => {
  const { hackathonId, scores, teamId: bodyTeamId, phaseId: bodyPhaseId } = req.body || {};
  const hid = Number(hackathonId);
  if (!Number.isInteger(hid)) return res.status(400).json({ error: 'hackathonId required' });
  if (!judgeIsInHackathon(req.user.id, hid)) return res.status(403).json({ error: 'Not a judge for this hackathon' });
  if (!Array.isArray(scores)) return res.status(400).json({ error: 'scores array required' });

  // Determine phase + team: from body (self-paced) OR from active state (admin-controlled)
  let phaseId, teamId;
  if (bodyPhaseId && bodyTeamId) {
    phaseId = Number(bodyPhaseId);
    teamId = Number(bodyTeamId);
  } else {
    const state = getHackathonState(hid);
    if (!state.active_team_id || !state.active_phase_id) return res.status(400).json({ error: 'No active evaluation' });
    phaseId = state.active_phase_id;
    teamId = state.active_team_id;
  }

  const phase = getPhase(phaseId);
  if (!phase || phase.hackathon_id !== hid) return res.status(400).json({ error: 'Phase does not belong to this hackathon' });
  if (!phase.teamIds.includes(teamId)) return res.status(400).json({ error: 'Team not in phase' });
  if (!judgeCanEvaluate(req.user.id, hid, teamId)) {
    return res.status(403).json({ error: 'You are not assigned to this team' });
  }

  const templateId = resolvePhaseTemplateId(phaseId);
  if (!templateId) return res.status(400).json({ error: 'No template for phase' });
  const template = getTemplate(templateId);
  const critIds = new Set(template.criteria.map((c) => c.id));
  const provided = new Set(scores.map((s) => s.criterionId));
  for (const cid of critIds) {
    if (!provided.has(cid)) {
      const c = template.criteria.find((x) => x.id === cid);
      return res.status(400).json({ error: `Missing score for "${c.label}"` });
    }
  }
  try {
    const ev = submitEvaluation({ judgeId: req.user.id, teamId, phaseId, scores });
    broadcastAll();
    res.json(ev);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ============ STATIC ============
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', softAuth, (req, res) => {
  if (req.user?.role === 'admin') return res.redirect('/admin');
  if (req.user?.role === 'judge') return res.redirect('/judge');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/judge', (req, res) => res.sendFile(path.join(__dirname, 'public', 'judge.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Hackathon Judge v3 running on http://localhost:${PORT}\n`);
});
