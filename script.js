(function () {
  'use strict';

  const STORAGE_KEY = 'studyTrackerData';
  const SETTINGS_KEY = 'calismaTakipcisi_settings';

  const WEEKDAY_CHART = [
    { id: 'mon', short: 'Pzt', label: 'Pazartesi' },
    { id: 'tue', short: 'Sal', label: 'Salı' },
    { id: 'wed', short: 'Çar', label: 'Çarşamba' },
    { id: 'thu', short: 'Per', label: 'Perşembe' },
    { id: 'fri', short: 'Cum', label: 'Cuma' },
    { id: 'sat', short: 'Cmt', label: 'Cumartesi' },
    { id: 'sun', short: 'Paz', label: 'Pazar' }
  ];

  const storage = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }
  };

  const PERIODS = [
    { id: 'night', label: 'Gece (00-06)', start: 0, end: 6, color: '#6366f1' },
    { id: 'morning', label: 'Sabah (06-12)', start: 6, end: 12, color: '#00d4ff' },
    { id: 'afternoon', label: 'Öğleden Sonra (12-18)', start: 12, end: 18, color: '#a855f7' },
    { id: 'evening', label: 'Akşam (18-24)', start: 18, end: 24, color: '#22c55e' }
  ];

  const els = {
    timer: document.getElementById('timer'),
    timerWrapper: document.querySelector('.timer-wrapper'),
    dailyTotal: document.getElementById('dailyTotal'),
    sessionList: document.getElementById('sessionList'),
    btnStart: document.getElementById('btnStart'),
    btnStop: document.getElementById('btnStop'),
    btnReset: document.getElementById('btnReset'),
    btnSave: document.getElementById('btnSave'),
    modeChrono: document.getElementById('modeChrono'),
    modeCountdown: document.getElementById('modeCountdown'),
    countdownSetup: document.getElementById('countdownSetup'),
    countdownHours: document.getElementById('countdownHours'),
    countdownMinutes: document.getElementById('countdownMinutes'),
    tagInput: document.getElementById('tagInput'),
    breakDuration: document.getElementById('breakDuration'),
    btnBreakStart: document.getElementById('btnBreakStart'),
    btnBreakCancel: document.getElementById('btnBreakCancel'),
    sessionCount: document.getElementById('sessionCount'),
    toast: document.getElementById('toast'),
    toastMsg: document.getElementById('toastMsg'),
    toastUndo: document.getElementById('toastUndo'),
    chartCanvas: document.getElementById('periodChart'),
    chartLegend: document.getElementById('chartLegend'),
    libraryShelf: document.getElementById('libraryShelf'),
    libraryCount: document.getElementById('libraryCount')
  };

  let chart = null;
  let tickInterval = null;
  let toastTimeout = null;
  let undoBuffer = null;
  let historyArchive = {};

  let state = {
    date: getTodayKey(),
    sessions: [],
    active: {
      startTime: null,
      elapsedMs: 0,
      runningSince: null
    },
    breakActive: null,
    timerMode: 'chrono',
    countdown: createFreshCountdown()
  };

  let saveInProgress = false;

  function clampCountdownInputs() {
    const hours = Math.min(23, Math.max(0, Math.round(Number(els.countdownHours.value) || 0)));
    let minutes = Math.min(59, Math.max(0, Math.round(Number(els.countdownMinutes.value) || 0)));
    if (hours === 0 && minutes === 0) minutes = 1;
    els.countdownHours.value = String(hours);
    els.countdownMinutes.value = String(minutes);
    return { hours, minutes };
  }

  function getCountdownTotalMs() {
    const { hours, minutes } = clampCountdownInputs();
    return (hours * 60 + minutes) * 60 * 1000;
  }

  function createFreshCountdown() {
    const totalMs = getCountdownTotalMs();
    return {
      totalMs,
      remainingMs: totalMs,
      runningSince: null,
      startTime: null
    };
  }

  function isBreakSession(session) {
    return session.type === 'break';
  }

  function isStudySession(session) {
    return !isBreakSession(session);
  }

  function isBreakRunning() {
    return state.breakActive !== null;
  }

  function createSessionId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function ensureSessionIds() {
    let migrated = false;
    state.sessions.forEach(session => {
      if (!session.id) {
        session.id = createSessionId();
        migrated = true;
      }
    });
    if (migrated) saveState();
  }

  function getTodayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function formatClock(date) {
    const h = String(date.getHours()).padStart(2, '0');
    const m = String(date.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function isCountdownMode() {
    return state.timerMode === 'countdown';
  }

  function isChronoMode() {
    return state.timerMode === 'chrono';
  }

  function getCountdownRemainingMs() {
    let remaining = state.countdown.remainingMs;
    if (state.countdown.runningSince) {
      remaining -= Date.now() - state.countdown.runningSince;
    }
    return Math.max(0, remaining);
  }

  function getCountdownElapsedMs() {
    return Math.max(0, state.countdown.totalMs - getCountdownRemainingMs());
  }

  function loadSettings() {
    try {
      const raw = storage.get(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Number.isFinite(parsed.countdownHours)) {
        els.countdownHours.value = String(Math.min(23, Math.max(0, Math.round(parsed.countdownHours))));
      }
      if (Number.isFinite(parsed.countdownHours) && Number.isFinite(parsed.countdownMinutes)) {
        els.countdownMinutes.value = String(Math.min(59, Math.max(0, Math.round(parsed.countdownMinutes))));
      } else if (Number.isFinite(parsed.countdownMinutes)) {
        const total = Math.max(1, Math.round(parsed.countdownMinutes));
        els.countdownHours.value = String(Math.min(23, Math.floor(total / 60)));
        els.countdownMinutes.value = String(Math.min(59, total % 60));
      }
      clampCountdownInputs();
      if (parsed.timerMode === 'countdown' || parsed.timerMode === 'pomodoro') {
        state.timerMode = 'countdown';
      } else if (parsed.timerMode === 'chrono') {
        state.timerMode = 'chrono';
      }
    } catch {
      /* ignore */
    }
  }

  function saveSettings() {
    const { hours, minutes } = clampCountdownInputs();
    storage.set(SETTINGS_KEY, JSON.stringify({
      timerMode: state.timerMode,
      countdownHours: hours,
      countdownMinutes: minutes
    }));
  }

  function buildSessionLabel() {
    return els.tagInput.value.trim();
  }

  function applyCountdownDurationInput() {
    clampCountdownInputs();
    if (isCountdownMode() && !state.countdown.runningSince) {
      state.countdown = createFreshCountdown();
      saveState();
      renderTimer();
      updateButtons();
    }
    saveSettings();
  }

  function repairCountdownState() {
    if (!isCountdownMode()) return;
    if (state.countdown.runningSince) return;
    if (state.countdown.remainingMs <= 0 || state.countdown.remainingMs > state.countdown.totalMs) {
      state.countdown = createFreshCountdown();
    }
  }

  function playTimerDoneTone() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 520;
      gain.gain.value = 0.04;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
      setTimeout(() => ctx.close(), 400);
    } catch {
      /* ignore */
    }
  }

  function notifyTimerDone(message) {
    playTimerDoneTone();
    showUndoToast(message);
    undoBuffer = null;
  }

  function syncTimerModeUi() {
    const countdown = isCountdownMode();
    els.modeChrono.classList.toggle('is-active', !countdown);
    els.modeCountdown.classList.toggle('is-active', countdown);
    els.modeChrono.setAttribute('aria-selected', countdown ? 'false' : 'true');
    els.modeCountdown.setAttribute('aria-selected', countdown ? 'true' : 'false');
    els.countdownSetup.hidden = !countdown;
    els.timerWrapper.classList.toggle('countdown-mode', countdown);
  }

  function setTimerMode(mode) {
    if (mode !== 'chrono' && mode !== 'countdown') return;
    if (state.timerMode === mode) return;

    if (state.active.runningSince) handleStop();
    if (state.countdown.runningSince) pauseCountdown();

    state.timerMode = mode;
    if (mode === 'countdown') {
      state.countdown = createFreshCountdown();
    } else {
      state.active = { startTime: null, elapsedMs: 0, runningSince: null };
    }

    saveSettings();
    saveState();
    syncTimerModeUi();
    renderTimer();
    updateButtons();
    stopTicking();
  }

  function formatMinutesShort(minutes) {
    return `${Math.round(minutes)} dk`;
  }

  function formatMinutesLabel(minutes) {
    if (minutes < 1) return '1 Dakika';
    return `${Math.round(minutes)} Dakika`;
  }

  function formatSessionMeta(session) {
    if (isBreakSession(session)) {
      return {
        tag: 'Mola',
        duration: formatMinutesShort(session.durationMinutes)
      };
    }

    const duration = session.label
      ? formatMinutesShort(session.durationMinutes)
      : `Süre: ${formatMinutesLabel(session.durationMinutes)}`;

    if (session.label) {
      return { tag: session.label, duration };
    }
    return { tag: null, duration };
  }

  function formatTotalLabel(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    return `Bugün Toplam: ${hours} Saat ${mins} Dakika`;
  }

  function formatTotalShort(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const mins = Math.round(totalMinutes % 60);
    if (hours === 0) return `${mins} dk`;
    return `${hours}s ${mins}dk`;
  }

  function parseDateKey(dateKey) {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function formatDateKeyLabel(dateKey) {
    const todayDate = parseDateKey(getTodayKey());
    const date = parseDateKey(dateKey);
    const diffDays = Math.round((todayDate - date) / 86400000);

    if (diffDays === 1) return 'Dün';
    if (diffDays === 2) return 'Evvelsi Gün';

    return date.toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      weekday: 'short'
    });
  }

  function formatDateKeyFull(dateKey) {
    return parseDateKey(dateKey).toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      weekday: 'long'
    });
  }

  function getBreakTotalForSessions(sessions) {
    return sessions
      .filter(isBreakSession)
      .reduce((sum, session) => sum + session.durationMinutes, 0);
  }

  function createLibraryStatBox(label, value, modifier) {
    const box = document.createElement('div');
    box.className = 'library-stat-box' + (modifier ? ` ${modifier}` : '');

    const labelEl = document.createElement('span');
    labelEl.className = 'library-stat-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('span');
    valueEl.className = 'library-stat-value';
    valueEl.textContent = value;

    box.append(labelEl, valueEl);
    return box;
  }

  function createLibrarySessionTile(session) {
    const meta = formatSessionMeta(session);
    const tile = document.createElement('div');
    tile.className = 'library-session-tile' + (isBreakSession(session) ? ' is-break' : '');

    const timeEl = document.createElement('span');
    timeEl.className = 'library-tile-time';
    timeEl.textContent = `${session.startTime} – ${session.endTime}`;

    const metaEl = document.createElement('div');
    metaEl.className = 'library-tile-meta';

    if (meta.tag) {
      const tagEl = document.createElement('span');
      tagEl.className = 'library-tile-tag';
      tagEl.textContent = meta.tag;
      metaEl.appendChild(tagEl);
    }

    const durationEl = document.createElement('span');
    durationEl.className = 'library-tile-duration';
    durationEl.textContent = meta.duration;
    metaEl.appendChild(durationEl);

    tile.append(timeEl, metaEl);
    return tile;
  }

  function createLibraryGoalTile(goal) {
    const tile = document.createElement('div');
    tile.className = 'library-goal-tile' + (goal.done ? ' is-done' : '');

    const mark = document.createElement('span');
    mark.className = 'library-goal-tile-mark';
    mark.textContent = goal.done ? '✓' : '○';

    const text = document.createElement('span');
    text.className = 'library-goal-tile-text';
    text.textContent = goal.text;

    tile.append(mark, text);
    return tile;
  }

  function createLibrarySection(title, emptyText, tiles, createTile) {
    const section = document.createElement('section');
    section.className = 'library-card-section';

    const titleEl = document.createElement('h3');
    titleEl.className = 'library-section-title';
    titleEl.textContent = title;
    section.appendChild(titleEl);

    if (!tiles.length) {
      const empty = document.createElement('p');
      empty.className = 'library-section-empty';
      empty.textContent = emptyText;
      section.appendChild(empty);
      return section;
    }

    const grid = document.createElement('div');
    grid.className = 'library-tile-grid';
    tiles.forEach(item => grid.appendChild(createTile(item)));
    section.appendChild(grid);
    return section;
  }

  function getStudyTotalForSessions(sessions) {
    return sessions
      .filter(isStudySession)
      .reduce((sum, session) => sum + session.durationMinutes, 0);
  }

  function readGoalsFromStorage(dateKey) {
    try {
      const raw = storage.get(`studyTracker_goals_${dateKey}`);
      if (!raw) return [];

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .map(goal => ({
          id: goal.id || createSessionId(),
          text: String(goal.text || '').trim(),
          done: Boolean(goal.done)
        }))
        .filter(goal => goal.text);
    } catch {
      return [];
    }
  }

  function getDayGoals(dateKey, day) {
    if (day.goals && day.goals.length) return day.goals;
    return readGoalsFromStorage(dateKey);
  }

  function archiveDay(dateKey, sessions) {
    const existing = historyArchive[dateKey];
    let sessionList;

    if (sessions !== null && sessions !== undefined) {
      sessionList = Array.isArray(sessions)
        ? sessions.map(session => ({ ...session }))
        : [];
    } else {
      sessionList = existing?.sessions ? [...existing.sessions] : [];
    }

    const goalsFromStorage = readGoalsFromStorage(dateKey);
    const goalList = goalsFromStorage.length
      ? goalsFromStorage
      : (existing?.goals ? [...existing.goals] : []);

    if (sessionList.length === 0 && goalList.length === 0) return;

    historyArchive[dateKey] = {
      sessions: sessionList,
      goals: goalList
    };
  }

  function syncGoalsArchiveFromStorage() {
    const today = getTodayKey();
    let migrated = false;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('studyTracker_goals_')) continue;

      const dateKey = key.slice('studyTracker_goals_'.length);
      if (!dateKey || dateKey >= today) continue;

      const goals = readGoalsFromStorage(dateKey);
      if (!goals.length) continue;

      const existing = historyArchive[dateKey];
      if (!existing) {
        historyArchive[dateKey] = { sessions: [], goals };
        migrated = true;
        continue;
      }

      if (!existing.goals || existing.goals.length === 0) {
        existing.goals = goals;
        migrated = true;
      }
    }

    if (migrated) saveState();
  }

  function getHistoryDayKeys() {
    return Object.keys(historyArchive)
      .filter(key => {
        if (key === getTodayKey()) return false;
        const day = historyArchive[key];
        return day.sessions?.length || day.goals?.length;
      })
      .sort((a, b) => b.localeCompare(a));
  }

  function ensureHistorySessionIds() {
    let migrated = false;

    Object.values(historyArchive).forEach(day => {
      day.sessions.forEach(session => {
        if (!session.id) {
          session.id = createSessionId();
          migrated = true;
        }
      });
    });

    if (migrated) saveState();
  }

  function getBreakRemainingMs() {
    if (!state.breakActive) return 0;
    return Math.max(0, state.breakActive.endsAt - Date.now());
  }

  function getCurrentElapsedMs() {
    let total = state.active.elapsedMs;
    if (state.active.runningSince) {
      total += Date.now() - state.active.runningSince;
    }
    return total;
  }

  function loadState() {
    try {
      const raw = storage.get(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      const today = getTodayKey();

      if (parsed.version === 2) {
        historyArchive = parsed.archive && typeof parsed.archive === 'object'
          ? parsed.archive
          : {};

        if (parsed.date === today) {
          state = {
            date: parsed.date,
            sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
            active: parsed.active || createFreshState().active,
            breakActive: parsed.breakActive || null,
            timerMode: parsed.timerMode === 'countdown' || parsed.timerMode === 'pomodoro'
              ? 'countdown'
              : (parsed.timerMode === 'chrono' ? 'chrono' : state.timerMode),
            countdown: normalizeCountdown(parsed.countdown, parsed.pomodoro)
          };
        } else {
          archiveDay(parsed.date, parsed.sessions);
          state = createFreshState();
        }
      } else if (parsed.date) {
        historyArchive = {};

        if (parsed.date !== today) {
          archiveDay(parsed.date, parsed.sessions);
          state = createFreshState();
        } else if (parsed.date === today) {
          state = {
            date: parsed.date,
            sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
            active: parsed.active || createFreshState().active,
            breakActive: parsed.breakActive || null,
            timerMode: parsed.timerMode === 'countdown' || parsed.timerMode === 'pomodoro'
              ? 'countdown'
              : (parsed.timerMode === 'chrono' ? 'chrono' : state.timerMode),
            countdown: normalizeCountdown(parsed.countdown, parsed.pomodoro)
          };
        } else {
          state = createFreshState();
        }

        saveState();
      } else {
        return;
      }

      if (state.active.runningSince) {
        state.active.runningSince = Date.now();
      }

      if (state.countdown.runningSince) {
        state.countdown.runningSince = Date.now();
      }

      if (state.breakActive && Date.now() >= state.breakActive.endsAt) {
        finishBreak(true);
      }

      ensureSessionIds();
      ensureHistorySessionIds();
      syncGoalsArchiveFromStorage();
    } catch {
      state = createFreshState();
      historyArchive = {};
    }
  }

  function normalizeCountdown(raw, legacyPomodoro) {
    const base = createFreshCountdown();
    const source = raw && typeof raw === 'object' ? raw : null;

    if (source) {
      base.totalMs = Number.isFinite(source.totalMs)
        ? Math.max(60000, source.totalMs)
        : base.totalMs;
      base.remainingMs = Number.isFinite(source.remainingMs)
        ? Math.max(0, Math.min(source.remainingMs, base.totalMs))
        : base.remainingMs;
      base.runningSince = source.runningSince || null;
      base.startTime = source.startTime || source.workStartTime || null;
      if (base.totalMs >= 60000) {
        const totalMin = Math.round(base.totalMs / 60000);
        els.countdownHours.value = String(Math.min(23, Math.floor(totalMin / 60)));
        els.countdownMinutes.value = String(Math.min(59, totalMin % 60));
        clampCountdownInputs();
      }
      return base;
    }

    if (legacyPomodoro && typeof legacyPomodoro === 'object' && legacyPomodoro.phase !== 'break') {
      base.remainingMs = Number.isFinite(legacyPomodoro.remainingMs)
        ? Math.max(0, legacyPomodoro.remainingMs)
        : base.remainingMs;
      base.totalMs = Math.max(base.totalMs, base.remainingMs);
      base.runningSince = legacyPomodoro.runningSince || null;
      base.startTime = legacyPomodoro.workStartTime || null;
      const totalMin = Math.max(1, Math.round(base.totalMs / 60000));
      els.countdownHours.value = String(Math.min(23, Math.floor(totalMin / 60)));
      els.countdownMinutes.value = String(Math.min(59, totalMin % 60));
      clampCountdownInputs();
    }

    return base;
  }

  function createFreshState() {
    return {
      date: getTodayKey(),
      sessions: [],
      active: {
        startTime: null,
        elapsedMs: 0,
        runningSince: null
      },
      breakActive: null,
      timerMode: state.timerMode || 'chrono',
      countdown: createFreshCountdown()
    };
  }

  function saveState() {
    const active = {
      startTime: state.active.startTime,
      elapsedMs: state.active.elapsedMs,
      runningSince: state.active.runningSince
    };

    if (active.runningSince) {
      active.elapsedMs = getCurrentElapsedMs();
      active.runningSince = Date.now();
    }

    const countdown = { ...state.countdown };
    if (countdown.runningSince) {
      const delta = Date.now() - countdown.runningSince;
      countdown.remainingMs = Math.max(0, countdown.remainingMs - delta);
      countdown.runningSince = Date.now();
    }

    storage.set(STORAGE_KEY, JSON.stringify({
      version: 2,
      date: state.date,
      sessions: state.sessions,
      active,
      breakActive: state.breakActive,
      timerMode: state.timerMode,
      countdown,
      archive: historyArchive
    }));

    state.countdown = countdown;

    state.active.elapsedMs = active.elapsedMs;
    state.active.runningSince = active.runningSince;
  }

  function parseTodayTime(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d;
  }

  function getSessionRange(session) {
    const start = parseTodayTime(session.startTime);
    let end = parseTodayTime(session.endTime);
    if (end <= start) {
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }
    return { start, end };
  }

  function distributeSessionMinutes(startDate, endDate) {
    const distribution = { night: 0, morning: 0, afternoon: 0, evening: 0 };
    let cursor = new Date(startDate);

    while (cursor < endDate) {
      const hour = cursor.getHours();
      const period = PERIODS.find(p => hour >= p.start && hour < p.end);
      if (!period) break;

      const nextBoundary = new Date(cursor);
      nextBoundary.setMinutes(0, 0, 0);
      nextBoundary.setHours(period.end);

      const sliceEnd = nextBoundary < endDate ? nextBoundary : endDate;
      const minutes = (sliceEnd - cursor) / 60000;
      distribution[period.id] += minutes;
      cursor = sliceEnd;
    }

    return distribution;
  }

  function getSessionDistribution(session) {
    const { start, end } = getSessionRange(session);
    const dist = distributeSessionMinutes(start, end);
    const total = Object.values(dist).reduce((a, b) => a + b, 0);

    if (total < 0.5) {
      const hour = start.getHours();
      const period = PERIODS.find(p => hour >= p.start && hour < p.end);
      const empty = { night: 0, morning: 0, afternoon: 0, evening: 0 };
      if (period) empty[period.id] = session.durationMinutes;
      return empty;
    }

    return dist;
  }

  function getPeriodTotals() {
    const totals = { night: 0, morning: 0, afternoon: 0, evening: 0 };

    state.sessions.forEach(session => {
      if (!isStudySession(session)) return;
      const dist = getSessionDistribution(session);
      Object.keys(dist).forEach(key => {
        totals[key] += dist[key];
      });
    });

    return totals;
  }

  function getTotalMinutes() {
    return state.sessions
      .filter(isStudySession)
      .reduce((sum, s) => sum + s.durationMinutes, 0);
  }

  function getDateKeyFromDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getWeekStartMonday(baseDate = new Date()) {
    const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    const dow = d.getDay();
    const offset = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + offset);
    return d;
  }

  function getStudyMinutesForDateKey(dateKey) {
    const today = getTodayKey();
    if (dateKey === today) return getTotalMinutes();

    const day = historyArchive[dateKey];
    if (!day || !Array.isArray(day.sessions)) return 0;
    return getStudyTotalForSessions(day.sessions);
  }

  function getWeeklyChartData() {
    const todayKey = getTodayKey();
    const weekStart = getWeekStartMonday(new Date());

    return WEEKDAY_CHART.map((weekday, index) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + index);
      const dateKey = getDateKeyFromDate(date);
      const minutes = getStudyMinutesForDateKey(dateKey);

      return {
        ...weekday,
        dateKey,
        minutes,
        isToday: dateKey === todayKey
      };
    });
  }

  function formatWeeklyMinutesLabel(minutes) {
    const rounded = Math.max(0, Math.round(minutes));
    const hours = Math.floor(rounded / 60);
    const mins = rounded % 60;
    if (hours === 0) return `${mins} dk`;
    if (mins === 0) return `${hours} sa`;
    return `${hours} sa ${mins} dk`;
  }

  function renderTimer() {
    syncTimerModeUi();

    if (isBreakRunning()) {
      els.timer.textContent = formatDuration(getBreakRemainingMs());
      els.timer.classList.remove('running');
      els.timer.classList.add('break-mode');
      els.timerWrapper.classList.add('break-active');
      return;
    }

    els.timerWrapper.classList.remove('break-active');
    els.timer.classList.remove('break-mode');

    if (isCountdownMode()) {
      els.timer.textContent = formatDuration(getCountdownRemainingMs());
      els.timer.classList.toggle('running', !!state.countdown.runningSince);
      return;
    }

    const ms = getCurrentElapsedMs();
    els.timer.textContent = formatDuration(ms);
    els.timer.classList.toggle('running', !!state.active.runningSince);
  }

  function renderDailyTotal() {
    els.dailyTotal.textContent = formatTotalLabel(getTotalMinutes());
  }

  function renderSessionCount() {
    const count = state.sessions.length;
    if (count === 0) {
      els.sessionCount.hidden = true;
      return;
    }
    els.sessionCount.hidden = false;
    els.sessionCount.textContent = `${count} kayıt`;
  }

  function hideToast() {
    els.toast.hidden = true;
    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }
  }

  function showUndoToast(message) {
    hideToast();
    els.toastMsg.textContent = message;
    els.toast.hidden = false;
    toastTimeout = setTimeout(hideToast, 5000);
  }

  function deleteSession(id, listItem) {
    const index = state.sessions.findIndex(s => s.id === id);
    if (index === -1) return;

    undoBuffer = {
      session: { ...state.sessions[index] },
      index
    };

    if (listItem) {
      listItem.classList.add('removing');
      setTimeout(() => finishDelete(id), 220);
    } else {
      finishDelete(id);
    }
  }

  function finishDelete(id) {
    const index = state.sessions.findIndex(s => s.id === id);
    if (index === -1) return;

    state.sessions.splice(index, 1);
    saveState();
    renderDailyTotal();
    renderSessionList();
    renderChart();
    showUndoToast('Kayıt silindi');
  }

  function undoDelete() {
    if (!undoBuffer) return;

    if (undoBuffer.type === 'archiveDay') {
      historyArchive[undoBuffer.dateKey] = undoBuffer.day;
    } else {
      state.sessions.splice(undoBuffer.index, 0, undoBuffer.session);
    }

    undoBuffer = null;
    hideToast();
    saveState();
    renderAll();
  }

  function deleteArchiveDay(dateKey) {
    const day = historyArchive[dateKey];
    if (!day) return;

    undoBuffer = {
      type: 'archiveDay',
      dateKey,
      day: {
        sessions: Array.isArray(day.sessions) ? day.sessions.map(session => ({ ...session })) : [],
        goals: Array.isArray(day.goals) ? day.goals.map(goal => ({ ...goal })) : []
      }
    };

    delete historyArchive[dateKey];
    saveState();
    renderChart();
    renderLibrary();
    showUndoToast('Gün arşivden silindi');
  }

  function buildSessionMetaElements(session, meta) {
    const metaEl = document.createElement('div');
    metaEl.className = 'session-meta';

    if (meta.tag) {
      const tagEl = document.createElement('span');
      tagEl.className = 'session-tag';
      tagEl.textContent = meta.tag;

      const sepEl = document.createElement('span');
      sepEl.className = 'session-sep';
      sepEl.textContent = '|';

      const durationEl = document.createElement('span');
      durationEl.className = 'session-duration';
      durationEl.textContent = meta.duration;

      metaEl.append(tagEl, sepEl, durationEl);
    } else {
      const durationEl = document.createElement('span');
      durationEl.className = 'session-duration';
      durationEl.textContent = meta.duration;
      metaEl.appendChild(durationEl);
    }

    return metaEl;
  }

  function renderSessionList() {
    els.sessionList.innerHTML = '';
    renderSessionCount();

    if (state.sessions.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'session-empty';
      empty.textContent = 'Henüz kayıt yok';
      els.sessionList.appendChild(empty);
      return;
    }

    const sorted = [...state.sessions].reverse();
    sorted.forEach(session => {
      const meta = formatSessionMeta(session);
      const li = document.createElement('li');
      li.className = 'session-item' + (isBreakSession(session) ? ' session-break' : '');

      const body = document.createElement('div');
      body.className = 'session-body';

      const timeEl = document.createElement('span');
      timeEl.className = 'session-time';
      timeEl.textContent = `${session.startTime} - ${session.endTime}`;

      const metaEl = buildSessionMetaElements(session, meta);

      body.append(timeEl, metaEl);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'session-delete';
      deleteBtn.type = 'button';
      deleteBtn.setAttribute('aria-label', 'Kaydı sil');
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', () => deleteSession(session.id, li));

      li.append(body, deleteBtn);
      els.sessionList.appendChild(li);
    });
  }

  function renderLibrary() {
    const dayKeys = getHistoryDayKeys();
    els.libraryShelf.innerHTML = '';
    els.libraryShelf.className = 'library-shelf library-grid';

    if (dayKeys.length === 0) {
      els.libraryShelf.className = 'library-shelf';
      const empty = document.createElement('p');
      empty.className = 'library-empty';
      empty.textContent = 'Henüz arşivlenmiş gün yok. Bugün kayıt veya hedef oluştur — yarın burada görünecek.';
      els.libraryShelf.appendChild(empty);
      els.libraryCount.hidden = true;
      return;
    }

    els.libraryCount.hidden = false;
    els.libraryCount.textContent = `${dayKeys.length} gün`;

    dayKeys.forEach(dateKey => {
      const day = historyArchive[dateKey];
      const sessions = day.sessions || [];
      const goals = getDayGoals(dateKey, day);
      const studyTotal = getStudyTotalForSessions(sessions);
      const breakTotal = getBreakTotalForSessions(sessions);
      const studyCount = sessions.filter(isStudySession).length;
      const breakCount = sessions.filter(isBreakSession).length;
      const goalsDone = goals.filter(goal => goal.done).length;

      const card = document.createElement('article');
      card.className = 'library-card';

      const header = document.createElement('header');
      header.className = 'library-card-header';

      const dateWrap = document.createElement('div');
      dateWrap.className = 'library-card-date-wrap';

      const dateEl = document.createElement('h3');
      dateEl.className = 'library-card-date';
      dateEl.textContent = formatDateKeyLabel(dateKey);

      const dateFullEl = document.createElement('p');
      dateFullEl.className = 'library-card-date-full';
      dateFullEl.textContent = formatDateKeyFull(dateKey);

      dateWrap.append(dateEl, dateFullEl);

      const badge = document.createElement('span');
      badge.className = 'library-card-badge';
      badge.textContent = studyTotal > 0 ? formatTotalShort(studyTotal) : '—';

      const deleteDayBtn = document.createElement('button');
      deleteDayBtn.className = 'library-card-delete';
      deleteDayBtn.type = 'button';
      deleteDayBtn.textContent = 'Sil';
      deleteDayBtn.setAttribute('aria-label', `${formatDateKeyLabel(dateKey)} gününü arşivden sil`);
      deleteDayBtn.addEventListener('click', () => deleteArchiveDay(dateKey));

      const headerActions = document.createElement('div');
      headerActions.className = 'library-card-actions';
      headerActions.append(badge, deleteDayBtn);

      header.append(dateWrap, headerActions);

      const stats = document.createElement('div');
      stats.className = 'library-card-stats';
      stats.append(
        createLibraryStatBox('Çalışma', studyTotal > 0 ? formatTotalShort(studyTotal) : '0 dk', 'is-study'),
        createLibraryStatBox('Kayıt', `${studyCount} oturum`),
        createLibraryStatBox('Mola', breakCount ? `${breakCount} · ${formatTotalShort(breakTotal)}` : 'Yok', 'is-break'),
        createLibraryStatBox('Hedef', goals.length ? `${goalsDone}/${goals.length}` : '—', 'is-goals')
      );

      const body = document.createElement('div');
      body.className = 'library-card-body';
      body.append(
        createLibrarySection(
          'Çalışma Kayıtları',
          'Bu gün için çalışma kaydı yok.',
          [...sessions].reverse(),
          createLibrarySessionTile
        ),
        createLibrarySection(
          'Günün Hedefleri',
          'Bu gün için hedef kaydı yok.',
          goals,
          createLibraryGoalTile
        )
      );

      card.append(header, stats, body);
      els.libraryShelf.appendChild(card);
    });
  }

  function renderChartLegend(weekData) {
    els.chartLegend.innerHTML = '';
    weekData.forEach(day => {
      const li = document.createElement('li');
      li.className = day.isToday ? 'is-today' : '';
      li.innerHTML =
        `<span class="dot" style="background:${day.isToday ? '#00d4ff' : '#a855f7'}"></span>` +
        `<span>${day.label}</span>` +
        `<span class="legend-value">${formatWeeklyMinutesLabel(day.minutes)}</span>`;
      els.chartLegend.appendChild(li);
    });
  }

  function renderChart() {
    const weekData = getWeeklyChartData();
    const values = weekData.map(day => Math.round(day.minutes * 10) / 10);
    const hasData = values.some(value => value > 0);
    const labels = weekData.map(day => day.short);

    if (typeof Chart === 'undefined') {
      renderChartLegend(weekData);
      return;
    }

    if (chart && chart.config.type !== 'bar') {
      chart.destroy();
      chart = null;
    }

    const barColors = weekData.map(day => (day.isToday ? '#00d4ff' : 'rgba(168, 85, 247, 0.75)'));
    const borderColors = weekData.map(day => (day.isToday ? '#00d4ff' : '#a855f7'));

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = values;
      chart.data.datasets[0].backgroundColor = barColors;
      chart.data.datasets[0].borderColor = borderColors;
      chart.options.scales.y.max = hasData ? undefined : 60;
      chart.update('none');
    } else {
      chart = new Chart(els.chartCanvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            data: values,
            backgroundColor: barColors,
            borderColor: borderColors,
            borderWidth: 1,
            borderRadius: 4,
            maxBarThickness: 42
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: '#16161f',
              borderColor: 'rgba(0, 212, 255, 0.3)',
              borderWidth: 1,
              titleFont: { family: "'Fira Code', monospace", size: 11 },
              bodyFont: { family: "'Fira Code', monospace", size: 11 },
              titleColor: '#e8e8f0',
              bodyColor: '#7a7a8c',
              padding: 12,
              callbacks: {
                title(items) {
                  const index = items[0]?.dataIndex;
                  return weekData[index]?.label || '';
                },
                label(ctx) {
                  const mins = ctx.parsed.y || 0;
                  if (mins <= 0) return 'Kayıt yok';
                  return formatWeeklyMinutesLabel(mins);
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                color: '#7a7a8c',
                font: { family: "'Fira Code', monospace", size: 10 }
              }
            },
            y: {
              beginAtZero: true,
              suggestedMax: hasData ? undefined : 60,
              ticks: {
                color: '#7a7a8c',
                font: { family: "'Fira Code', monospace", size: 10 },
                callback(value) {
                  return `${value} dk`;
                }
              },
              grid: {
                color: 'rgba(0, 212, 255, 0.08)'
              }
            }
          },
          animation: {
            duration: 500
          }
        }
      });
    }

    renderChartLegend(weekData);
  }

  function updateButtons() {
    const breakRunning = isBreakRunning();
    const chronoRunning = isChronoMode() && !!state.active.runningSince;
    const countdownRunning = isCountdownMode() && !!state.countdown.runningSince;
    const anyTimerRunning = chronoRunning || countdownRunning;

    let canSave = false;
    if (isChronoMode() && !breakRunning) {
      canSave = state.active.startTime !== null && getCurrentElapsedMs() >= 1000;
    } else if (isCountdownMode() && !breakRunning) {
      canSave = getCountdownElapsedMs() >= 1000;
    }

    els.btnStart.disabled = anyTimerRunning || breakRunning;
    els.btnStop.disabled = !anyTimerRunning || breakRunning;
    els.btnReset.disabled = breakRunning;
    els.btnSave.disabled = !canSave || breakRunning || saveInProgress;
    els.tagInput.disabled = breakRunning || anyTimerRunning;
    els.modeChrono.disabled = breakRunning || anyTimerRunning;
    els.modeCountdown.disabled = breakRunning || anyTimerRunning;
    els.countdownHours.disabled = breakRunning || anyTimerRunning;
    els.countdownMinutes.disabled = breakRunning || anyTimerRunning;

    els.btnBreakStart.disabled = breakRunning || anyTimerRunning;
    els.btnBreakCancel.disabled = !breakRunning;
    els.breakDuration.disabled = breakRunning;
  }

  function tick() {
    if (isBreakRunning()) {
      const remaining = getBreakRemainingMs();
      renderTimer();
      updateButtons();

      if (remaining <= 0) {
        finishBreak(true);
      }
      return;
    }

    if (isCountdownMode() && state.countdown.runningSince) {
      if (getCountdownRemainingMs() <= 0) {
        completeCountdown();
      }
    }

    renderTimer();
    updateButtons();
  }

  function pauseCountdown() {
    if (!state.countdown.runningSince) return;

    const delta = Date.now() - state.countdown.runningSince;
    state.countdown.remainingMs = Math.max(0, state.countdown.remainingMs - delta);
    state.countdown.runningSince = null;
  }

  function completeCountdown() {
    pauseCountdown();
    state.countdown.remainingMs = 0;
    notifyTimerDone('Süre doldu');
    saveState();
    renderTimer();
    updateButtons();
    stopTicking();
  }

  function startCountdown() {
    if (state.countdown.runningSince || isBreakRunning()) return;

    const now = new Date();
    const totalMs = getCountdownTotalMs();

    if (!state.countdown.runningSince && state.countdown.remainingMs <= 0) {
      state.countdown = createFreshCountdown();
    } else if (!state.countdown.runningSince && state.countdown.remainingMs > totalMs) {
      state.countdown.remainingMs = totalMs;
      state.countdown.totalMs = totalMs;
    }

    if (!state.countdown.startTime && getCountdownElapsedMs() <= 0) {
      state.countdown.startTime = formatClock(now);
    }

    if (state.countdown.remainingMs <= 0) {
      state.countdown = createFreshCountdown();
      state.countdown.startTime = formatClock(now);
    }

    state.countdown.totalMs = totalMs;
    state.countdown.runningSince = Date.now();
    saveState();
    renderTimer();
    updateButtons();
    startTicking();
  }

  function startTicking() {
    if (tickInterval) return;
    tickInterval = setInterval(tick, 1000);
  }

  function stopTicking() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  function handleStart() {
    if (isBreakRunning()) return;

    if (isCountdownMode()) {
      startCountdown();
      return;
    }

    const now = new Date();
    if (!state.active.startTime) {
      state.active.startTime = formatClock(now);
    }
    state.active.runningSince = Date.now();
    saveState();
    renderTimer();
    updateButtons();
    startTicking();
  }

  function handleStop() {
    if (isCountdownMode()) {
      if (!state.countdown.runningSince) return;
      pauseCountdown();
      saveState();
      renderTimer();
      updateButtons();
      stopTicking();
      return;
    }

    if (!state.active.runningSince) return;

    state.active.elapsedMs += Date.now() - state.active.runningSince;
    state.active.runningSince = null;
    saveState();
    renderTimer();
    updateButtons();
    stopTicking();
  }

  function handleReset() {
    if (isBreakRunning()) return;

    if (state.active.runningSince || state.countdown.runningSince) {
      handleStop();
    }

    if (isCountdownMode()) {
      state.countdown = createFreshCountdown();
    } else {
      state.active = {
        startTime: null,
        elapsedMs: 0,
        runningSince: null
      };
    }

    saveState();
    renderTimer();
    updateButtons();
    stopTicking();
  }

  function handleSave() {
    if (isBreakRunning() || saveInProgress) return;

    saveInProgress = true;
    updateButtons();

    try {
      if (isCountdownMode()) {
        if (state.countdown.runningSince) {
          pauseCountdown();
        }

        const elapsedMs = getCountdownElapsedMs();
        if (elapsedMs < 1000) return;

        const endDate = new Date();
        const durationMinutes = Math.max(1, Math.round(elapsedMs / 60000));
        const label = buildSessionLabel();
        const startTime = state.countdown.startTime || formatClock(endDate);

        const session = {
          id: createSessionId(),
          startTime,
          endTime: formatClock(endDate),
          durationMinutes
        };

        if (label) session.label = label;
        state.sessions.push(session);
        state.countdown = createFreshCountdown();
      } else {
        const elapsedMs = getCurrentElapsedMs();
        if (elapsedMs < 1000 || !state.active.startTime) return;

        if (state.active.runningSince) {
          handleStop();
        }

        const endDate = new Date();
        const durationMinutes = Math.max(1, Math.round(getCurrentElapsedMs() / 60000));
        const label = buildSessionLabel();

        const session = {
          id: createSessionId(),
          startTime: state.active.startTime,
          endTime: formatClock(endDate),
          durationMinutes
        };

        if (label) session.label = label;
        state.sessions.push(session);

        state.active = {
          startTime: null,
          elapsedMs: 0,
          runningSince: null
        };
      }

      els.tagInput.value = '';
      saveState();
      renderAll();
      stopTicking();
    } finally {
      saveInProgress = false;
      updateButtons();
    }
  }

  function getBreakDurationMinutes() {
    const value = Number(els.breakDuration.value);
    if (!Number.isFinite(value)) return 0;
    return Math.min(120, Math.max(1, Math.round(value)));
  }

  function saveBreakSession(startDate, endDate, plannedMinutes) {
    const elapsedMinutes = Math.max(1, Math.round((endDate - startDate) / 60000));
    const durationMinutes = Math.min(plannedMinutes, elapsedMinutes);

    state.sessions.push({
      id: createSessionId(),
      type: 'break',
      startTime: formatClock(startDate),
      endTime: formatClock(endDate),
      durationMinutes
    });
  }

  function finishBreak(completed) {
    if (!state.breakActive) return;

    const { startTime, plannedMinutes, startedAt } = state.breakActive;
    const startDate = new Date(startedAt);
    const endDate = completed
      ? new Date(state.breakActive.endsAt)
      : new Date();

    saveBreakSession(startDate, endDate, plannedMinutes);
    state.breakActive = null;

    saveState();
    renderAll();
    stopTicking();

    if (completed) {
      showUndoToast('Mola tamamlandı');
      undoBuffer = null;
    }
  }

  function handleBreakStart() {
    if (isBreakRunning()) return;

    const plannedMinutes = getBreakDurationMinutes();
    if (plannedMinutes < 1) return;

    if (state.active.runningSince || state.countdown.runningSince) {
      handleStop();
    }

    const now = new Date();
    state.breakActive = {
      startTime: formatClock(now),
      startedAt: now.getTime(),
      plannedMinutes,
      endsAt: now.getTime() + plannedMinutes * 60000
    };

    els.breakDuration.value = String(plannedMinutes);
    saveState();
    renderAll();
    startTicking();
  }

  function handleBreakCancel() {
    if (!isBreakRunning()) return;

    const elapsedMs = Date.now() - state.breakActive.startedAt;
    if (elapsedMs >= 60000) {
      finishBreak(false);
      showUndoToast('Mola kaydedildi');
      undoBuffer = null;
      return;
    }

    state.breakActive = null;
    saveState();
    renderAll();
    stopTicking();
  }

  function renderAll() {
    renderTimer();
    renderDailyTotal();
    renderSessionList();
    renderChart();
    renderLibrary();
    updateButtons();
  }

  function checkDateReset() {
    const today = getTodayKey();
    if (state.date !== today) {
      archiveDay(state.date, state.sessions);
      state = createFreshState();
      saveState();
      renderAll();
      stopTicking();
    }
  }

  els.btnStart.addEventListener('click', handleStart);
  els.btnStop.addEventListener('click', handleStop);
  els.btnReset.addEventListener('click', handleReset);
  els.btnSave.addEventListener('click', handleSave);
  els.modeChrono.addEventListener('click', () => setTimerMode('chrono'));
  els.modeCountdown.addEventListener('click', () => setTimerMode('countdown'));
  els.countdownHours.addEventListener('change', applyCountdownDurationInput);
  els.countdownMinutes.addEventListener('change', applyCountdownDurationInput);
  els.btnBreakStart.addEventListener('click', handleBreakStart);
  els.btnBreakCancel.addEventListener('click', handleBreakCancel);
  els.toastUndo.addEventListener('click', undoDelete);

  els.tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !els.btnStart.disabled) {
      e.preventDefault();
      handleStart();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveState();
    } else {
      checkDateReset();

      if (state.breakActive && Date.now() >= state.breakActive.endsAt) {
        finishBreak(true);
        return;
      }

      renderAll();
      if (state.active.runningSince || state.countdown.runningSince || isBreakRunning()) {
        startTicking();
      }
    }
  });

  window.addEventListener('beforeunload', saveState);

  setInterval(checkDateReset, 60000);

  window.studyTrackerArchivePastDay = function (dateKey, sessions) {
    archiveDay(dateKey, sessions);
    saveState();
    renderLibrary();
  };

  loadSettings();
  loadState();
  repairCountdownState();
  syncTimerModeUi();
  renderAll();

  if (state.countdown.runningSince) {
    state.countdown.runningSince = Date.now();
  }

  if (state.active.runningSince || state.countdown.runningSince || isBreakRunning()) {
    startTicking();
  }
})();

(function initAmbientPlayer() {
  'use strict';

  const AMBIENT_STORAGE_KEY = 'studyTrackerAmbient';
  const USE_WEB_AUDIO = !(
    /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );

  const TRACKS = {
    rain: {
      label: 'Hafif Yağmur',
      src: 'audio/rain.mp3',
      gain: 1.15
    },
    'heavy-rain': {
      label: 'Sağanak Yağmur',
      src: 'audio/heavy-rain.mp3',
      gain: 1.1
    },
    fireplace: {
      label: 'Şömine Çıtırtısı',
      src: 'audio/fireplace.mp3',
      gain: 1.25
    },
    lofi: {
      label: 'Lofi Odak Müziği',
      src: 'audio/lofi.mp3',
      gain: 0.95
    }
  };

  const audio = document.getElementById('ambientAudio');
  const playBtn = document.getElementById('ambientPlayPause');
  const volumeSlider = document.getElementById('ambientVolume');
  const trackButtons = document.querySelectorAll('.ambient-track');

  let currentTrack = null;
  let isPlaying = false;
  let audioCtx = null;
  let gainNode = null;

  function initAudioGraph() {
    if (gainNode || !USE_WEB_AUDIO) return;

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaElementSource(audio);
      gainNode = audioCtx.createGain();
      source.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      applyVolume();
    } catch {
      gainNode = null;
      audioCtx = null;
    }
  }

  function resumeAudioContext() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function loadPrefs() {
    try {
      const raw = storage.get(AMBIENT_STORAGE_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (typeof prefs.volume === 'number') {
        volumeSlider.value = String(Math.round(prefs.volume * 100));
      }
      if (prefs.track && TRACKS[prefs.track]) {
        currentTrack = prefs.track;
        setActiveTrack(currentTrack);
      }
    } catch {
      /* ignore */
    }
    applyVolume();
  }

  function savePrefs() {
    storage.set(AMBIENT_STORAGE_KEY, JSON.stringify({
      track: currentTrack,
      volume: Number(volumeSlider.value) / 100
    }));
  }

  function applyVolume() {
    const level = Number(volumeSlider.value) / 100;
    const trackGain = currentTrack ? (TRACKS[currentTrack].gain || 1) : 1;
    audio.volume = 1;

    if (gainNode) {
      gainNode.gain.value = Math.min(1, level * trackGain);
    } else {
      audio.volume = Math.min(1, level * trackGain);
    }
  }

  function setActiveTrack(trackId) {
    trackButtons.forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.track === trackId);
    });
  }

  function updatePlayUi(playing) {
    isPlaying = playing;
    playBtn.classList.toggle('is-playing', playing);
    playBtn.setAttribute('aria-label', playing ? 'Durdur' : 'Oynat');
  }

  function ensureTrackSource() {
    if (!currentTrack) return false;
    const targetSrc = new URL(TRACKS[currentTrack].src, window.location.href).href;
    if (audio.src !== targetSrc) {
      audio.src = TRACKS[currentTrack].src;
      audio.load();
    }
    return true;
  }

  function stopAudio() {
    audio.pause();
    audio.currentTime = 0;
    updatePlayUi(false);
  }

  function playCurrentTrack() {
    if (!ensureTrackSource()) return;

    if (USE_WEB_AUDIO) {
      initAudioGraph();
      resumeAudioContext();
    }
    applyVolume();

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise
        .then(() => updatePlayUi(true))
        .catch(() => updatePlayUi(false));
    } else {
      updatePlayUi(true);
    }
  }

  function selectTrack(trackId, autoPlay) {
    if (!TRACKS[trackId]) return;

    if (currentTrack === trackId && autoPlay) {
      if (isPlaying) {
        audio.pause();
        updatePlayUi(false);
      } else {
        playCurrentTrack();
      }
      return;
    }

    stopAudio();
    currentTrack = trackId;
    setActiveTrack(trackId);
    audio.src = TRACKS[trackId].src;
    audio.load();
    applyVolume();
    savePrefs();

    if (autoPlay) playCurrentTrack();
  }

  audio.setAttribute('playsinline', '');
  audio.setAttribute('webkit-playsinline', '');

  playBtn.addEventListener('click', () => {
    if (!currentTrack) {
      selectTrack('rain', true);
      return;
    }

    if (isPlaying) {
      audio.pause();
      updatePlayUi(false);
    } else {
      playCurrentTrack();
    }
  });

  trackButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      selectTrack(btn.dataset.track, true);
    });
  });

  volumeSlider.addEventListener('input', () => {
    applyVolume();
    savePrefs();
  });

  audio.addEventListener('error', () => {
    updatePlayUi(false);
  });

  audio.addEventListener('ended', () => updatePlayUi(false));
  audio.addEventListener('pause', () => {
    if (!audio.ended) updatePlayUi(false);
  });
  audio.addEventListener('play', () => updatePlayUi(true));

  loadPrefs();
})();

(function initDailyGoals() {
  'use strict';

  const LEGACY_DEFAULT_GOAL_TEXTS = [
    '2 Saat Toplam Çalışma Yap',
    'En Az 1 Mola Periyodu Kullan',
    'Günlük Çalışma Kaydını Tamamla'
  ];

  const goalStorage = {
    get(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    }
  };

  const els = {
    list: document.getElementById('goalsList'),
    progressFill: document.getElementById('goalsProgressFill'),
    progressText: document.getElementById('goalsProgressText'),
    input: document.getElementById('goalInput'),
    addBtn: document.getElementById('goalAddBtn')
  };

  if (!els.list) return;

  let goals = [];
  let loadedDateKey = '';

  function getTodayKey() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function getGoalsStorageKey(dateKey) {
    return `studyTracker_goals_${dateKey || getTodayKey()}`;
  }

  function createGoalId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  const legacyGoalTextSet = new Set(LEGACY_DEFAULT_GOAL_TEXTS);

  function withoutLegacyDefaultGoals(parsed) {
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(goal => !legacyGoalTextSet.has(String(goal.text || '').trim()));
  }

  function loadGoals() {
    const dateKey = getTodayKey();
    loadedDateKey = dateKey;
    const raw = goalStorage.get(getGoalsStorageKey(dateKey));

    if (!raw) {
      goals = [];
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const stripped = withoutLegacyDefaultGoals(parsed);

      if (stripped.length !== (Array.isArray(parsed) ? parsed.length : 0)) {
        goalStorage.set(getGoalsStorageKey(dateKey), JSON.stringify(stripped));
      }

      goals = stripped.map(goal => ({
        id: goal.id || createGoalId(),
        text: String(goal.text || '').trim(),
        done: Boolean(goal.done)
      })).filter(goal => goal.text);
    } catch {
      goals = [];
      saveGoals();
    }
  }

  function saveGoals() {
    goalStorage.set(getGoalsStorageKey(loadedDateKey || getTodayKey()), JSON.stringify(goals));
  }

  function renderProgress() {
    const total = goals.length;
    const done = goals.filter(goal => goal.done).length;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    els.progressFill.style.width = `${percent}%`;
    els.progressText.textContent = `${done}/${total} Tamamlandı — %${percent}`;
  }

  function renderGoals() {
    els.list.innerHTML = '';

    if (goals.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'goals-empty';
      empty.textContent = 'Henüz hedef yok';
      els.list.appendChild(empty);
      renderProgress();
      return;
    }

    goals.forEach(goal => {
      const li = document.createElement('li');
      li.className = 'goal-item' + (goal.done ? ' is-done' : '');
      li.dataset.id = goal.id;

      const checkBtn = document.createElement('button');
      checkBtn.className = 'goal-check';
      checkBtn.type = 'button';
      checkBtn.setAttribute('aria-label', goal.done ? 'Tamamlandı işaretini kaldır' : 'Tamamlandı olarak işaretle');
      checkBtn.setAttribute('aria-pressed', goal.done ? 'true' : 'false');

      const mark = document.createElement('span');
      mark.className = 'goal-check-mark';
      mark.textContent = '✓';
      checkBtn.appendChild(mark);

      const text = document.createElement('span');
      text.className = 'goal-text';
      text.textContent = goal.text;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'goal-delete';
      deleteBtn.type = 'button';
      deleteBtn.setAttribute('aria-label', 'Hedefi sil');
      deleteBtn.textContent = '×';

      checkBtn.addEventListener('click', () => toggleGoal(goal.id, li));
      deleteBtn.addEventListener('click', () => deleteGoal(goal.id, li));

      li.append(checkBtn, text, deleteBtn);
      els.list.appendChild(li);
    });

    renderProgress();
  }

  function toggleGoal(id, listItem) {
    const goal = goals.find(item => item.id === id);
    if (!goal) return;

    goal.done = !goal.done;
    saveGoals();
    renderGoals();

    if (goal.done && listItem) {
      const updatedItem = els.list.querySelector(`[data-id="${id}"]`);
      if (updatedItem) {
        updatedItem.classList.add('just-completed');
        setTimeout(() => updatedItem.classList.remove('just-completed'), 650);
      }
    }
  }

  function deleteGoal(id, listItem) {
    if (listItem) {
      listItem.style.opacity = '0';
      listItem.style.transform = 'translateX(-8px)';
      setTimeout(() => finishDeleteGoal(id), 180);
    } else {
      finishDeleteGoal(id);
    }
  }

  function finishDeleteGoal(id) {
    goals = goals.filter(goal => goal.id !== id);
    saveGoals();
    renderGoals();
  }

  function addGoal() {
    const text = els.input.value.trim();
    if (!text) return;

    goals.push({
      id: createGoalId(),
      text,
      done: false
    });

    els.input.value = '';
    saveGoals();
    renderGoals();
  }

  function refreshForToday() {
    const today = getTodayKey();
    if (today !== loadedDateKey) {
      const previousDateKey = loadedDateKey;
      saveGoals();

      if (previousDateKey && window.studyTrackerArchivePastDay) {
        window.studyTrackerArchivePastDay(previousDateKey, null);
      }

      loadGoals();
      renderGoals();
    }
  }

  els.addBtn.addEventListener('click', addGoal);
  els.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addGoal();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshForToday();
    }
  });

  setInterval(refreshForToday, 60000);

  function purgeLegacyGoalsInStorage() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('studyTracker_goals_')) keys.push(key);
      }
    } catch {
      return;
    }

    keys.forEach(key => {
      try {
        const raw = goalStorage.get(key);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        const stripped = withoutLegacyDefaultGoals(parsed);
        if (!Array.isArray(parsed) || stripped.length === parsed.length) return;
        goalStorage.set(key, JSON.stringify(stripped));
      } catch {
        /* ignore */
      }
    });
  }

  purgeLegacyGoalsInStorage();
  loadGoals();
  renderGoals();
})();
