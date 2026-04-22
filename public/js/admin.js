// admin.js (v4) — Multi-hackathon admin UI with Panels + Self-paced phases
// Tabs: Hackathons | Live | Race | Phases | Teams | Panels | Templates | Judges | Account

// =============== STATE ===============
const state = {
  hackathons: [],        // all hackathons
  activeHackathonId: null, // which hackathon the admin is viewing
  judges: [],            // global list of judges (with hackathonIds per judge)
  templates: [],         // templates for the active hackathon
  teams: [],             // teams for the active hackathon
  phases: [],            // phases for the active hackathon
  panels: [],            // panels for the active hackathon (v4)
  active: { active_team_id: null, active_phase_id: null }, // hackathon_state for active hackathon
  liveResults: null,     // current phase aggregation for active hackathon
  race: null,            // race aggregation for active hackathon
  expandedTeams: new Set(),
  expandedPanels: new Set(), // v4: which panel edit blocks are open
  criteriaDraft: null,   // template builder draft
  autoSplitOverlap: 3,   // default judges-per-team in auto-split
};

let sse = null;
let currentTab = 'hackathons';

const TABS = [
  { id: 'hackathons', key: 'tab_hackathons',  needsHack: false },
  { id: 'live',       key: 'tab_live',        needsHack: true },
  { id: 'race',       key: 'tab_race',        needsHack: true },
  { id: 'phases',     key: 'tab_phases',      needsHack: true },
  { id: 'teams',      key: 'tab_teams',       needsHack: true },
  { id: 'panels',     key: 'tab_panels',      needsHack: true }, // v4
  { id: 'templates',  key: 'tab_templates',   needsHack: true },
  { id: 'judges',     key: 'tab_judges',      needsHack: false },
  { id: 'settings',   key: 'tab_settings',    needsHack: false },
];

// =============== TABS ===============
function renderTabs() {
  const bar = document.getElementById('tabBar');
  bar.innerHTML = TABS.map(tab =>
    `<button class="tab ${tab.id === currentTab ? 'active' : ''}" data-tab="${tab.id}">${t(tab.key)}</button>`
  ).join('');
  bar.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
}

function activateTab(id) {
  currentTab = id;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== `tab-${id}`));
  renderCurrentTab();
}

function renderCurrentTab() {
  ({
    hackathons: renderHackathons,
    live: renderLive,
    race: renderRace,
    phases: renderPhases,
    teams: renderTeams,
    panels: renderPanels,
    templates: renderTemplates,
    judges: renderJudges,
    settings: renderSettings,
  })[currentTab]?.();
}

// =============== BOOT ===============
(async function boot() {
  try {
    const me = await api('/api/auth/me');
    document.getElementById('userName').textContent = me.name;
    if (me.role !== 'admin') { location.href = '/judge'; return; }
  } catch { return; }

  document.getElementById('logoutBtn').textContent = t('sign_out');

  renderTopControls();
  renderTabs();

  await refreshAll();

  // Pick an active hackathon if none selected
  if (!state.activeHackathonId && state.hackathons.length > 0) {
    state.activeHackathonId = state.hackathons[0].id;
  }
  if (state.activeHackathonId) await refreshForActiveHackathon();

  renderCurrentTab();
  connectSSE();

  window.addEventListener('hj-lang-change', () => {
    document.getElementById('logoutBtn').textContent = t('sign_out');
    renderTabs();
    renderCurrentTab();
  });
  window.addEventListener('hj-theme-change', () => { if (currentTab === 'race') renderRace(); });
})();

// =============== DATA FETCHERS ===============
async function refreshAll() {
  [state.hackathons, state.judges] = await Promise.all([
    api('/api/admin/hackathons'),
    api('/api/admin/judges'),
  ]);
}

async function refreshForActiveHackathon() {
  if (!state.activeHackathonId) return;
  const hid = state.activeHackathonId;
  const [tpls, teams, phases, active, panels] = await Promise.all([
    api(`/api/admin/templates?hackathonId=${hid}`),
    api(`/api/admin/teams?hackathonId=${hid}`),
    api(`/api/admin/phases?hackathonId=${hid}`),
    api(`/api/admin/active?hackathonId=${hid}`),
    api(`/api/admin/panels?hackathonId=${hid}`),
  ]);
  state.templates = tpls;
  state.teams = teams;
  state.phases = phases;
  state.active = active;
  state.panels = panels;
}

// =============== SSE ===============
function connectSSE() {
  if (sse) sse.close();
  sse = new EventSource('/api/admin/stream');
  sse.addEventListener('update', (e) => {
    try {
      const payload = JSON.parse(e.data);
      if (payload.hackathons) {
        state.hackathons = payload.hackathons.map(h => h.hackathon);
        if (state.activeHackathonId) {
          const entry = payload.hackathons.find(h => h.hackathon.id === state.activeHackathonId);
          if (entry) {
            state.active = entry.state;
            state.liveResults = entry.phase;
            state.race = entry.race;
          } else {
            // Active hackathon was deleted — pick another
            state.activeHackathonId = state.hackathons[0]?.id || null;
            if (state.activeHackathonId) refreshForActiveHackathon().then(renderCurrentTab);
          }
        }
      }
      renderCurrentTab();
    } catch (err) { console.error(err); }
  });
  sse.onerror = () => { setTimeout(connectSSE, 3000); };
}

// =============== HACKATHON PICKER (shown above content for hackathon-scoped tabs) ===============
function renderHackathonPicker() {
  if (state.hackathons.length === 0) {
    return `<div class="card">
      <div class="alert alert-info" style="margin-bottom:0">${t('no_hackathons_yet')}</div>
    </div>`;
  }
  return `
    <div class="card" style="padding:12px 14px">
      <label style="font-size:.78rem;font-weight:600;margin-bottom:6px;display:block">${t('active_hackathon')}</label>
      <select id="hackathonPicker">
        ${state.hackathons.map(h =>
          `<option value="${h.id}" ${h.id === state.activeHackathonId ? 'selected' : ''}>${escapeHtml(h.name)}</option>`
        ).join('')}
      </select>
    </div>
  `;
}

function wireHackathonPicker() {
  const sel = document.getElementById('hackathonPicker');
  if (!sel) return;
  sel.addEventListener('change', async (e) => {
    state.activeHackathonId = Number(e.target.value);
    state.expandedTeams.clear();
    await refreshForActiveHackathon();
    renderCurrentTab();
  });
}

function noHackathonSelected(host) {
  host.innerHTML = renderHackathonPicker() +
    `<div class="card"><div class="empty">${t('pick_hackathon_first')}</div></div>`;
  wireHackathonPicker();
}

// =============== HACKATHONS TAB ===============
function renderHackathons() {
  const host = document.getElementById('tab-hackathons');
  host.innerHTML = `
    <div class="card">
      <h2>${t('new_hackathon')}</h2>
      <div class="form-row">
        <label>${t('hackathon_name')}</label>
        <input type="text" id="newHackName" placeholder="${t('hackathon_name_placeholder')}" />
      </div>
      <div class="form-row">
        <label>${t('description_optional')}</label>
        <textarea id="newHackDesc" placeholder="${t('description_placeholder')}"></textarea>
      </div>
      <button id="addHackBtn" class="btn-block">${t('create_hackathon')}</button>
    </div>

    <div class="card">
      <h2>${t('hackathons_count', { n: state.hackathons.length })}</h2>
      ${state.hackathons.length === 0
        ? `<div class="empty">${t('no_hackathons_yet')}</div>`
        : state.hackathons.map(h => `
          <div class="list-item" style="align-items:flex-start;flex-direction:column;gap:8px">
            <div class="row-between" style="width:100%">
              <div style="min-width:0;flex:1">
                <div class="name">${escapeHtml(h.name)}
                  ${h.id === state.activeHackathonId ? `<span class="badge badge-accent" style="margin-left:6px">${t('active_badge')}</span>` : ''}
                </div>
                ${h.description ? `<div class="meta" style="white-space:normal">${escapeHtml(h.description)}</div>` : ''}
              </div>
              <div class="list-item-actions">
                ${h.id !== state.activeHackathonId
                  ? `<button class="btn-sm btn-secondary" data-switch-hack="${h.id}">${t('select_hackathon')}</button>`
                  : ''}
                <button class="btn-sm btn-danger" data-del-hack="${h.id}">${t('delete')}</button>
              </div>
            </div>
          </div>
        `).join('')}
    </div>
  `;

  document.getElementById('addHackBtn').addEventListener('click', async () => {
    const name = document.getElementById('newHackName').value.trim();
    const description = document.getElementById('newHackDesc').value.trim();
    if (!name) return showAlert(document.getElementById('alert'), t('all_fields_required'));
    try {
      const h = await api('/api/admin/hackathons', { method: 'POST', body: { name, description } });
      await refreshAll();
      if (!state.activeHackathonId) state.activeHackathonId = h.id;
      await refreshForActiveHackathon();
      renderHackathons();
    } catch (e) { showAlert(document.getElementById('alert'), e.message); }
  });

  host.querySelectorAll('[data-switch-hack]').forEach(b => {
    b.addEventListener('click', async () => {
      state.activeHackathonId = Number(b.dataset.switchHack);
      state.expandedTeams.clear();
      await refreshForActiveHackathon();
      renderHackathons();
    });
  });

  host.querySelectorAll('[data-del-hack]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm(t('confirm_delete_hackathon'))) return;
      try {
        await api(`/api/admin/hackathons/${b.dataset.delHack}`, { method: 'DELETE' });
        await refreshAll();
        // If we deleted the active one, pick another or none
        if (!state.hackathons.find(h => h.id === state.activeHackathonId)) {
          state.activeHackathonId = state.hackathons[0]?.id || null;
          if (state.activeHackathonId) await refreshForActiveHackathon();
        }
        renderHackathons();
      } catch (e) { showAlert(document.getElementById('alert'), e.message); }
    });
  });
}

// =============== LIVE TAB ===============
function renderLive() {
  const host = document.getElementById('tab-live');
  if (!state.activeHackathonId) return noHackathonSelected(host);

  const activePhase = state.phases.find(p => p.id === state.active.active_phase_id);
  const activeTeam = state.teams.find(t => t.id === state.active.active_team_id);
  const selectedPhaseId = state.active.active_phase_id;
  const phaseObj = state.phases.find(p => p.id === selectedPhaseId);
  const phaseTeams = phaseObj
    ? state.teams.filter(tm => phaseObj.teamIds.includes(tm.id))
    : state.teams;

  const controls = `
    <div class="card">
      <div class="row-between mb-2">
        <h2 style="margin:0">${t('active_evaluation')}</h2>
        <span class="live-pill"><span class="pulse"></span> ${t('live')}</span>
      </div>
      <div class="form-row">
        <label>${t('active_phase')}</label>
        <select id="activePhaseSel">
          <option value="">${t('none')}</option>
          ${state.phases.map(p =>
            `<option value="${p.id}" ${state.active.active_phase_id === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="form-row">
        <label>${t('active_team')}</label>
        <select id="activeTeamSel" ${!selectedPhaseId ? 'disabled' : ''}>
          <option value="">${t('none')}</option>
          ${phaseTeams.map(tm =>
            `<option value="${tm.id}" ${state.active.active_team_id === tm.id ? 'selected' : ''}>${escapeHtml(tm.name)}</option>`
          ).join('')}
        </select>
      </div>
      <button id="setActiveBtn" class="btn-block">${t('update_active')}</button>
      ${(activeTeam && activePhase) ? `
        <div class="alert alert-success mt-2" style="margin-bottom:0">
          ${t('judges_scoring', { team: escapeHtml(activeTeam.name), phase: escapeHtml(activePhase.name) })}
        </div>
      ` : `
        <div class="alert alert-info mt-2" style="margin-bottom:0">${t('select_phase_team')}</div>
      `}
    </div>
  `;

  let board = '';
  if (state.liveResults && state.liveResults.template) {
    board = renderLeaderboard(state.liveResults);
  } else if (selectedPhaseId) {
    board = `<div class="card"><div class="empty">${t('select_active_phase_hint')}</div></div>`;
  }

  host.innerHTML = renderHackathonPicker() + controls + board;
  wireHackathonPicker();

  document.getElementById('setActiveBtn').addEventListener('click', async () => {
    const phaseId = document.getElementById('activePhaseSel').value || null;
    const teamId = document.getElementById('activeTeamSel').value || null;
    try {
      await api('/api/admin/active', {
        method: 'PUT',
        body: {
          hackathonId: state.activeHackathonId,
          teamId: teamId ? Number(teamId) : null,
          phaseId: phaseId ? Number(phaseId) : null,
        },
      });
      await refreshForActiveHackathon();
      renderLive();
      showAlert(document.getElementById('alert'), t('scores_submitted'), 'success');
    } catch (e) { showAlert(document.getElementById('alert'), e.message); }
  });

  document.getElementById('activePhaseSel').addEventListener('change', (ev) => {
    const pid = Number(ev.target.value) || null;
    const phase = state.phases.find(p => p.id === pid);
    const sel = document.getElementById('activeTeamSel');
    sel.disabled = !pid;
    const teams = phase ? state.teams.filter(tm => phase.teamIds.includes(tm.id)) : [];
    sel.innerHTML = `<option value="">${t('none')}</option>` + teams.map(tm =>
      `<option value="${tm.id}">${escapeHtml(tm.name)}</option>`
    ).join('');
  });

  host.querySelectorAll('.team-header').forEach(h => {
    h.addEventListener('click', () => {
      const id = Number(h.dataset.team);
      state.expandedTeams.has(id) ? state.expandedTeams.delete(id) : state.expandedTeams.add(id);
      h.parentElement.classList.toggle('expanded');
    });
  });
}

function renderLeaderboard(results) {
  const { phase, template, teams } = results;
  if (!teams.length) {
    return `<div class="card"><h2>${t('leaderboard')}</h2><div class="empty">${t('no_teams_in_phase')}</div></div>`;
  }
  return `
    <div class="card">
      <div class="row-between mb-1">
        <h2 style="margin:0">${t('leaderboard')}</h2>
        <span class="badge">${escapeHtml(phase.name)}</span>
      </div>
      <p class="text-xs text-muted">${t('template_total', { n: template.totalMaxPoints })}</p>
      ${teams.map((row, i) => renderTeamLeaderRow(row, i, template)).join('')}
    </div>
  `;
}

function renderTeamLeaderRow(row, i, template) {
  const rank = i + 1;
  const rankCls = rank <= 3 ? `rank-${rank}` : '';
  const expanded = state.expandedTeams.has(row.team.id) ? 'expanded' : '';
  const isActive = row.team.id === state.active.active_team_id;

  const sectionRows = template.sections.map(sec => {
    const secTotal = row.sectionTotals?.[sec.id];
    return `
      <div class="criterion-section-title" style="margin-top:10px">${escapeHtml(sec.name)}
        <span class="text-xs text-muted" style="font-weight:500">(${fmt(secTotal, 1)})</span>
      </div>
      ${sec.criteria.map(c => {
        const avg = row.criterionAverages?.[c.id];
        return `
          <div class="criterion-row">
            <div>
              <div>${escapeHtml(c.label)}</div>
              <div class="text-xs text-muted">0–${c.max_points} ${t('out_of')}</div>
            </div>
            <div class="value">${fmt(avg, 1)}</div>
          </div>
        `;
      }).join('')}
    `;
  }).join('');

  const judgeRows = row.judgeScores.length === 0
    ? `<div class="text-xs text-muted">${t('no_judges_scored')}</div>`
    : row.judgeScores.map(j => {
        const notes = Object.entries(j.scores)
          .filter(([_, s]) => s.note)
          .map(([cid, s]) => {
            const crit = template.criteria.find(c => c.id === Number(cid));
            return `<div class="text-xs text-muted" style="margin:2px 0 0 12px">• ${escapeHtml(crit?.label || '')}: ${escapeHtml(s.note)}</div>`;
          }).join('');
        return `
          <div style="border-bottom:1px solid var(--border);padding:8px 0">
            <div class="row-between">
              <div>${escapeHtml(j.judgeName)}</div>
              <div><span class="badge badge-primary">${fmt(j.totalPoints, 1)} ${t('total_pts')}</span></div>
            </div>
            ${notes}
          </div>
        `;
      }).join('');

  const jc = row.judgeCount;
  const jcLabel = jc === 1 ? t('judge_count_one', { n: jc }) : t('judge_count_many', { n: jc });

  return `
    <div class="team-row ${expanded}">
      <div class="team-header" data-team="${row.team.id}">
        <div class="rank ${rankCls}">${rank}</div>
        <div>
          <div class="team-name">
            ${escapeHtml(row.team.name)}
            ${isActive ? `<span class="badge badge-accent" style="margin-left:6px">${t('active_badge')}</span>` : ''}
          </div>
          <div class="team-sub">${jcLabel} ${t('scored')}</div>
        </div>
        <div class="team-score">
          <div class="big">${fmt(row.overallTotal, 1)}</div>
          <div class="small">/ ${template.totalMaxPoints} ${t('total_pts')}</div>
        </div>
      </div>
      <div class="team-details">
        <h3 style="margin-top:0">${t('section_subtotals')}</h3>
        <div class="criteria-list">${sectionRows}</div>
        <h3>${t('per_judge')}</h3>
        <div class="judges-list">${judgeRows}</div>
      </div>
    </div>
  `;
}

// =============== RACE TAB ===============
function renderRace() {
  const host = document.getElementById('tab-race');
  if (!state.activeHackathonId) return noHackathonSelected(host);

  if (!state.race || state.race.phases.length === 0 || state.race.allTeams.length === 0) {
    host.innerHTML = renderHackathonPicker() +
      `<div class="card"><div class="empty">${t('race_empty')}</div></div>`;
    wireHackathonPicker();
    return;
  }

  const { phases, allTeams } = state.race;
  const lastPhase = phases[phases.length - 1];
  const lastPhaseScores = new Map(lastPhase.teams.map(t => [t.teamId, t.total]));
  const teamOrder = [...allTeams].sort((a, b) => {
    const sa = lastPhaseScores.get(a.id);
    const sb = lastPhaseScores.get(b.id);
    if (sa != null && sb != null) return sb - sa;
    if (sa != null) return -1;
    if (sb != null) return 1;
    return a.name.localeCompare(b.name);
  });

  const lanes = phases.map((ph, pIdx) => {
    const byTeam = new Map(ph.teams.map(t => [t.teamId, t]));
    const isLast = pIdx === phases.length - 1;
    let winnerId = null;
    if (isLast && ph.teams.length > 0) {
      const withScores = ph.teams.filter(t => t.total != null);
      if (withScores.length) winnerId = withScores.reduce((a, b) => (b.total > a.total ? b : a)).teamId;
    }

    const cards = teamOrder.map(tm => {
      const entry = byTeam.get(tm.id);
      if (!entry) {
        return `<div class="race-card race-card-empty" title="${t('not_advanced')}">${escapeHtml(tm.name)}</div>`;
      }
      const cls = ['race-card',
        entry.total != null ? 'has-score' : '',
        winnerId === tm.id ? 'winner' : ''
      ].filter(Boolean).join(' ');
      const jc = entry.judgeCount;
      const jcLbl = jc === 1 ? t('judge_count_one', { n: jc }) : t('judge_count_many', { n: jc });
      return `
        <div class="${cls}">
          <div class="rc-name">${escapeHtml(tm.name)}</div>
          <div class="rc-score">${entry.total != null ? fmt(entry.total, 1) : '—'}</div>
          <div class="rc-sub">${jcLbl}</div>
          ${winnerId === tm.id ? `<div class="text-xs" style="font-weight:700;margin-top:2px">🏆 ${t('winner')}</div>` : ''}
        </div>
      `;
    }).join('');

    const subLabel = ph.effective_template_id
      ? (state.templates.find(tp => tp.id === ph.effective_template_id)?.name || '')
      : t('inherits_template');

    return `
      <div class="race-lane">
        <div class="race-lane-label">
          <div>${escapeHtml(ph.name)}</div>
          <div class="sub">${escapeHtml(subLabel)}</div>
        </div>
        <div class="race-lane-track">${cards}</div>
      </div>
    `;
  }).join('');

  host.innerHTML = renderHackathonPicker() + `
    <div class="card">
      <h2 style="margin-top:0">${t('race_title')}</h2>
      <p class="text-xs text-muted">${t('race_subtitle')}</p>
      <div class="race-container">
        <div class="race-lanes">${lanes}</div>
      </div>
    </div>
  `;
  wireHackathonPicker();
}

// =============== PHASES TAB ===============
function renderPhases() {
  const host = document.getElementById('tab-phases');
  if (!state.activeHackathonId) return noHackathonSelected(host);

  host.innerHTML = renderHackathonPicker() + `
    <div class="card">
      <h2>${t('add_phase')}</h2>
      <div class="form-row">
        <label>${t('phase_name')}</label>
        <input type="text" id="newPhaseName" placeholder="${t('phase_name_placeholder')}" />
      </div>
      <div class="form-row">
        <label>${t('phase_template')}</label>
        <select id="newPhaseTpl">
          <option value="">${t('none')}</option>
          ${state.templates.map(tp => `<option value="${tp.id}">${escapeHtml(tp.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-row">
        <label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer">
          <input type="checkbox" id="newPhaseSelfPaced" />
          <span>${t('self_paced')}</span>
        </label>
        <div class="text-xs text-muted" style="margin-top:4px">${t('self_paced_desc')}</div>
      </div>
      <button id="addPhaseBtn" class="btn-block">${t('create_phase')}</button>
    </div>
    <div class="card">
      <h2>${t('phases_count', { n: state.phases.length })}</h2>
      ${state.phases.length === 0
        ? `<div class="empty">${t('no_phases_yet')}</div>`
        : state.phases.map(renderPhaseItem).join('')}
    </div>
  `;
  wireHackathonPicker();

  document.getElementById('addPhaseBtn').addEventListener('click', async () => {
    const name = document.getElementById('newPhaseName').value.trim();
    const templateId = document.getElementById('newPhaseTpl').value || null;
    const selfPaced = document.getElementById('newPhaseSelfPaced').checked;
    if (!name) return showAlert(document.getElementById('alert'), t('team_name_required'));
    try {
      await api('/api/admin/phases', {
        method: 'POST',
        body: {
          hackathonId: state.activeHackathonId, name,
          templateId: templateId ? Number(templateId) : null,
          selfPaced,
        },
      });
      await refreshForActiveHackathon();
      renderPhases();
    } catch (e) { showAlert(document.getElementById('alert'), e.message); }
  });

  host.querySelectorAll('[data-edit-phase]').forEach(b => {
    b.addEventListener('click', () => document.getElementById(`phase-edit-${b.dataset.editPhase}`)?.classList.toggle('hidden'));
  });
  host.querySelectorAll('[data-del-phase]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm(t('confirm_delete_phase'))) return;
      try {
        await api(`/api/admin/phases/${b.dataset.delPhase}`, { method: 'DELETE' });
        await refreshForActiveHackathon();
        renderPhases();
      } catch (e) { showAlert(document.getElementById('alert'), e.message); }
    });
  });
  host.querySelectorAll('[data-save-phase]').forEach(b => {
    b.addEventListener('click', async () => {
      const pid = Number(b.dataset.savePhase);
      const nameInp = host.querySelector(`input[data-phase-name="${pid}"]`);
      const tplSel = host.querySelector(`select[data-phase-tpl="${pid}"]`);
      const spChk = host.querySelector(`input[data-phase-sp="${pid}"]`);
      try {
        await api(`/api/admin/phases/${pid}`, {
          method: 'PUT',
          body: {
            name: nameInp.value.trim(),
            templateId: tplSel.value ? Number(tplSel.value) : null,
            selfPaced: !!(spChk && spChk.checked),
          },
        });
      } catch (e) { showAlert(document.getElementById('alert'), e.message); return; }
      const checked = Array.from(host.querySelectorAll(`input[data-phase-team="${pid}"]:checked`)).map(i => Number(i.value));
      try {
        await api(`/api/admin/phases/${pid}/teams`, { method: 'PUT', body: { teamIds: checked } });
        await refreshForActiveHackathon();
        renderPhases();
      } catch (e) { showAlert(document.getElementById('alert'), e.message); }
    });
  });
}

function renderPhaseItem(p) {
  const templateName = p.template_id
    ? state.templates.find(tp => tp.id === p.template_id)?.name
    : (p.effective_template_id
        ? `↳ ${state.templates.find(tp => tp.id === p.effective_template_id)?.name || ''} (${t('inherits_template')})`
        : `— ${t('none')} —`);
  const modeBadge = p.self_paced
    ? `<span class="badge badge-accent" style="margin-left:6px">${t('self_paced_short')}</span>`
    : '';

  return `
    <div class="list-item" style="flex-direction:column;align-items:stretch;gap:10px">
      <div class="row-between">
        <div>
          <div class="name">${escapeHtml(p.name)}${modeBadge}</div>
          <div class="meta">${escapeHtml(templateName || '')}</div>
        </div>
        <div class="list-item-actions">
          <button class="btn-sm btn-secondary" data-edit-phase="${p.id}">${t('advance_teams')}</button>
          <button class="btn-sm btn-danger" data-del-phase="${p.id}">${t('delete')}</button>
        </div>
      </div>
      <div class="phase-edit hidden" id="phase-edit-${p.id}">
        <div class="form-row">
          <label>${t('phase_name')}</label>
          <input type="text" data-phase-name="${p.id}" value="${escapeHtml(p.name)}" />
        </div>
        <div class="form-row">
          <label>${t('phase_template')}</label>
          <select data-phase-tpl="${p.id}">
            <option value="">${t('none')}</option>
            ${state.templates.map(tp =>
              `<option value="${tp.id}" ${tp.id === p.template_id ? 'selected' : ''}>${escapeHtml(tp.name)}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-row">
          <label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer">
            <input type="checkbox" data-phase-sp="${p.id}" ${p.self_paced ? 'checked' : ''} />
            <span>${t('self_paced')}</span>
          </label>
          <div class="text-xs text-muted" style="margin-top:4px">${t('self_paced_desc')}</div>
        </div>
        <div class="form-row">
          <label>${t('teams_in_phase')}</label>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${state.teams.map(tm => `
              <label style="display:flex;align-items:center;gap:8px;font-weight:500">
                <input type="checkbox" data-phase-team="${p.id}" value="${tm.id}" ${p.teamIds.includes(tm.id) ? 'checked' : ''} />
                ${escapeHtml(tm.name)}
              </label>
            `).join('')}
          </div>
        </div>
        <button class="btn-block" data-save-phase="${p.id}">${t('save_phase_teams')}</button>
      </div>
    </div>
  `;
}

// =============== PANELS TAB (v4) ===============
// A panel = a named group of judges bound to a set of teams.
// Creating a panel is bulk: assign teams once, add judges to the panel,
// and every judge inherits the team access. Panels COEXIST with per-judge
// individual assignments (union semantics in the backend).
function renderPanels() {
  const host = document.getElementById('tab-panels');
  if (!state.activeHackathonId) return noHackathonSelected(host);

  const hackJudges = state.judges.filter(j => j.hackathonIds.includes(state.activeHackathonId));

  host.innerHTML = renderHackathonPicker() + `
    <div class="card">
      <h2>${t('new_panel')}</h2>
      <div class="form-row">
        <label>${t('panel_name')}</label>
        <input type="text" id="newPanelName" placeholder="${t('panel_name_placeholder')}" />
      </div>
      <div class="form-row">
        <label>${t('description_optional')}</label>
        <textarea id="newPanelDesc" placeholder="${t('description_placeholder')}"></textarea>
      </div>
      <button id="addPanelBtn" class="btn-block">${t('create_panel')}</button>
    </div>

    <div class="card">
      <h2>${t('panels_count', { n: state.panels.length })}</h2>
      ${state.panels.length === 0
        ? `<div class="empty">${t('no_panels_yet')}</div>`
        : state.panels.map(p => renderPanelItem(p, hackJudges)).join('')}
    </div>
  `;
  wireHackathonPicker();

  document.getElementById('addPanelBtn').addEventListener('click', async () => {
    const name = document.getElementById('newPanelName').value.trim();
    const description = document.getElementById('newPanelDesc').value.trim();
    if (!name) return showAlert(document.getElementById('alert'), t('all_fields_required'));
    try {
      await api('/api/admin/panels', {
        method: 'POST',
        body: { hackathonId: state.activeHackathonId, name, description },
      });
      await refreshForActiveHackathon();
      renderPanels();
    } catch (e) { showAlert(document.getElementById('alert'), e.message); }
  });

  host.querySelectorAll('[data-edit-panel]').forEach(b => {
    b.addEventListener('click', () => {
      const pid = Number(b.dataset.editPanel);
      const el = document.getElementById(`panel-edit-${pid}`);
      if (!el) return;
      el.classList.toggle('hidden');
      if (!el.classList.contains('hidden')) state.expandedPanels.add(pid);
      else state.expandedPanels.delete(pid);
    });
  });

  host.querySelectorAll('[data-del-panel]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm(t('confirm_delete_panel'))) return;
      try {
        await api(`/api/admin/panels/${b.dataset.delPanel}`, { method: 'DELETE' });
        state.expandedPanels.delete(Number(b.dataset.delPanel));
        await refreshForActiveHackathon();
        renderPanels();
      } catch (e) { showAlert(document.getElementById('alert'), e.message); }
    });
  });

  host.querySelectorAll('[data-save-panel-teams]').forEach(b => {
    b.addEventListener('click', async () => {
      const pid = Number(b.dataset.savePanelTeams);
      const teamIds = Array.from(host.querySelectorAll(`input[data-panel-team="${pid}"]:checked`))
        .map(i => Number(i.value));
      // also save name/description
      const nameInp = host.querySelector(`input[data-panel-name="${pid}"]`);
      const descInp = host.querySelector(`textarea[data-panel-desc="${pid}"]`);
      try {
        if (nameInp) {
          await api(`/api/admin/panels/${pid}`, {
            method: 'PUT',
            body: { name: nameInp.value.trim(), description: descInp ? descInp.value.trim() : null },
          });
        }
        await api(`/api/admin/panels/${pid}/teams`, { method: 'PUT', body: { teamIds } });
        await refreshForActiveHackathon();
        renderPanels();
        showAlert(document.getElementById('alert'), t('password_updated'), 'success');
      } catch (e) { showAlert(document.getElementById('alert'), e.message); }
    });
  });

  host.querySelectorAll('[data-save-panel-judges]').forEach(b => {
    b.addEventListener('click', async () => {
      const pid = Number(b.dataset.savePanelJudges);
      const judgeIds = Array.from(host.querySelectorAll(`input[data-panel-judge="${pid}"]:checked`))
        .map(i => Number(i.value));
      try {
        await api(`/api/admin/panels/${pid}/judges`, { method: 'PUT', body: { judgeIds } });
        await refreshAll();             // judges' hackathonIds may have been updated server-side
        await refreshForActiveHackathon();
        renderPanels();
        showAlert(document.getElementById('alert'), t('password_updated'), 'success');
      } catch (e) { showAlert(document.getElementById('alert'), e.message); }
    });
  });
}

function renderPanelItem(panel, hackJudges) {
  const expanded = state.expandedPanels.has(panel.id);
  const summary = t('panel_summary', { t: panel.teamIds.length, j: panel.judgeIds.length });
  const teamNames = panel.teamIds
    .map(tid => state.teams.find(x => x.id === tid)?.name).filter(Boolean);
  const judgeNames = panel.judgeIds
    .map(jid => state.judges.find(x => x.id === jid)?.name).filter(Boolean);

  return `
    <div class="list-item" style="flex-direction:column;align-items:stretch;gap:10px">
      <div class="row-between">
        <div style="min-width:0;flex:1">
          <div class="name">${escapeHtml(panel.name)}</div>
          <div class="meta">${summary}</div>
          ${teamNames.length ? `<div class="text-xs text-muted" style="margin-top:4px">${t('panel_teams_label')}: ${teamNames.map(escapeHtml).join(', ')}</div>` : ''}
          ${judgeNames.length ? `<div class="text-xs text-muted">${t('panel_judges_label')}: ${judgeNames.map(escapeHtml).join(', ')}</div>` : ''}
        </div>
        <div class="list-item-actions">
          <button class="btn-sm btn-secondary" data-edit-panel="${panel.id}">${t('edit_panel')}</button>
          <button class="btn-sm btn-danger" data-del-panel="${panel.id}">${t('delete')}</button>
        </div>
      </div>
      <div class="phase-edit ${expanded ? '' : 'hidden'}" id="panel-edit-${panel.id}">
        <div class="form-row">
          <label>${t('panel_name')}</label>
          <input type="text" data-panel-name="${panel.id}" value="${escapeHtml(panel.name)}" />
        </div>
        <div class="form-row">
          <label>${t('description_optional')}</label>
          <textarea data-panel-desc="${panel.id}">${escapeHtml(panel.description || '')}</textarea>
        </div>
        <div class="form-row">
          <label>${t('panel_teams_label')}</label>
          ${state.teams.length === 0
            ? `<div class="text-xs text-muted">${t('no_teams_yet')}</div>`
            : `<div style="display:flex;flex-direction:column;gap:6px">
                ${state.teams.map(tm => `
                  <label style="display:flex;align-items:center;gap:8px;font-weight:500">
                    <input type="checkbox" data-panel-team="${panel.id}" value="${tm.id}" ${panel.teamIds.includes(tm.id) ? 'checked' : ''} />
                    ${escapeHtml(tm.name)}
                  </label>
                `).join('')}
              </div>`}
        </div>
        <button class="btn-block" data-save-panel-teams="${panel.id}">${t('save_panel_teams')}</button>

        <div class="form-row" style="margin-top:14px">
          <label>${t('panel_judges_label')}</label>
          ${hackJudges.length === 0
            ? `<div class="text-xs text-muted">${t('no_judges_yet')}</div>`
            : `<div style="display:flex;flex-direction:column;gap:6px">
                ${hackJudges.map(j => `
                  <label style="display:flex;align-items:center;gap:8px;font-weight:500">
                    <input type="checkbox" data-panel-judge="${panel.id}" value="${j.id}" ${panel.judgeIds.includes(j.id) ? 'checked' : ''} />
                    ${escapeHtml(j.name)} <span class="text-xs text-muted">@${escapeHtml(j.username)}</span>
                  </label>
                `).join('')}
              </div>`}
        </div>
        <button class="btn-block" data-save-panel-judges="${panel.id}">${t('save_panel_judges')}</button>
      </div>
    </div>
  `;
}

// =============== TEAMS TAB ===============
function renderTeams() {
  const host = document.getElementById('tab-teams');
  if (!state.activeHackathonId) return noHackathonSelected(host);

  host.innerHTML = renderHackathonPicker() + `
    <div class="card">
      <h2>${t('add_team')}</h2>
      <div class="form-row">
        <label>${t('team_name')}</label>
        <input type="text" id="newTeamName" placeholder="${t('team_name_placeholder')}" />
      </div>
      <div class="form-row">
        <label>${t('description_optional')}</label>
        <textarea id="newTeamDesc" placeholder="${t('description_placeholder')}"></textarea>
      </div>
      <button id="addTeamBtn" class="btn-block">${t('add_team')}</button>
    </div>
    <div class="card">
      <h2>${t('teams_count', { n: state.teams.length })}</h2>
      ${state.teams.length === 0
        ? `<div class="empty">${t('no_teams_yet')}</div>`
        : state.teams.map(tm => `
          <div class="list-item">
            <div style="min-width:0;flex:1">
              <div class="name">${escapeHtml(tm.name)}</div>
              ${tm.description ? `<div class="meta" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(tm.description)}</div>` : ''}
            </div>
            <div class="list-item-actions">
              <button class="btn-sm btn-danger" data-del-team="${tm.id}">${t('delete')}</button>
            </div>
          </div>
        `).join('')}
    </div>
  `;
  wireHackathonPicker();

  document.getElementById('addTeamBtn').addEventListener('click', async () => {
    const name = document.getElementById('newTeamName').value.trim();
    const description = document.getElementById('newTeamDesc').value.trim();
    if (!name) return showAlert(document.getElementById('alert'), t('team_name_required'));
    try {
      await api('/api/admin/teams', {
        method: 'POST',
        body: { hackathonId: state.activeHackathonId, name, description },
      });
      await refreshForActiveHackathon();
      renderTeams();
    } catch (e) { showAlert(document.getElementById('alert'), e.message); }
  });

  host.querySelectorAll('[data-del-team]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm(t('confirm_delete_team'))) return;
      try {
        await api(`/api/admin/teams/${b.dataset.delTeam}`, { method: 'DELETE' });
        await refreshForActiveHackathon();
        renderTeams();
      } catch (e) { showAlert(document.getElementById('alert'), e.message); }
    });
  });
}

// =============== TEMPLATES TAB ===============
function blankCriterion() {
  return {
    label: '',
    max_points: 10,
    levels: [
      { label: 'Elemental',     minPoints: 1, maxPoints: 3,  description: '' },
      { label: 'En desarrollo', minPoints: 4, maxPoints: 5,  description: '' },
      { label: 'Esperado',      minPoints: 6, maxPoints: 8,  description: '' },
      { label: 'Avanzado',      minPoints: 9, maxPoints: 10, description: '' },
    ],
  };
}
function blankDraft() {
  return { name: '', kind: 'rubric', sections: [{ name: '', criteria: [blankCriterion()] }] };
}

function renderTemplates() {
  const host = document.getElementById('tab-templates');
  if (!state.activeHackathonId) return noHackathonSelected(host);
  if (!state.criteriaDraft) state.criteriaDraft = blankDraft();
  const draft = state.criteriaDraft;

  host.innerHTML = renderHackathonPicker() + `
    <div class="card">
      <h2>${t('new_template')}</h2>
      <div class="form-row">
        <label>${t('template_name')}</label>
        <input type="text" id="tplName" placeholder="${t('template_name_placeholder')}" value="${escapeHtml(draft.name)}" />
      </div>
      <div class="form-row">
        <label>${t('template_kind')}</label>
        <select id="tplKind">
          <option value="rubric" ${draft.kind === 'rubric' ? 'selected' : ''}>${t('kind_rubric')}</option>
          <option value="simple" ${draft.kind === 'simple' ? 'selected' : ''}>${t('kind_simple')}</option>
        </select>
      </div>
      <div id="sectionsEditor"></div>
      <button id="addSectionBtn" class="btn-secondary btn-sm" type="button" style="margin-top:8px">${t('add_section')}</button>
      <button id="createTplBtn" class="btn-block" style="margin-top:14px">${t('create_template')}</button>
    </div>

    <div class="card">
      <h2>${t('templates_count', { n: state.templates.length })}</h2>
      ${state.templates.length === 0
        ? `<div class="empty">${t('no_templates_yet')}</div>`
        : state.templates.map(renderTemplateListItem).join('')}
    </div>
  `;
  wireHackathonPicker();

  document.getElementById('tplName').addEventListener('input', (e) => { state.criteriaDraft.name = e.target.value; });
  document.getElementById('tplKind').addEventListener('change', (e) => { state.criteriaDraft.kind = e.target.value; renderSectionsEditor(); });
  document.getElementById('addSectionBtn').addEventListener('click', () => {
    state.criteriaDraft.sections.push({ name: '', criteria: [blankCriterion()] });
    renderSectionsEditor();
  });
  document.getElementById('createTplBtn').addEventListener('click', createTemplateFromDraft);

  host.querySelectorAll('[data-del-tpl]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm(t('confirm_delete_template'))) return;
      try {
        await api(`/api/admin/templates/${b.dataset.delTpl}`, { method: 'DELETE' });
        await refreshForActiveHackathon();
        renderTemplates();
      } catch (e) { showAlert(document.getElementById('alert'), e.message); }
    });
  });

  renderSectionsEditor();
}

function renderTemplateListItem(tp) {
  const sections = tp.sections.map(s => `${escapeHtml(s.name)} (${s.criteria.length})`).join(' · ');
  return `
    <div class="list-item" style="align-items:flex-start;flex-direction:column;gap:8px">
      <div class="row-between" style="width:100%">
        <div>
          <div class="name">${escapeHtml(tp.name)}</div>
          <div class="text-xs text-muted">${t('template_total', { n: tp.totalMaxPoints })}</div>
        </div>
        <button class="btn-sm btn-danger" data-del-tpl="${tp.id}">${t('delete')}</button>
      </div>
      <div class="text-xs text-muted" style="width:100%">${sections}</div>
    </div>
  `;
}

function renderSectionsEditor() {
  const draft = state.criteriaDraft;
  const host = document.getElementById('sectionsEditor');
  host.innerHTML = draft.sections.map((sec, si) => `
    <div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--surface-2)">
      <div class="row-between mb-1">
        <input type="text" data-sec-name="${si}" placeholder="${t('section_name')}" value="${escapeHtml(sec.name)}" style="flex:1;margin-right:8px" />
        <button class="remove-crit" type="button" data-rm-sec="${si}" ${draft.sections.length === 1 ? 'disabled' : ''}>×</button>
      </div>
      <div data-crit-list="${si}">
        ${sec.criteria.map((c, ci) => renderCriterionEditor(si, ci, c, draft.kind)).join('')}
      </div>
      <button class="btn-secondary btn-sm" type="button" data-add-crit="${si}" style="margin-top:6px">${t('add_criterion')}</button>
    </div>
  `).join('');

  host.querySelectorAll('[data-sec-name]').forEach(inp =>
    inp.addEventListener('input', () => { draft.sections[Number(inp.dataset.secName)].name = inp.value; }));
  host.querySelectorAll('[data-rm-sec]').forEach(btn =>
    btn.addEventListener('click', () => {
      const si = Number(btn.dataset.rmSec);
      draft.sections.splice(si, 1);
      if (!draft.sections.length) draft.sections.push({ name: '', criteria: [blankCriterion()] });
      renderSectionsEditor();
    }));
  host.querySelectorAll('[data-add-crit]').forEach(btn =>
    btn.addEventListener('click', () => {
      const si = Number(btn.dataset.addCrit);
      draft.sections[si].criteria.push(draft.kind === 'rubric' ? blankCriterion() : { label: '', max_points: 10, levels: [] });
      renderSectionsEditor();
    }));

  wireCriterionEditors();
}

function renderCriterionEditor(si, ci, c, kind) {
  const totalFromLevels = (c.levels || []).reduce((m, lv) => Math.max(m, Number(lv.maxPoints) || 0), 0);
  const max = kind === 'rubric' ? (totalFromLevels || c.max_points || 10) : (c.max_points || 10);
  return `
    <div style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;background:var(--surface)">
      <div class="row-between mb-1">
        <input type="text" data-crit-label="${si}.${ci}" placeholder="${t('criterion_label')}" value="${escapeHtml(c.label)}" style="flex:1;margin-right:6px" />
        <button class="remove-crit" type="button" data-rm-crit="${si}.${ci}">×</button>
      </div>
      ${kind === 'simple' ? `
        <div class="form-row" style="margin:0">
          <label style="font-size:.75rem">${t('criterion_max')}</label>
          <input type="number" data-crit-max="${si}.${ci}" min="1" value="${max}" />
        </div>
      ` : `
        <div class="text-xs text-muted mb-1">${t('rubric_levels')} (${t('criterion_max')}: ${max})</div>
        ${(c.levels || []).map((lv, li) => `
          <div style="display:grid;grid-template-columns:1fr 55px 55px 32px;gap:4px;margin-bottom:3px">
            <input type="text" data-lv-label="${si}.${ci}.${li}" placeholder="${t('level_label')}" value="${escapeHtml(lv.label)}" />
            <input type="number" data-lv-min="${si}.${ci}.${li}" min="0" placeholder="${t('level_min')}" value="${lv.minPoints}" title="${t('level_min')}" />
            <input type="number" data-lv-max="${si}.${ci}.${li}" min="0" placeholder="${t('level_max')}" value="${lv.maxPoints}" title="${t('level_max')}" />
            <button class="remove-crit" type="button" data-rm-lv="${si}.${ci}.${li}" ${(c.levels || []).length <= 1 ? 'disabled' : ''}>×</button>
            <textarea data-lv-desc="${si}.${ci}.${li}" placeholder="${t('level_description')}" class="level-desc-input" style="grid-column:1/-1;margin-top:2px;font-size:.8rem;min-height:36px;padding:4px 6px">${escapeHtml(lv.description || '')}</textarea>
          </div>
        `).join('')}
        <button class="btn-secondary btn-sm" type="button" data-add-lv="${si}.${ci}" style="margin-top:4px">${t('add_level')}</button>
      `}
    </div>
  `;
}

const parsePath = (p) => p.split('.').map(Number);
const camel = (kebab) => kebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function wireCriterionEditors() {
  const draft = state.criteriaDraft;
  const host = document.getElementById('sectionsEditor');

  host.querySelectorAll('[data-crit-label]').forEach(inp =>
    inp.addEventListener('input', () => {
      const [si, ci] = parsePath(inp.dataset.critLabel);
      draft.sections[si].criteria[ci].label = inp.value;
    }));
  host.querySelectorAll('[data-crit-max]').forEach(inp =>
    inp.addEventListener('input', () => {
      const [si, ci] = parsePath(inp.dataset.critMax);
      draft.sections[si].criteria[ci].max_points = Number(inp.value) || 0;
    }));
  host.querySelectorAll('[data-rm-crit]').forEach(btn =>
    btn.addEventListener('click', () => {
      const [si, ci] = parsePath(btn.dataset.rmCrit);
      draft.sections[si].criteria.splice(ci, 1);
      if (!draft.sections[si].criteria.length) {
        draft.sections[si].criteria.push(draft.kind === 'rubric' ? blankCriterion() : { label: '', max_points: 10, levels: [] });
      }
      renderSectionsEditor();
    }));
  host.querySelectorAll('[data-add-lv]').forEach(btn =>
    btn.addEventListener('click', () => {
      const [si, ci] = parsePath(btn.dataset.addLv);
      const existing = draft.sections[si].criteria[ci].levels;
      const nextMin = existing.length ? (existing[existing.length - 1].maxPoints + 1) : 1;
      existing.push({ label: '', minPoints: nextMin, maxPoints: nextMin, description: '' });
      renderSectionsEditor();
    }));
  host.querySelectorAll('[data-rm-lv]').forEach(btn =>
    btn.addEventListener('click', () => {
      const [si, ci, li] = parsePath(btn.dataset.rmLv);
      draft.sections[si].criteria[ci].levels.splice(li, 1);
      renderSectionsEditor();
    }));
  ['lv-label', 'lv-min', 'lv-max', 'lv-desc'].forEach(attr =>
    host.querySelectorAll(`[data-${attr}]`).forEach(inp =>
      inp.addEventListener('input', () => {
        const [si, ci, li] = parsePath(inp.dataset[camel(attr)]);
        const lv = draft.sections[si].criteria[ci].levels[li];
        if (attr === 'lv-label') lv.label = inp.value;
        else if (attr === 'lv-min') lv.minPoints = Number(inp.value) || 0;
        else if (attr === 'lv-max') lv.maxPoints = Number(inp.value) || 0;
        else if (attr === 'lv-desc') lv.description = inp.value;
      })));
}

async function createTemplateFromDraft() {
  const alertBox = document.getElementById('alert');
  const draft = state.criteriaDraft;
  if (!draft.name.trim()) return showAlert(alertBox, t('template_name_required'));
  if (!draft.sections.length) return showAlert(alertBox, t('at_least_one_section'));

  const cleanedSections = [];
  for (const sec of draft.sections) {
    if (!sec.name.trim()) return showAlert(alertBox, t('at_least_one_section'));
    const criteria = sec.criteria
      .filter(c => c.label.trim())
      .map(c => ({
        label: c.label.trim(),
        maxPoints: draft.kind === 'rubric'
          ? (c.levels || []).reduce((m, lv) => Math.max(m, Number(lv.maxPoints) || 0), 0)
          : Number(c.max_points) || 10,
        levels: draft.kind === 'rubric'
          ? (c.levels || []).map(lv => ({
              label: lv.label.trim(),
              minPoints: Number(lv.minPoints) || 0,
              maxPoints: Number(lv.maxPoints) || 0,
              description: lv.description || null,
            }))
          : [],
      }));
    if (!criteria.length) return showAlert(alertBox, t('at_least_one_criterion'));
    cleanedSections.push({ name: sec.name.trim(), criteria });
  }
  try {
    await api('/api/admin/templates', {
      method: 'POST',
      body: {
        hackathonId: state.activeHackathonId,
        name: draft.name.trim(), kind: draft.kind, sections: cleanedSections,
      },
    });
    await refreshForActiveHackathon();
    state.criteriaDraft = blankDraft();
    renderTemplates();
  } catch (e) { showAlert(alertBox, e.message); }
}

// =============== JUDGES TAB ===============
// Layout: "Create judge" card, then for EACH hackathon — list of judges in it with their team assignments.
function renderJudges() {
  const host = document.getElementById('tab-judges');

  host.innerHTML = `
    <div class="card">
      <h2>${t('add_judge')}</h2>
      <div class="form-row">
        <label>${t('full_name')}</label>
        <input type="text" id="newJudgeName" />
      </div>
      <div class="form-row">
        <label>${t('username')}</label>
        <input type="text" id="newJudgeUser" autocapitalize="off" autocorrect="off" />
      </div>
      <div class="form-row">
        <label>${t('password')}</label>
        <input type="text" id="newJudgePass" placeholder="${t('password_placeholder')}" />
        <div class="text-xs text-muted mt-1">${t('share_credentials')}</div>
      </div>
      ${state.hackathons.length > 0 ? `
        <div class="form-row">
          <label>${t('judge_hackathons')}</label>
          <div style="display:flex;flex-direction:column;gap:4px">
            ${state.hackathons.map(h => `
              <label style="display:flex;align-items:center;gap:8px;font-weight:500">
                <input type="checkbox" data-new-judge-hack="${h.id}"
                  ${h.id === state.activeHackathonId ? 'checked' : ''} />
                ${escapeHtml(h.name)}
              </label>
            `).join('')}
          </div>
        </div>
      ` : ''}
      <button id="addJudgeBtn" class="btn-block">${t('create_judge')}</button>
    </div>

    <div class="card">
      <h2>${t('judges_count', { n: state.judges.length })}</h2>
      ${state.judges.length === 0
        ? `<div class="empty">${t('no_judges_yet')}</div>`
        : state.judges.map(renderJudgeItem).join('')}
    </div>

    ${state.activeHackathonId && state.teams.length > 0 && state.judges.some(j => j.hackathonIds.includes(state.activeHackathonId)) ? `
      <div class="card">
        <h2>${t('auto_split')}</h2>
        <p class="text-xs text-muted">${t('auto_split_desc')}</p>
        <div class="form-row">
          <label>${t('overlap')}</label>
          <input type="number" id="overlapInput" min="1" max="10" value="${state.autoSplitOverlap}" />
        </div>
        <button id="runAutoSplitBtn" class="btn-block btn-secondary">${t('run_auto_split')}</button>
      </div>
    ` : ''}
  `;

  document.getElementById('addJudgeBtn').addEventListener('click', async () => {
    const name = document.getElementById('newJudgeName').value.trim();
    const username = document.getElementById('newJudgeUser').value.trim();
    const password = document.getElementById('newJudgePass').value;
    if (!name || !username || !password) return showAlert(document.getElementById('alert'), t('all_fields_required'));
    const hackathonIds = Array.from(host.querySelectorAll('[data-new-judge-hack]:checked')).map(c => Number(c.value));
    try {
      await api('/api/admin/judges', { method: 'POST', body: { name, username, password, hackathonIds } });
      await refreshAll();
      await refreshForActiveHackathon();
      renderJudges();
      showAlert(document.getElementById('alert'), t('judge_created', { u: username, p: password }), 'success');
    } catch (e) { showAlert(document.getElementById('alert'), e.message); }
  });

  host.querySelectorAll('[data-del-judge]').forEach(b => {
    b.addEventListener('click', async () => {
      if (!confirm(t('confirm_delete_judge'))) return;
      try {
        await api(`/api/admin/judges/${b.dataset.delJudge}`, { method: 'DELETE' });
        await refreshAll();
        renderJudges();
      } catch (e) { showAlert(document.getElementById('alert'), e.message); }
    });
  });

  host.querySelectorAll('[data-edit-judge]').forEach(b => {
    b.addEventListener('click', () => {
      const jid = b.dataset.editJudge;
      document.getElementById(`judge-edit-${jid}`)?.classList.toggle('hidden');
    });
  });

  host.querySelectorAll('[data-save-judge-hackathons]').forEach(b => {
    b.addEventListener('click', async () => {
      const jid = Number(b.dataset.saveJudgeHackathons);
      const checked = Array.from(host.querySelectorAll(`input[data-judge-hack="${jid}"]:checked`)).map(i => Number(i.value));
      try {
        await api(`/api/admin/judges/${jid}/hackathons`, { method: 'PUT', body: { hackathonIds: checked } });
        await refreshAll();
        renderJudges();
        showAlert(document.getElementById('alert'), t('password_updated'), 'success');
      } catch (e) { showAlert(document.getElementById('alert'), e.message); }
    });
  });

  host.querySelectorAll('[data-save-judge-teams]').forEach(b => {
    b.addEventListener('click', async () => {
      const [jid, hid] = b.dataset.saveJudgeTeams.split(':').map(Number);
      const checked = Array.from(host.querySelectorAll(`input[data-judge-team="${jid}:${hid}"]:checked`)).map(i => Number(i.value));
      try {
        await api(`/api/admin/judges/${jid}/teams`, {
          method: 'PUT', body: { hackathonId: hid, teamIds: checked },
        });
        await refreshAll();
        renderJudges();
        showAlert(document.getElementById('alert'), t('password_updated'), 'success');
      } catch (e) { showAlert(document.getElementById('alert'), e.message); }
    });
  });

  const autoSplitBtn = document.getElementById('runAutoSplitBtn');
  if (autoSplitBtn) {
    autoSplitBtn.addEventListener('click', async () => {
      const overlap = Number(document.getElementById('overlapInput').value) || 1;
      state.autoSplitOverlap = overlap;
      try {
        await api(`/api/admin/hackathons/${state.activeHackathonId}/auto-split`, {
          method: 'POST', body: { overlap },
        });
        await refreshAll();
        const n = state.judges.filter(j => j.hackathonIds.includes(state.activeHackathonId)).length;
        renderJudges();
        showAlert(document.getElementById('alert'), t('auto_split_done', { n }), 'success');
      } catch (e) { showAlert(document.getElementById('alert'), e.message); }
    });
  }
}

function renderJudgeItem(j) {
  const jid = j.id;
  const hackList = j.hackathonIds
    .map(hid => state.hackathons.find(h => h.id === hid)?.name)
    .filter(Boolean);

  return `
    <div class="list-item" style="flex-direction:column;align-items:stretch;gap:8px">
      <div class="row-between">
        <div style="min-width:0;flex:1">
          <div class="name">${escapeHtml(j.name)}</div>
          <div class="meta">@${escapeHtml(j.username)}${hackList.length ? ` · ${hackList.map(escapeHtml).join(', ')}` : ''}</div>
        </div>
        <div class="list-item-actions">
          <button class="btn-sm btn-secondary" data-edit-judge="${jid}">${t('edit_assignments')}</button>
          <button class="btn-sm btn-danger" data-del-judge="${jid}">${t('delete')}</button>
        </div>
      </div>

      <div class="hidden" id="judge-edit-${jid}">
        <div style="border-top:1px solid var(--border);padding-top:10px">
          <div class="form-row">
            <label>${t('judge_hackathons')}</label>
            <div style="display:flex;flex-direction:column;gap:4px">
              ${state.hackathons.map(h => `
                <label style="display:flex;align-items:center;gap:8px;font-weight:500">
                  <input type="checkbox" data-judge-hack="${jid}" value="${h.id}" ${j.hackathonIds.includes(h.id) ? 'checked' : ''} />
                  ${escapeHtml(h.name)}
                </label>
              `).join('')}
            </div>
          </div>
          <button class="btn-sm btn-block" data-save-judge-hackathons="${jid}">${t('save_assignments')}</button>

          ${j.hackathonIds.includes(state.activeHackathonId) && state.teams.length > 0 ? `
            <div class="form-row" style="margin-top:14px">
              <label>${t('judge_teams')} — ${escapeHtml(state.hackathons.find(h => h.id === state.activeHackathonId)?.name || '')}</label>
              <div class="text-xs text-muted mb-1">${t('all_teams')}: ${t('no_assignments_all_teams')}</div>
              <div id="judge-teams-${jid}" style="display:flex;flex-direction:column;gap:4px">
                ${renderJudgeTeamCheckboxes(jid, state.activeHackathonId)}
              </div>
            </div>
            <button class="btn-sm btn-block" data-save-judge-teams="${jid}:${state.activeHackathonId}">${t('save_assignments')}</button>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderJudgeTeamCheckboxes(judgeId, hackathonId) {
  // We don't prefetch every judge's team assignments; render a loading slot and load on expand.
  // For MVP: render empty, fetched async.
  const key = `judge-teams-${judgeId}`;
  // Async load
  setTimeout(async () => {
    try {
      const data = await api(`/api/admin/judges/${judgeId}/teams?hackathonId=${hackathonId}`);
      const assigned = new Set(data.teamIds || []);
      const container = document.getElementById(key);
      if (!container) return;
      container.innerHTML = state.teams.map(tm => `
        <label style="display:flex;align-items:center;gap:8px;font-weight:500">
          <input type="checkbox" data-judge-team="${judgeId}:${hackathonId}" value="${tm.id}" ${assigned.has(tm.id) ? 'checked' : ''} />
          ${escapeHtml(tm.name)}
        </label>
      `).join('');
    } catch (e) { /* silent */ }
  }, 0);
  return `<div class="text-xs text-muted">…</div>`;
}

// =============== SETTINGS TAB ===============
function renderSettings() {
  const host = document.getElementById('tab-settings');
  host.innerHTML = `
    <div class="card">
      <h2>${t('change_password')}</h2>
      <div class="form-row">
        <label>${t('current_password')}</label>
        <input type="password" id="curPass" />
      </div>
      <div class="form-row">
        <label>${t('new_password')}</label>
        <input type="password" id="newPass" />
      </div>
      <button id="changePassBtn" class="btn-block">${t('update_password')}</button>
    </div>
  `;
  document.getElementById('changePassBtn').addEventListener('click', async () => {
    const currentPassword = document.getElementById('curPass').value;
    const newPassword = document.getElementById('newPass').value;
    try {
      await api('/api/auth/change-password', {
        method: 'POST', body: { currentPassword, newPassword },
      });
      document.getElementById('curPass').value = '';
      document.getElementById('newPass').value = '';
      showAlert(document.getElementById('alert'), t('password_updated'), 'success');
    } catch (e) { showAlert(document.getElementById('alert'), e.message); }
  });
}
