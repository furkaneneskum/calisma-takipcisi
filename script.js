(function () {
  'use strict';

  const STORAGE_KEY = 'studyTrackerData';

  const PERIODS = [
    { id: 'night', label: 'Gece (00-06)', start: 0, end: 6, color: '#6366f1' },
    { id: 'morning', label: 'Sabah (06-12)', start: 6, end: 12, color: '#00d4ff' },
    { id: 'afternoon', label: 'Öğleden Sonra (12-18)', start: 12, end: 18, color: '#a855f7' },
    { id: 'evening', label: 'Akşam (18-24)', start: 18, end: 24, color: '#22c55e' }
  ];

  const els = {
    timer: document.getElementById('timer'),
    dailyTotal: document.getElementById('dailyTotal'),
    sessionList: document.getElementById('sessionList'),
    btnStart: document.getElementById('btnStart'),
    btnStop: document.getElementById('btnStop'),
    btnSave: document.getElementById('btnSave'),
    tagInput: document.getElementById('tagInput'),
    sessionCount: document.getElementById('sessionCount'),
    toast: document.getElementById('toast'),
    toastMsg: document.getElementById('toastMsg'),
    toastUndo: document.getElementById('toastUndo'),
    chartCanvas: document.getElementById('periodChart'),
    chartLegend: document.getElementById('chartLegend')
  };

  let chart = null;
  let tickInterval = null;
  let toastTimeout = null;
  let undoBuffer = null;

  let state = {
    date: getTodayKey(),
    sessions: [],
    active: {
      startTime: null,
      elapsedMs: 0,
      runningSince: null
    }
  };

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

  function formatMinutesShort(minutes) {
    return `${Math.round(minutes)} dk`;
  }

  function formatMinutesLabel(minutes) {
    if (minutes < 1) return '1 Dakika';
    return `${Math.round(minutes)} Dakika`;
  }

  function formatSessionMeta(session) {
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

  function getCurrentElapsedMs() {
    let total = state.active.elapsedMs;
    if (state.active.runningSince) {
      total += Date.now() - state.active.runningSince;
    }
    return total;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (parsed.date !== getTodayKey()) {
        state = createFreshState();
        return;
      }

      state = {
        date: parsed.date,
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
        active: parsed.active || createFreshState().active
      };

      if (state.active.runningSince) {
        state.active.runningSince = Date.now();
      }

      ensureSessionIds();
    } catch {
      state = createFreshState();
    }
  }

  function createFreshState() {
    return {
      date: getTodayKey(),
      sessions: [],
      active: {
        startTime: null,
        elapsedMs: 0,
        runningSince: null
      }
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

    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      date: state.date,
      sessions: state.sessions,
      active
    }));

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
      const dist = getSessionDistribution(session);
      Object.keys(dist).forEach(key => {
        totals[key] += dist[key];
      });
    });

    return totals;
  }

  function getTotalMinutes() {
    return state.sessions.reduce((sum, s) => sum + s.durationMinutes, 0);
  }

  function renderTimer() {
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

    state.sessions.splice(undoBuffer.index, 0, undoBuffer.session);
    undoBuffer = null;
    hideToast();
    saveState();
    renderAll();
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
      li.className = 'session-item';

      const body = document.createElement('div');
      body.className = 'session-body';

      const timeEl = document.createElement('span');
      timeEl.className = 'session-time';
      timeEl.textContent = `${session.startTime} - ${session.endTime}`;

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

  function renderChartLegend(totals) {
    els.chartLegend.innerHTML = '';
    PERIODS.forEach(period => {
      const mins = Math.max(0, Math.round(totals[period.id]));
      const li = document.createElement('li');
      li.innerHTML =
        `<span class="dot" style="background:${period.color}"></span>` +
        `<span>${period.label}</span>` +
        `<span class="legend-value">${mins} dk</span>`;
      els.chartLegend.appendChild(li);
    });
  }

  function renderChart() {
    const totals = getPeriodTotals();
    const values = PERIODS.map(p => Math.round(totals[p.id] * 10) / 10);
    const hasData = values.some(v => v > 0);

    if (chart) {
      chart.data.datasets[0].data = hasData ? values : [1, 1, 1, 1];
      chart.data.datasets[0].backgroundColor = hasData
        ? PERIODS.map(p => p.color)
        : PERIODS.map(p => p.color + '33');
      chart.update('none');
    } else {
      chart = new Chart(els.chartCanvas, {
        type: 'doughnut',
        data: {
          labels: PERIODS.map(p => p.label),
          datasets: [{
            data: hasData ? values : [1, 1, 1, 1],
            backgroundColor: hasData
              ? PERIODS.map(p => p.color)
              : PERIODS.map(p => p.color + '33'),
            borderColor: '#111118',
            borderWidth: 3,
            hoverBorderColor: '#0a0a0f',
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '68%',
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
                label(ctx) {
                  if (!hasData) return 'Henüz veri yok';
                  const mins = ctx.parsed;
                  const total = values.reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? Math.round((mins / total) * 100) : 0;
                  return `${Math.round(mins)} dakika (${pct}%)`;
                }
              }
            }
          },
          animation: {
            animateRotate: true,
            duration: 600
          }
        }
      });
    }

    renderChartLegend(totals);
  }

  function updateButtons() {
    const isRunning = !!state.active.runningSince;
    const hasSession = state.active.startTime !== null && getCurrentElapsedMs() > 0;

    els.btnStart.disabled = isRunning;
    els.btnStop.disabled = !isRunning;
    els.btnSave.disabled = !hasSession;
  }

  function startTicking() {
    if (tickInterval) return;
    tickInterval = setInterval(() => {
      renderTimer();
      updateButtons();
    }, 1000);
  }

  function stopTicking() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  function handleStart() {
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
    if (!state.active.runningSince) return;

    state.active.elapsedMs += Date.now() - state.active.runningSince;
    state.active.runningSince = null;
    saveState();
    renderTimer();
    updateButtons();
    stopTicking();
  }

  function handleSave() {
    const elapsedMs = getCurrentElapsedMs();
    if (elapsedMs < 1000 || !state.active.startTime) return;

    if (state.active.runningSince) {
      handleStop();
    }

    const endDate = new Date();
    const durationMinutes = Math.max(1, Math.round(getCurrentElapsedMs() / 60000));
    const label = els.tagInput.value.trim();

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

    els.tagInput.value = '';

    saveState();
    renderAll();
    stopTicking();
  }

  function renderAll() {
    renderTimer();
    renderDailyTotal();
    renderSessionList();
    renderChart();
    updateButtons();
  }

  function checkDateReset() {
    const today = getTodayKey();
    if (state.date !== today) {
      state = createFreshState();
      saveState();
      renderAll();
    }
  }

  els.btnStart.addEventListener('click', handleStart);
  els.btnStop.addEventListener('click', handleStop);
  els.btnSave.addEventListener('click', handleSave);
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
      renderAll();
      if (state.active.runningSince) startTicking();
    }
  });

  window.addEventListener('beforeunload', saveState);

  setInterval(checkDateReset, 60000);

  loadState();
  renderAll();

  if (state.active.runningSince) {
    startTicking();
  }
})();

(function initAmbientPlayer() {
  'use strict';

  const AMBIENT_STORAGE_KEY = 'studyTrackerAmbient';

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
  const iconPlay = playBtn.querySelector('.ambient-icon-play');
  const iconPause = playBtn.querySelector('.ambient-icon-pause');

  let currentTrack = null;
  let isPlaying = false;
  let audioCtx = null;
  let gainNode = null;

  function initAudioGraph() {
    if (gainNode) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaElementSource(audio);
    gainNode = audioCtx.createGain();
    source.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    applyVolume();
  }

  function resumeAudioContext() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(AMBIENT_STORAGE_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (typeof prefs.volume === 'number') {
        volumeSlider.value = String(Math.round(prefs.volume * 100));
      }
      if (prefs.track && TRACKS[prefs.track]) {
        currentTrack = prefs.track;
        setActiveTrack(currentTrack);
        audio.src = TRACKS[currentTrack].src;
      }
    } catch {
      /* ignore */
    }
    applyVolume();
  }

  function savePrefs() {
    localStorage.setItem(AMBIENT_STORAGE_KEY, JSON.stringify({
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
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;
  }

  function stopAudio() {
    audio.pause();
    audio.currentTime = 0;
    updatePlayUi(false);
  }

  function playCurrentTrack() {
    if (!currentTrack) return;

    initAudioGraph();
    resumeAudioContext();
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
