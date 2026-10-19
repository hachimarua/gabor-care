const app = document.querySelector("#app");

const APP_VERSION = "0.2.0";
const STORAGE_KEY = "gabor-care-state-v1";
const DEFAULT_STATE = {
  calibrationPxPerMm: null,
  distanceMm: 400,
  durationSec: 180,
  durationVersion: 2,
  contrast: 0.18,
  standardTrainingVersion: 2,
  standardTutorialCompleted: false,
  sessions: [],
  // やった日の記録。1日1件で、ホームの絵の点になる。sessions は90件で切るので別に持つ
  practiceDays: [],
};

const DOTS_PER_DRAWING = 100;
// 刺激の背景輝度。地とパッチの両方をこの値で塗る（以前は地だけ緑が3高く、四角い枠が見えていた）
const STAGE_GRAY = 136;
const STAGE_FILL = `rgb(${STAGE_GRAY},${STAGE_GRAY},${STAGE_GRAY})`;

let state = loadState();
let activeCleanup = null;
let drawings = null;
let homeVisible = false;
let firstHomeAnimation = true;

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const hadLegacyNudge = Object.hasOwn(stored, "nudge");
    delete stored.nudge;
    const isLegacyStandardTraining = stored.standardTrainingVersion !== 2;
    const isLegacyDuration = stored.durationVersion !== 2;
    const needsPracticeDays = !Array.isArray(stored.practiceDays);
    const loadedState = {
      ...DEFAULT_STATE,
      ...stored,
      durationSec: isLegacyDuration ? DEFAULT_STATE.durationSec : stored.durationSec ?? DEFAULT_STATE.durationSec,
      durationVersion: 2,
      // The old task used a different stimulus, so its adaptive contrast cannot
      // be meaningfully carried into the new central-only task.
      contrast: isLegacyStandardTraining ? DEFAULT_STATE.contrast : stored.contrast ?? DEFAULT_STATE.contrast,
      standardTrainingVersion: 2,
      standardTutorialCompleted: isLegacyStandardTraining ? false : Boolean(stored.standardTutorialCompleted),
      sessions: Array.isArray(stored.sessions) ? stored.sessions : [],
    };
    // 日ごとの記録が無い版から上がってきたときは、残っている記録から作る
    if (needsPracticeDays) loadedState.practiceDays = practiceDaysFromSessions(loadedState.sessions);
    if (hadLegacyNudge || needsPracticeDays) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(loadedState));
      } catch {
        // Keep the rest of the saved training state usable if storage is unavailable.
      }
    }
    return loadedState;
  } catch {
    return { ...DEFAULT_STATE, sessions: [], practiceDays: [] };
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function practiceDaysFromSessions(sessions) {
  const days = [];
  [...sessions].reverse().forEach((session) => {
    if (session.endedAt) addPracticeDayTo(days, session.endedAt, session.durationSec);
  });
  return days;
}

function addPracticeDayTo(days, iso, durationSec) {
  const date = dayKey(iso);
  const sec = durationSec || 180;
  const existing = days.find((day) => day.date === date);
  if (existing) existing.sec = Math.max(existing.sec, sec);
  else {
    days.push({ date, sec });
    days.sort((a, b) => a.date.localeCompare(b.date));
  }
}

async function retireLegacyNudgeSubscription(registration) {
  try {
    const subscription = await registration.pushManager?.getSubscription();
    if (subscription) await subscription.unsubscribe();
  } catch {
    // Notification cleanup must not prevent the training app from opening.
  }
  try {
    const notifications = await registration.getNotifications?.({ tag: "gabor-care-nudge" });
    notifications?.forEach((notification) => notification.close());
  } catch {
    // Some browsers do not expose notification cleanup.
  }
  try {
    await navigator.clearAppBadge?.();
  } catch {
    // Badge cleanup is optional.
  }
}

function setScreen(markup, cleanup = null) {
  activeCleanup?.();
  activeCleanup = cleanup;
  homeVisible = false;
  app.innerHTML = markup;
  window.scrollTo(0, 0);
}

function cssToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// ── 日付 ──

function pad(value) {
  return String(value).padStart(2, "0");
}

function dayKey(iso = new Date().toISOString()) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDayKey(key) {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

function monthDay(key) {
  const { month, day } = parseDayKey(key);
  return `${month}月${day}日`;
}

function formatDate(iso) {
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatToday() {
  const date = new Date();
  const weekday = "日月火水木金土"[date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日 ${weekday}曜`;
}

function durationLabel() {
  return state.durationSec === 60 ? "1分" : "3分";
}

function formatTimer(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

// ── 点描の絵 ──

async function loadDrawings() {
  try {
    const response = await fetch("./data/drawings.json");
    if (!response.ok) return;
    drawings = await response.json();
    if (homeVisible) renderHome({ animate: firstHomeAnimation ? "all" : "none" });
    firstHomeAnimation = false;
  } catch {
    // 絵が読めなくてもトレーニングはできる。ホームは数字だけで出る
  }
}

function decodeName(base64) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// 月ごとの色相。2026年10月をアクセント（H145）とし、25°ずつ ±50° の範囲を往復する
const MONTH_HUES = [145, 120, 95, 120, 145, 170, 195, 170];

function monthHue(key) {
  const { year, month } = parseDayKey(key);
  const offset = (year - 2026) * 12 + (month - 10);
  return MONTH_HUES[((offset % 8) + 8) % 8];
}

function monthsBetween(fromKey, toKey) {
  const from = parseDayKey(fromKey);
  const to = parseDayKey(toKey);
  return (to.year - from.year) * 12 + (to.month - from.month);
}

function drawingProgress() {
  const days = state.practiceDays;
  const count = days.length;
  const total = drawings?.drawings?.length ?? 0;
  const finished = Math.floor(count / DOTS_PER_DRAWING);
  if (count > 0 && count % DOTS_PER_DRAWING === 0 && finished <= Math.max(total, 1)) {
    const index = finished - 1;
    return { mode: "done", index, count, days: days.slice(index * DOTS_PER_DRAWING, finished * DOTS_PER_DRAWING) };
  }
  if (total > 0 && finished >= total) return { mode: "shelf", index: finished, count, days: [] };
  return { mode: "growing", index: finished, count, days: days.slice(finished * DOTS_PER_DRAWING) };
}

function drawingSvg(points, days, { completed = false, animateFrom = Infinity, label = "" } = {}) {
  const today = dayKey();
  const circles = days.map((day, index) => {
    const [x, y] = points[index];
    const age = monthsBetween(day.date, today);
    const opacity = completed || age <= 0 ? 1 : age === 1 ? 0.72 : 0.45;
    const animated = index >= animateFrom;
    const isLast = index === days.length - 1;
    const classes = ["seed", `hue-${monthHue(day.date)}`];
    if (animated) classes.push("grow-in");
    if (animated && isLast) classes.push("last");
    const delay = animated ? `animation-delay:${(index - animateFrom) * 18}ms;` : "";
    return `<circle class="${classes.join(" ")}" cx="${x}" cy="${y}" r="${day.sec >= 180 ? 6.6 : 4.2}" style="--o:${opacity};${delay}"/>`;
  });
  if (!completed && days.length < points.length) {
    const [x, y] = points[days.length];
    circles.push(`<circle class="seed-next" cx="${x}" cy="${y}" r="6.6"/>`);
  }
  return `<svg class="grow-svg" viewBox="0 0 320 320" role="img" aria-label="${label}">${circles.join("")}</svg>`;
}

function todaySessionCount() {
  const today = dayKey();
  return state.sessions.filter((session) => session.endedAt && dayKey(session.endedAt) === today).length;
}

function startHint(progress) {
  const todayCount = todaySessionCount();
  if (todayCount > 0) return `今日${todayCount + 1}回目`;
  if (progress.mode === "done") {
    const total = drawings?.drawings?.length ?? 0;
    // 最後の絵が完成した日は次の題材が無いので、通しの日数を出す
    return progress.index + 1 < total ? `${progress.index + 2}枚目 1日目` : `${progress.count + 1}日目`;
  }
  if (progress.mode === "shelf") return `${progress.count + 1}日目`;
  return `${progress.days.length + 1}日目`;
}

// ── ホーム ──

function renderHome({ animate = "none" } = {}) {
  const progress = drawingProgress();
  const history = state.sessions.slice(0, 6);
  const set = drawings?.drawings?.[progress.index];
  const animateFrom = animate === "all" ? 0 : animate === "new" ? Math.max(0, progress.days.length - 1) : Infinity;

  let figure = "";
  let summary = "";
  if (progress.mode === "shelf") {
    const thumbs = drawings.drawings.map((drawing, index) => drawingSvg(
      drawing.points,
      state.practiceDays.slice(index * DOTS_PER_DRAWING, (index + 1) * DOTS_PER_DRAWING),
      { completed: true, label: `${index + 1}枚目` },
    )).join("");
    figure = `
      <section class="shelf">
        <div class="shelf-grid">${thumbs}</div>
        <h2>${drawings.drawings.length}枚そろいました</h2>
        <p class="shelf-next">次のお題を決めましょう</p>
        <button class="btn btn--quiet copy-ask" id="copy-ask">相談用の文をコピー</button>
        <div class="status-line" id="copy-status" aria-live="polite"></div>
      </section>`;
  } else {
    const deviation = "1日やるごとに点が1つ増え、100日で1枚の絵になる。何の絵かは完成まで書かない。続けた日数が形になり、次の1日で何が見えるかが今日始める理由になるため";
    if (progress.mode === "done") {
      const first = progress.days[0].date;
      const last = progress.days[progress.days.length - 1].date;
      figure = `<section class="grow" data-deviation="${deviation}">${set ? drawingSvg(set.points, progress.days, { completed: true, animateFrom, label: `${progress.index + 1}枚目 完成` }) : ""}</section>`;
      summary = `
        <div class="done-head">
          <span class="done-name">${set ? decodeName(set.name_b64) : "完成"}</span>
          <span class="tally-sub">${progress.index + 1}枚目 ・ 100日 ・ ${monthDay(first)}〜${monthDay(last)}</span>
        </div>`;
    } else {
      const since = progress.days.length ? ` ・ ${monthDay(progress.days[0].date)}から` : "";
      figure = `<section class="grow" data-deviation="${deviation}">${set ? drawingSvg(set.points, progress.days, { animateFrom, label: `${progress.index + 1}枚目 ${progress.days.length}日分` }) : ""}</section>`;
      summary = `
        <div class="tally">
          <span class="tally-num num">${progress.days.length}<small>/${DOTS_PER_DRAWING}</small></span>
          <span class="tally-sub">${progress.index + 1}枚目${since}</span>
        </div>`;
    }
  }

  setScreen(`
    <main class="shell home">
      <header class="home-top">
        <span class="date-meta num">${formatToday()}</span>
        <button class="icon-btn" id="backstage-button" aria-label="使い方・設定">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
        </button>
      </header>
      ${figure}
      <div class="home-body">
        ${summary}
        <div class="starts">
          <button class="start start--lead" id="game-mode" data-lead>
            <span>絵探し</span>
            <span class="start-side"><span class="start-sub">${startHint(progress)}</span><span class="start-arrow" aria-hidden="true">→</span></span>
          </button>
          <button class="start" id="standard-mode">
            <span>中央の縞</span>
            <span class="start-arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      ${history.length ? `
        <section class="history">
          <div class="history-head">記録</div>
          <ul class="rows">
            ${history.map(historyRow).join("")}
          </ul>
        </section>
      ` : ""}
      <p class="footnote">医療機器ではありません。目の痛み・複視・急なかすみがある日は使わず、眼科を受診してください。</p>
    </main>
  `);
  homeVisible = true;

  document.querySelector("#backstage-button").addEventListener("click", () => openBackstage("help"));
  document.querySelector("#game-mode").addEventListener("click", () => beginMode("game"));
  document.querySelector("#standard-mode").addEventListener("click", () => beginMode("standard"));
  document.querySelector("#copy-ask")?.addEventListener("click", copyAsk);
}

function historyRow(session) {
  const tag = session.mode === "standard"
    ? "中央の縞"
    : session.gameDifficulty === "deep" || session.gameDifficulty === "normal" ? "絵探し・旧設定" : "";
  const value = session.mode === "standard" ? `${session.accuracy}%` : `${session.correct}問`;
  const fatigue = session.fatigueBefore == null ? "" : `疲れ ${session.fatigueBefore}→${session.fatigueAfter}`;
  return `
    <li class="row">
      <div class="row-main">
        <div class="num">${formatDate(session.endedAt)}</div>
        <div class="meta">${tag ? `<span class="tag">${tag}</span>` : ""}${fatigue}</div>
      </div>
      <div class="row-val num">${value}</div>
    </li>`;
}

async function copyAsk() {
  const names = drawings.drawings.map((drawing) => decodeName(drawing.name_b64)).join("、");
  const text = `Gabor Care の次の絵の題材を5つ考えて、data/drawings.json に追加してください。作り方は scripts/generate-drawings.py。これまでの${drawings.drawings.length}枚: ${names}`;
  const status = document.querySelector("#copy-status");
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "コピーしました";
  } catch {
    status.textContent = "コピーできませんでした。もう一度押してください";
  }
}

// ── 始める前／終わった後 ──

function beginMode(mode) {
  if (!state.calibrationPxPerMm) {
    renderCalibration(() => renderFatigue(mode, "before"));
    return;
  }
  renderFatigue(mode, "before");
}

function renderFatigue(mode, phase, sessionDraft = {}) {
  let value = phase === "before" ? 2 : sessionDraft.fatigueBefore;
  const title = phase === "before" ? "始める前の目の疲れ" : "終わった後の目の疲れ";
  const scale = Array.from({ length: 11 }, (_, number) => (
    `<button class="scale-btn num ${number === value ? "on" : ""}" data-value="${number}" aria-pressed="${number === value}">${number}</button>`
  )).join("");

  setScreen(`
    <main class="shell screen">
      <header class="bar">
        <button class="icon-btn" id="back-button" aria-label="戻る">‹</button>
        <div class="bar-title">${title}</div>
        <span></span>
      </header>
      <section class="body">
        <div class="scale" data-lead aria-label="目の疲れ 0から10">${scale}</div>
        <div class="scale-ends meta"><span>0 疲れなし</span><span>10 かなり強い</span></div>
        ${phase === "before" ? `
          <div class="field">
            <div class="field-label">時間</div>
            <div class="seg">
              <button class="seg-btn ${state.durationSec === 60 ? "on" : ""}" data-duration="60">1分</button>
              <button class="seg-btn ${state.durationSec === 180 ? "on" : ""}" data-duration="180">3分</button>
            </div>
          </div>
        ` : ""}
        <button class="btn push-down" id="fatigue-next">${phase === "before" ? "開始" : "休憩へ"}</button>
      </section>
    </main>
  `);

  document.querySelectorAll(".scale-btn").forEach((button) => {
    button.addEventListener("click", () => {
      value = Number(button.dataset.value);
      document.querySelectorAll(".scale-btn").forEach((other) => {
        const on = other === button;
        other.classList.toggle("on", on);
        other.setAttribute("aria-pressed", String(on));
      });
    });
  });
  document.querySelectorAll("[data-duration]").forEach((button) => {
    button.addEventListener("click", () => {
      state.durationSec = Number(button.dataset.duration);
      saveState();
      document.querySelectorAll("[data-duration]").forEach((other) => other.classList.toggle("on", other === button));
    });
  });
  document.querySelector("#back-button").addEventListener("click", phase === "before" ? () => renderHome() : () => renderResult(sessionDraft));
  document.querySelector("#fatigue-next").addEventListener("click", () => {
    if (phase === "before") {
      const draft = { mode, fatigueBefore: value, startedAt: new Date().toISOString() };
      if (mode === "standard") startStandard(draft);
      else startGame(draft);
    } else {
      renderRest({ ...sessionDraft, fatigueAfter: value, fatigueDelta: value - sessionDraft.fatigueBefore });
    }
  });
}

// ── 中央の縞 ──

function startStandard(draft) {
  let remaining = state.durationSec;
  let timerId;
  let timeoutIds = [];
  let running = true;
  let awaitingAnswer = false;
  let targetPresent = false;
  let trials = 0;
  let correct = 0;
  let correctStreak = 0;
  let contrast = state.contrast;
  let trialStart = 0;
  const reactionTimes = [];
  let isPractice = !state.standardTutorialCompleted;
  let practiceTrials = 0;
  const practiceSequence = [true, false, true];

  setScreen(`
    <main class="training-shell">
      <header class="training-top">
        <button class="icon-btn" id="quit-button" aria-label="終了">×</button>
        <div class="timer num" id="timer">${formatTimer(remaining)}</div>
        <span></span>
      </header>
      <section class="trial-stage">
        <canvas id="stimulus-canvas" aria-label="ガボール刺激"></canvas>
        <div class="ready" id="stage-message">
          <h3 id="ready-title">${isPractice ? "練習 3問" : "中央の十字を見る"}</h3>
          <div class="meta" id="ready-meta">画面から40cm ・ 裸眼</div>
          <button class="btn" id="ready-button" data-lead>${isPractice ? "練習を始める" : "開始"}</button>
        </div>
      </section>
      <footer class="answer-area">
        <div class="ask" id="prompt"></div>
        <div class="choices">
          <button class="choice" id="choice-seen" disabled>見えた</button>
          <button class="choice" id="choice-absent" disabled>出なかった</button>
        </div>
      </footer>
    </main>
  `, cleanup);

  const canvas = document.querySelector("#stimulus-canvas");
  const message = document.querySelector("#stage-message");
  const prompt = document.querySelector("#prompt");
  const choiceSeen = document.querySelector("#choice-seen");
  const choiceAbsent = document.querySelector("#choice-absent");
  const ctx = prepareCanvas(canvas);
  drawNeutral(ctx, canvas);

  document.querySelector("#ready-button").addEventListener("click", () => {
    message.hidden = true;
    if (isPractice) runTrial();
    else startTimedSession();
  }, { once: true });

  choiceSeen.addEventListener("click", () => answer(true));
  choiceAbsent.addEventListener("click", () => answer(false));
  document.querySelector("#quit-button").addEventListener("click", () => {
    cleanup();
    renderHome();
  });

  function runTrial() {
    if (!running) return;
    awaitingAnswer = false;
    choiceSeen.disabled = true;
    choiceAbsent.disabled = true;
    targetPresent = isPractice ? practiceSequence[practiceTrials] : Math.random() < 0.5;
    const spatialFrequency = [2, 4, 6][Math.floor(Math.random() * 3)];
    const orientation = [0, 45, 90, 135][Math.floor(Math.random() * 4)];
    const trial = { spatialFrequency, orientation };

    prompt.textContent = "";
    drawFixation(ctx, canvas);
    schedule(() => drawStandardFrame(ctx, canvas, trial, targetPresent, isPractice ? 0.32 : contrast), 500);
    schedule(() => {
      drawFixation(ctx, canvas);
      prompt.textContent = "縞は見えましたか";
      awaitingAnswer = true;
      trialStart = performance.now();
      choiceSeen.disabled = false;
      choiceAbsent.disabled = false;
    }, 1000);
  }

  function feedback(isCorrect) {
    if (isCorrect) return "正解";
    return targetPresent ? "縞は出ていました" : "縞は出ていません";
  }

  function answer(selected) {
    if (!awaitingAnswer || !running) return;
    awaitingAnswer = false;
    const isCorrect = selected === targetPresent;
    choiceSeen.disabled = true;
    choiceAbsent.disabled = true;
    prompt.textContent = feedback(isCorrect);
    if (navigator.vibrate) navigator.vibrate(isCorrect ? 20 : [20, 40, 20]);
    if (isPractice) {
      practiceTrials += 1;
      schedule(practiceTrials >= 3 ? showTimedStart : runTrial, 650);
      return;
    }

    trials += 1;
    reactionTimes.push(performance.now() - trialStart);
    if (isCorrect) {
      correct += 1;
      correctStreak += 1;
      if (correctStreak >= 2) {
        contrast = Math.max(0.015, contrast * 0.84);
        correctStreak = 0;
      }
    } else {
      contrast = Math.min(0.45, contrast * 1.2);
      correctStreak = 0;
    }
    schedule(runTrial, 500);
  }

  function showTimedStart() {
    if (!running) return;
    isPractice = false;
    state.standardTutorialCompleted = true;
    saveState();
    drawNeutral(ctx, canvas);
    prompt.textContent = "";
    document.querySelector("#ready-title").textContent = "練習おわり";
    document.querySelector("#ready-meta").textContent = `ここから${durationLabel()}`;
    const button = document.querySelector("#ready-button");
    button.textContent = "本番を始める";
    message.hidden = false;
    button.addEventListener("click", () => {
      message.hidden = true;
      startTimedSession();
    }, { once: true });
  }

  function startTimedSession() {
    timerId = window.setInterval(() => {
      remaining -= 1;
      document.querySelector("#timer").textContent = formatTimer(remaining);
      if (remaining <= 0) finish();
    }, 1000);
    runTrial();
  }

  function finish() {
    if (!running) return;
    cleanup();
    state.contrast = contrast;
    saveState();
    const result = {
      ...draft,
      trials,
      correct,
      accuracy: trials ? Math.round((correct / trials) * 100) : 0,
      finalContrast: Math.round(contrast * 1000) / 10,
      meanReactionMs: reactionTimes.length
        ? Math.round(reactionTimes.reduce((sum, value) => sum + value, 0) / reactionTimes.length)
        : null,
      durationSec: state.durationSec,
      endedAt: new Date().toISOString(),
    };
    renderResult(result);
  }

  function schedule(fn, delay) {
    const id = window.setTimeout(fn, delay);
    timeoutIds.push(id);
  }

  function cleanup() {
    running = false;
    window.clearInterval(timerId);
    timeoutIds.forEach(window.clearTimeout);
    timeoutIds = [];
  }
}

// ── 絵探し ──

function startGame(draft) {
  const columns = 4;
  const rows = 4;
  let remaining = state.durationSec;
  let timerId;
  let running = true;
  let acceptingInput = true;
  let correct = 0;
  let attempts = 0;
  let targetIndex = 0;
  let patches = [];
  let sample = null;

  setScreen(`
    <main class="training-shell game-training-shell">
      <header class="training-top">
        <button class="icon-btn" id="quit-button" aria-label="終了">×</button>
        <div class="timer num" id="timer">${formatTimer(remaining)}</div>
        <span></span>
      </header>
      <section class="sample-bar">
        <canvas class="sample-canvas" id="sample-canvas" width="152" height="152" aria-label="見本"></canvas>
        <span class="meta">見本</span>
        <div class="score"><b class="num" id="game-score">0</b><span class="meta">正解</span></div>
      </section>
      <section class="game-stage" data-lead>
        <canvas id="game-canvas" aria-label="16個の縞から選ぶ"></canvas>
      </section>
    </main>
  `, cleanup);

  const canvas = document.querySelector("#game-canvas");
  const sampleCanvas = document.querySelector("#sample-canvas");
  prepareCanvas(canvas);
  drawRound();

  timerId = window.setInterval(() => {
    remaining -= 1;
    document.querySelector("#timer").textContent = formatTimer(remaining);
    if (remaining <= 0) finish();
  }, 1000);

  canvas.addEventListener("pointerup", onTap);
  document.querySelector("#quit-button").addEventListener("click", () => {
    cleanup();
    renderHome();
  });

  function drawRound() {
    const orientations = [0, 45, 90, 135];
    const frequencies = [2, 3, 4, 5];
    const combinations = orientations.flatMap((orientation) =>
      frequencies.map((spatialFrequency) => ({
        orientation,
        spatialFrequency,
        phase: 0,
      }))
    );
    sample = {
      orientation: orientations[Math.floor(Math.random() * orientations.length)],
      spatialFrequency: frequencies[Math.floor(Math.random() * frequencies.length)],
      phase: 0,
    };
    patches = shuffle(combinations);
    targetIndex = patches.findIndex((patch) => isSameGamePatch(patch, sample));
    canvas.dataset.targetIndex = String(targetIndex);
    canvas.dataset.matchingCount = String(
      patches.filter((patch) => isSameGamePatch(patch, sample)).length
    );
    acceptingInput = true;
    drawSample(sampleCanvas, sample);
    drawGameGrid(canvas, patches, { columns, rows });
  }

  function onTap(event) {
    if (!running || !acceptingInput) return;
    const rect = canvas.getBoundingClientRect();
    const col = Math.floor(((event.clientX - rect.left) / rect.width) * columns);
    const row = Math.floor(((event.clientY - rect.top) / rect.height) * rows);
    const selected = row * columns + col;
    if (selected < 0 || selected >= patches.length) return;
    acceptingInput = false;
    attempts += 1;
    if (selected === targetIndex) {
      correct += 1;
      document.querySelector("#game-score").textContent = correct;
      if (navigator.vibrate) navigator.vibrate(20);
      drawGameGrid(canvas, patches, { columns, rows, correctIndex: targetIndex });
      window.setTimeout(drawRound, 280);
    } else {
      if (navigator.vibrate) navigator.vibrate([20, 40, 20]);
      drawGameGrid(canvas, patches, {
        columns,
        rows,
        wrongIndex: selected,
        correctIndex: targetIndex,
      });
      window.setTimeout(drawRound, 700);
    }
  }

  function finish() {
    if (!running) return;
    cleanup();
    renderResult({
      ...draft,
      correct,
      attempts,
      accuracy: attempts ? Math.round((correct / attempts) * 100) : 0,
      durationSec: state.durationSec,
      endedAt: new Date().toISOString(),
    });
  }

  function cleanup() {
    running = false;
    window.clearInterval(timerId);
    canvas?.removeEventListener("pointerup", onTap);
  }
}

// ── 結果・休憩 ──

function renderResult(result) {
  const isStandard = result.mode === "standard";
  const facts = isStandard
    ? [
      ["正解 / 試行", `${result.correct} / ${result.trials}`],
      ["最終コントラスト", `${result.finalContrast}%`],
      ["平均反応時間", result.meanReactionMs ? `${result.meanReactionMs}ms` : "−"],
    ]
    : [
      ["タップ", `${result.attempts}`],
      ["正答率", `${result.accuracy}%`],
    ];

  // 結果画面には×を置かない。以前は×でその回の記録が保存されずに消えていた
  setScreen(`
    <main class="shell screen">
      <header class="bar">
        <span></span>
        <div class="bar-title">結果</div>
        <span></span>
      </header>
      <section class="body">
        <div class="result num" data-lead>${isStandard ? `${result.accuracy}%` : result.correct}</div>
        <div class="result-label">${isStandard ? "正答率" : "正解"}</div>
        <ul class="facts">
          ${facts.map(([label, value]) => `<li class="fact"><span>${label}</span><b class="num">${value}</b></li>`).join("")}
        </ul>
        <button class="btn push-down" id="result-next">目の疲れを記録</button>
      </section>
    </main>
  `);

  document.querySelector("#result-next").addEventListener("click", () => renderFatigue(result.mode, "after", result));
}

function renderRest(result) {
  let remaining = 20;
  let completed = false;
  let timerId;

  setScreen(`
    <main class="shell screen">
      <header class="bar">
        <span></span>
        <div class="bar-title">目の休憩</div>
        <span></span>
      </header>
      <section class="body">
        <h2 class="rest-say">6m先を見る</h2>
        <div class="ring" data-lead data-deviation="休憩中は残り時間だけを大きく出し、円が減る動きで経過を見せる。遠くを見ていて画面へ視線を戻したとき、数字を読まなくても残りが分かるようにするため">
          <svg viewBox="0 0 260 260" aria-hidden="true"><circle class="ring-track" cx="130" cy="130" r="122"/><circle class="ring-left" cx="130" cy="130" r="122"/></svg>
          <div class="ring-count num" id="rest-count">${remaining}</div>
        </div>
        <button class="btn push-down" id="finish-button" disabled>記録して終わる</button>
      </section>
    </main>
  `, cleanup);

  timerId = window.setInterval(() => {
    remaining -= 1;
    document.querySelector("#rest-count").textContent = remaining;
    if (remaining <= 0) {
      window.clearInterval(timerId);
      completed = true;
      document.querySelector("#finish-button").disabled = false;
      // 画面から目を離しているので、終わりを振動で知らせる
      if (navigator.vibrate) navigator.vibrate([30, 60, 30]);
    }
  }, 1000);

  document.querySelector("#finish-button").addEventListener("click", () => {
    if (!completed) return;
    cleanup();
    state.sessions.unshift(result);
    state.sessions = state.sessions.slice(0, 90);
    addPracticeDayTo(state.practiceDays, result.endedAt, result.durationSec);
    saveState();
    renderHome({ animate: "new" });
  });

  function cleanup() {
    window.clearInterval(timerId);
  }
}

// ── 画面サイズ合わせ ──

function renderCalibration(afterSave = () => renderHome()) {
  const onComplete = typeof afterSave === "function" ? afterSave : () => renderHome();
  const maxPx = Math.max(200, Math.min(window.innerWidth, 520) - 80);
  let linePx = state.calibrationPxPerMm ? Math.round(state.calibrationPxPerMm * 53.98) : Math.min(300, maxPx);

  setScreen(`
    <main class="shell screen">
      <header class="bar">
        <button class="icon-btn" id="back-button" aria-label="戻る">‹</button>
        <div class="bar-title">画面サイズ合わせ</div>
        <span></span>
      </header>
      <section class="body">
        <h2>カードの短い辺と同じ長さに</h2>
        <div class="meta">53.98mm ・ カードは画面の横に置く</div>
        <div class="cal-line-box" data-lead><div class="cal-line" id="calibration-line" style="width:${linePx}px"></div></div>
        <div class="cal-ctrl">
          <button class="step" id="calibration-minus" aria-label="短くする">−</button>
          <input id="calibration-range" type="range" min="160" max="${maxPx}" step="1" value="${linePx}" aria-label="線の長さ" />
          <button class="step" id="calibration-plus" aria-label="長くする">＋</button>
        </div>
        <button class="btn push-down" id="save-calibration">保存</button>
      </section>
    </main>
  `);

  const range = document.querySelector("#calibration-range");
  const line = document.querySelector("#calibration-line");
  const setLength = (px) => {
    linePx = Math.min(maxPx, Math.max(160, px));
    range.value = String(linePx);
    line.style.width = `${linePx}px`;
  };
  range.addEventListener("input", () => setLength(Number(range.value)));
  document.querySelector("#calibration-minus").addEventListener("click", () => setLength(linePx - 1));
  document.querySelector("#calibration-plus").addEventListener("click", () => setLength(linePx + 1));
  document.querySelector("#back-button").addEventListener("click", () => renderHome());
  document.querySelector("#save-calibration").addEventListener("click", () => {
    state.calibrationPxPerMm = linePx / 53.98;
    saveState();
    onComplete();
  });
}

// ── 使い方・設定（裏方シート） ──

const FAQ = [
  ["画面からどのくらい離れる？", "約40cm離れます。眼鏡やコンタクトは外し、普段の部屋の明るさで行います。見づらさを我慢して続ける必要はありません。"],
  ["ホームの点は何を表す？", "やった日を1日1つずつ表しています。1日に何回やっても1つです。100日で1枚の絵になり、何の絵かは完成するまで分かりません。色は月ごとに変わり、古い月ほど薄くなります。"],
  ["画面サイズ合わせは何のため？", "端末ごとに画面の実寸が違うためです。40cm離れたときの縞の細かさを計算するのに使います。クレジットカードや運転免許証の短い辺で合わせます。端末を変えたら合わせ直します。"],
  ["目の疲れの数字の付け方は？", "0は疲れなし、10はかなり強い疲れです。始める前と終わった後に付け、記録に前後の変化が残ります。"],
  ["休憩で遠くを見るのはなぜ？", "近くを見続けた後に、約6m先を20秒見て、目のピント調節を休めます。肩の力を抜き、意識して数回まばたきをします。"],
  ["使うのをやめる目安は？", "目の痛み、物が二重に見える、頭痛や吐き気、急なかすみ、片目だけの見え方の変化、終わった後も続く強い疲れ。どれかがあればその日は中止し、眼科を受診します。"],
  ["このアプリは何のため？", "ガボール刺激を使った見え方の練習と、近くを見た後の休憩を続けるための個人用ツールです。医療機器ではなく、視力検査や屈折異常の治療の代わりにはなりません。記録はこの端末の中だけに保存します。"],
];

function openBackstage(tab = "help") {
  closeBackstage();
  const layer = document.createElement("div");
  layer.className = "sheet-layer";
  layer.id = "backstage";
  layer.innerHTML = `
    <div class="sheet-scrim" id="backstage-scrim"></div>
    <section class="sheet" role="dialog" aria-modal="true" aria-label="使い方・設定">
      <div class="sheet-grab"></div>
      <div class="sheet-head">
        <span class="sheet-title">使い方・設定</span>
        <button class="text-btn" id="backstage-close">閉じる</button>
      </div>
      <div class="tabs" role="tablist">
        <button class="tab" role="tab" data-tab="help">使い方</button>
        <button class="tab" role="tab" data-tab="settings">設定</button>
        <button class="tab" role="tab" data-tab="maintenance">保守</button>
      </div>
      <div class="sheet-body" id="backstage-body"></div>
    </section>
  `;
  document.body.append(layer);
  layer.querySelector("#backstage-scrim").addEventListener("click", closeBackstage);
  layer.querySelector("#backstage-close").addEventListener("click", closeBackstage);
  layer.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => showBackstageTab(button.dataset.tab));
  });
  document.addEventListener("keydown", onBackstageKey);
  showBackstageTab(tab);
  layer.querySelector("#backstage-close").focus();
}

function closeBackstage() {
  document.querySelector("#backstage")?.remove();
  document.removeEventListener("keydown", onBackstageKey);
}

function onBackstageKey(event) {
  if (event.key === "Escape") closeBackstage();
}

function showBackstageTab(tab) {
  const layer = document.querySelector("#backstage");
  if (!layer) return;
  layer.querySelectorAll("[data-tab]").forEach((button) => {
    const on = button.dataset.tab === tab;
    button.classList.toggle("on", on);
    button.setAttribute("aria-selected", String(on));
  });
  const body = layer.querySelector("#backstage-body");

  if (tab === "help") {
    body.innerHTML = `
      <div class="group">
        <div class="group-head">できること</div>
        <div class="card">
          <div class="can"><b>絵探し</b><span>見本と同じ向き・細かさの縞を、16個から選ぶ</span></div>
          <div class="can"><b>中央の縞</b><span>中央に縞が出たかを答える。正解が続くと縞が薄くなる</span></div>
        </div>
      </div>
      <div class="group">
        <div class="group-head">よくある質問</div>
        <div class="card">
          ${FAQ.map(([question, answer]) => `<details><summary>${question}</summary><p>${answer}</p></details>`).join("")}
        </div>
      </div>
    `;
    return;
  }

  if (tab === "settings") {
    const practicePending = !state.standardTutorialCompleted;
    body.innerHTML = `
      <div class="group">
        <div class="group-head">画面サイズ</div>
        <div class="card">
          <div class="row">
            <div class="row-main">${state.calibrationPxPerMm ? "合わせ済み" : "まだ合わせていません"}</div>
            <button class="btn btn--quiet" id="recalibrate">${state.calibrationPxPerMm ? "合わせ直す" : "合わせる"}</button>
          </div>
        </div>
      </div>
      <div class="group">
        <div class="group-head">中央の縞</div>
        <div class="card">
          <div class="row">
            <div class="row-main">練習 3問</div>
            <button class="btn btn--quiet" id="practice-again" ${practicePending ? "disabled" : ""}>${practicePending ? "次回に練習します" : "次回もう一度"}</button>
          </div>
        </div>
      </div>
    `;
    body.querySelector("#recalibrate").addEventListener("click", () => {
      closeBackstage();
      renderCalibration();
    });
    body.querySelector("#practice-again").addEventListener("click", () => {
      state.standardTutorialCompleted = false;
      saveState();
      showBackstageTab("settings");
    });
    return;
  }

  body.innerHTML = `
    <div class="group">
      <div class="group-head">データ</div>
      <div class="card">
        <div class="row"><div class="row-main">記録</div><div class="row-val num">${state.sessions.length}件</div></div>
        <div class="row"><div class="row-main">やった日</div><div class="row-val num">${state.practiceDays.length}日</div></div>
      </div>
    </div>
    <div class="group">
      <div class="group-head">困ったとき</div>
      <div class="card">
        <div class="row"><div class="row-main">表示が古いまま</div><button class="btn btn--quiet" id="check-update">更新を確認</button></div>
      </div>
      <div class="status-line" id="update-status" aria-live="polite"></div>
    </div>
    <div class="group danger-zone">
      <div class="group-head">取り消せない操作</div>
      <button class="btn btn--danger" id="clear-button">記録と設定を消去</button>
    </div>
    <div class="group">
      <div class="group-head">このアプリについて</div>
      <div class="meta">Gabor Care ${APP_VERSION} ・ 医療機器ではありません</div>
    </div>
  `;
  body.querySelector("#check-update").addEventListener("click", checkForUpdate);
  body.querySelector("#clear-button").addEventListener("click", () => {
    if (window.confirm("記録・やった日・設定をすべて消去しますか？ ホームの絵も最初からになります。")) {
      state = { ...DEFAULT_STATE, sessions: [], practiceDays: [] };
      saveState();
      closeBackstage();
      renderHome();
    }
  });
}

async function checkForUpdate() {
  const status = document.querySelector("#update-status");
  const button = document.querySelector("#check-update");
  button.disabled = true;
  status.textContent = "確認しています";
  try {
    // 配信元に届くか先に確かめる。届かなければ再読み込みしても古いままなので止める
    const response = await fetch(`./index.html?check=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(String(response.status));
    const registration = await navigator.serviceWorker?.getRegistration();
    await registration?.update();
    status.textContent = "最新の状態を読み込みます";
    window.setTimeout(() => window.location.reload(), 400);
  } catch {
    status.textContent = "通信できませんでした。電波のある場所でもう一度押してください";
    button.disabled = false;
  }
}

// ── 刺激の描画 ──

function prepareCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function canvasCssSize(canvas) {
  const dpr = window.devicePixelRatio || 1;
  return { width: canvas.width / dpr, height: canvas.height / dpr };
}

function drawNeutral(ctx, canvas) {
  const { width, height } = canvasCssSize(canvas);
  ctx.fillStyle = STAGE_FILL;
  ctx.fillRect(0, 0, width, height);
}

function drawFixation(ctx, canvas) {
  drawNeutral(ctx, canvas);
  const { width, height } = canvasCssSize(canvas);
  ctx.strokeStyle = "rgba(30,36,31,.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width / 2 - 6, height / 2);
  ctx.lineTo(width / 2 + 6, height / 2);
  ctx.moveTo(width / 2, height / 2 - 6);
  ctx.lineTo(width / 2, height / 2 + 6);
  ctx.stroke();
}

function drawStandardFrame(ctx, canvas, trial, hasTarget, contrast) {
  drawNeutral(ctx, canvas);
  const { width, height } = canvasCssSize(canvas);
  const pxPerMm = state.calibrationPxPerMm || 5;
  const periodPx = periodPixels(trial.spatialFrequency, pxPerMm, state.distanceMm);
  const sigma = Math.max(10, periodPx * 1.1);
  const centerX = width / 2;
  const centerY = height / 2;
  if (hasTarget) {
    drawGabor(ctx, centerX, centerY, {
      ...trial,
      periodPx,
      sigma,
      contrast,
    });
  }
}

function periodPixels(cyclesPerDegree, pxPerMm, distanceMm) {
  const degreePerCycle = 1 / cyclesPerDegree;
  const periodMm = 2 * distanceMm * Math.tan((degreePerCycle * Math.PI / 180) / 2);
  return periodMm * pxPerMm;
}

function drawGabor(ctx, cx, cy, options) {
  const {
    periodPx,
    sigma,
    orientation,
    contrast = 0.5,
    phase = 0,
  } = options;
  const scale = ctx.getTransform().a || 1;
  const devicePeriodPx = periodPx * scale;
  const deviceSigma = sigma * scale;
  const deviceCx = cx * scale;
  const deviceCy = cy * scale;
  const radius = Math.ceil(deviceSigma * 3);
  const size = radius * 2 + 1;
  const image = ctx.createImageData(size, size);
  const theta = orientation * Math.PI / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const background = STAGE_GRAY;

  for (let py = -radius; py <= radius; py += 1) {
    for (let px = -radius; px <= radius; px += 1) {
      const rotatedX = px * cos + py * sin;
      const envelope = Math.exp(-(px * px + py * py) / (2 * deviceSigma * deviceSigma));
      const carrier = Math.cos((2 * Math.PI * rotatedX) / devicePeriodPx + phase);
      const luminance = Math.max(0, Math.min(255, background + background * contrast * envelope * carrier));
      const index = ((py + radius) * size + (px + radius)) * 4;
      image.data[index] = luminance;
      image.data[index + 1] = luminance;
      image.data[index + 2] = luminance;
      image.data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, Math.round(deviceCx - radius), Math.round(deviceCy - radius));
}

function drawSample(canvas, patch) {
  const ctx = prepareCanvas(canvas);
  const { width, height } = canvasCssSize(canvas);
  ctx.fillStyle = STAGE_FILL;
  ctx.fillRect(0, 0, width, height);
  const pxPerMm = state.calibrationPxPerMm || 5;
  const periodPx = periodPixels(patch.spatialFrequency, pxPerMm, state.distanceMm);
  drawGabor(ctx, width / 2, height / 2, {
    ...patch,
    periodPx,
    sigma: 11,
    contrast: 0.72,
  });
}

function drawGameGrid(canvas, patches, options = {}) {
  const {
    columns = 4,
    rows = 4,
    wrongIndex = null,
    correctIndex = null,
  } = options;
  const ctx = prepareCanvas(canvas);
  const { width, height } = canvasCssSize(canvas);
  ctx.fillStyle = STAGE_FILL;
  ctx.fillRect(0, 0, width, height);
  const cellW = width / columns;
  const cellH = height / rows;
  const pxPerMm = state.calibrationPxPerMm || 5;

  patches.forEach((patch, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const periodPx = periodPixels(patch.spatialFrequency, pxPerMm, state.distanceMm);
    drawGabor(ctx, col * cellW + cellW / 2, row * cellH + cellH / 2, {
      ...patch,
      periodPx: Math.max(4, periodPx),
      sigma: 11,
      contrast: 0.72,
    });
  });

  // 正解は実線、誤答は破線。色だけで区別しない
  const outline = (index, color, lineWidth, dash) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(col * cellW + 6, row * cellH + 6, cellW - 12, cellH - 12);
    ctx.setLineDash([]);
  };
  if (correctIndex != null) outline(correctIndex, cssToken("--accent"), 4, []);
  if (wrongIndex != null) outline(wrongIndex, cssToken("--miss"), 3, [8, 6]);
}

function isSameGamePatch(left, right) {
  return (
    left.orientation === right.orientation &&
    left.spatialFrequency === right.spatialFrequency
  );
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function handleHashRoute() {
  if (location.hash === "#standard") beginMode("standard");
  else if (location.hash === "#game") beginMode("game");
}

window.addEventListener("hashchange", handleHashRoute);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    await navigator.serviceWorker.register("./sw.js");
    void navigator.serviceWorker.ready
      .then(retireLegacyNudgeSubscription)
      .catch(() => {});
  });
}

renderHome();
loadDrawings();
handleHashRoute();
