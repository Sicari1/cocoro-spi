(function () {
  const BADGES = [
    { id: "first-correct", icon: "🌟", name: "初正解", check: (summary) => summary.totalCorrect >= 1 },
    { id: "streak-3", icon: "🔥", name: "3日連続", check: (summary) => summary.streak.current >= 3 },
    { id: "correct-50", icon: "💯", name: "50問正解", check: (summary) => summary.totalCorrect >= 50 },
    { id: "perfect-exam", icon: "🎯", name: "模試満点", check: (summary) => summary.exams.some((item) => item.score === item.total) },
    { id: "exam-80", icon: "🚀", name: "80%以上", check: (summary) => summary.exams.some((item) => item.percent >= 80) },
    { id: "steady", icon: "☁️", name: "継続学習", check: (summary) => summary.totalAttempts >= 20 },
    { id: "all-categories", icon: "📚", name: "全分野挑戦", check: (summary) => ["verbal", "nonverbal", "english"].every((key) => (summary.byCategory[key] || {}).attempts > 0) },
    { id: "master", icon: "👑", name: "SPI上級", check: (summary) => summary.totalCorrect >= 100 && summary.exams.some((item) => item.percent >= 90) },
  ];

  let summaryCache = {
    attempts: {},
    exams: [],
    daily: {},
    totalAttempts: 0,
    totalCorrect: 0,
    byCategory: {
      verbal: { attempts: 0, correct: 0 },
      nonverbal: { attempts: 0, correct: 0 },
      english: { attempts: 0, correct: 0 },
    },
    byType: {},
    streak: { current: 0, longest: 0, totalDaysPracticed: 0 },
  };

  function recomputeTotals() {
    const attempts = summaryCache.attempts || {};
    summaryCache.totalAttempts = 0;
    summaryCache.totalCorrect = 0;
    summaryCache.byCategory = {
      verbal: { attempts: 0, correct: 0 },
      nonverbal: { attempts: 0, correct: 0 },
      english: { attempts: 0, correct: 0 },
    };
    summaryCache.byType = {};
    Object.keys(attempts).forEach((questionId) => {
      const item = attempts[questionId];
      summaryCache.totalAttempts += item.attempts;
      summaryCache.totalCorrect += item.correct;
      if (summaryCache.byCategory[item.category]) {
        summaryCache.byCategory[item.category].attempts += item.attempts;
        summaryCache.byCategory[item.category].correct += item.correct;
      }
      if (!summaryCache.byType[item.type]) {
        summaryCache.byType[item.type] = { attempts: 0, correct: 0 };
      }
      summaryCache.byType[item.type].attempts += item.attempts;
      summaryCache.byType[item.type].correct += item.correct;
    });
  }

  function recomputeStreak() {
    const daily = summaryCache.daily || {};
    const days = Object.keys(daily).sort();
    let longest = 0;
    let run = 0;
    let prev = null;
    days.forEach((day) => {
      const current = new Date(`${day}T00:00:00`);
      if (prev && Math.round((current - prev) / 86400000) === 1) {
        run += 1;
      } else {
        run = 1;
      }
      longest = Math.max(longest, run);
      prev = current;
    });
    let currentRun = 0;
    const today = new Date();
    for (let i = 0; i < 365; i += 1) {
      const check = new Date(today);
      check.setDate(today.getDate() - i);
      const key = check.toISOString().slice(0, 10);
      if (daily[key]) {
        currentRun += 1;
      } else {
        break;
      }
    }
    summaryCache.streak = {
      current: currentRun,
      longest,
      totalDaysPracticed: days.length,
    };
  }

  function setSummary(summary) {
    summaryCache = summary || summaryCache;
    recomputeTotals();
    recomputeStreak();
  }

  function getSummary() {
    return summaryCache;
  }

  function getAttempt(questionId) {
    return summaryCache.attempts[questionId] || { attempts: 0, correct: 0, lastAttempted: null, wrongChoices: [] };
  }

  function syncAttemptToServer(question, selectedIndex, isCorrect) {
    window.APP.request("/api/attempts", {
      method: "POST",
      body: JSON.stringify({
        questionId: question.id,
        selectedIndex,
        isCorrect,
        category: question.category,
        type: question.type,
      }),
    }).catch((error) => console.error(error));
  }

  function syncExamToServer(record) {
    window.APP.request("/api/exams", {
      method: "POST",
      body: JSON.stringify(record),
    }).catch((error) => console.error(error));
  }

  function recordAttempt(question, selectedIndex, isCorrect) {
    const current = summaryCache.attempts[question.id] || {
      attempts: 0,
      correct: 0,
      lastAttempted: null,
      wrongChoices: [],
      category: question.category,
      type: question.type,
    };
    current.attempts += 1;
    if (isCorrect) {
      current.correct += 1;
    } else {
      current.wrongChoices = [selectedIndex].concat(current.wrongChoices || []).slice(0, 10);
    }
    current.lastAttempted = new Date().toISOString();
    current.category = question.category;
    current.type = question.type;
    summaryCache.attempts[question.id] = current;
    const day = new Date().toISOString().slice(0, 10);
    summaryCache.daily[day] = (summaryCache.daily[day] || 0) + 1;
    recomputeTotals();
    recomputeStreak();
    syncAttemptToServer(question, selectedIndex, isCorrect);
  }

  function recordExam(examRecord) {
    summaryCache.exams.unshift(examRecord);
    summaryCache.exams = summaryCache.exams.slice(0, 30);
    syncExamToServer(examRecord);
  }

  function getWeakAreas() {
    return Object.keys(summaryCache.byType)
      .map((type) => {
        const item = summaryCache.byType[type];
        return {
          type,
          attempts: item.attempts,
          accuracy: item.attempts ? Math.round((item.correct / item.attempts) * 100) : 0,
        };
      })
      .filter((item) => item.attempts >= 2)
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 3);
  }

  function getRecommendations() {
    const questions = window.APP.questions || [];
    const wrongFirst = questions.filter((question) => {
      const attempt = summaryCache.attempts[question.id];
      return attempt && attempt.attempts > attempt.correct;
    });
    const unplayed = questions.filter((question) => !summaryCache.attempts[question.id]);
    const weakTypes = getWeakAreas().map((item) => item.type);
    const weakTypeQuestion = questions.find((question) => weakTypes.includes(question.type));
    const results = [];
    if (wrongFirst[0]) {
      results.push({ title: "直近の誤答を復習", reason: "SPIは同じ型を落とさないことが得点安定につながります。", question: wrongFirst[0] });
    }
    if (unplayed[0]) {
      results.push({ title: "未着手の問題", reason: "新しい型への対応力も必要です。", question: unplayed[0] });
    }
    if (weakTypeQuestion && !results.some((item) => item.question.id === weakTypeQuestion.id)) {
      results.push({ title: "苦手タイプの補強", reason: "正答率の低い型を短時間で反復しましょう。", question: weakTypeQuestion });
    }
    return results;
  }

  function renderHeader() {
    const streakValue = document.getElementById("streak-value");
    const totalValue = document.getElementById("total-value");
    if (streakValue) {
      streakValue.textContent = String(summaryCache.streak.current);
    }
    if (totalValue) {
      totalValue.textContent = String(summaryCache.totalCorrect);
    }
  }

  function renderChart() {
    const svg = document.getElementById("score-chart-svg");
    if (!svg) {
      return;
    }
    const exams = summaryCache.exams.slice(0, 10).reverse();
    if (!exams.length) {
      svg.innerHTML = '<text x="300" y="88" text-anchor="middle" fill="#94a3b8" font-size="14" font-family="M PLUS Rounded 1c, sans-serif">まだ模試データがありません</text>';
      return;
    }
    const points = exams.map((exam, index) => {
      const x = 48 + (index * 504) / Math.max(1, exams.length - 1);
      const y = 128 - (exam.percent / 100) * 88;
      return { x, y, percent: exam.percent };
    });
    const line = points.map((point) => `${point.x},${point.y}`).join(" ");
    svg.innerHTML = `
      <defs>
        <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#61bce9"></stop>
          <stop offset="100%" stop-color="#8fd8ff"></stop>
        </linearGradient>
      </defs>
      <line x1="40" y1="128" x2="560" y2="128" stroke="#d9ebf7" stroke-width="2"></line>
      <line x1="40" y1="28" x2="40" y2="128" stroke="#d9ebf7" stroke-width="2"></line>
      <polyline fill="none" stroke="url(#lineGrad)" stroke-width="4" points="${line}"></polyline>
      ${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="5" fill="#5bb3d8"></circle><text x="${point.x}" y="${point.y - 12}" text-anchor="middle" fill="#475569" font-size="10">${point.percent}%</text>`).join("")}
    `;
  }

  function renderHeatmap() {
    const container = document.getElementById("heatmap");
    if (!container) {
      return;
    }
    container.innerHTML = "";
    for (let index = 29; index >= 0; index -= 1) {
      const day = new Date();
      day.setDate(day.getDate() - index);
      const key = day.toISOString().slice(0, 10);
      const count = summaryCache.daily[key] || 0;
      let level = 0;
      if (count >= 1) level = 1;
      if (count >= 3) level = 2;
      if (count >= 5) level = 3;
      if (count >= 8) level = 4;
      container.insertAdjacentHTML("beforeend", `<div class="heatmap-cell" data-level="${level}" title="${key}: ${count}問"></div>`);
    }
  }

  function renderWeakAreas() {
    const container = document.getElementById("weak-areas");
    if (!container) {
      return;
    }
    const weakAreas = getWeakAreas();
    if (!weakAreas.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">🌸</div><div class="empty-text">学習データが少ないため、まだ判定できません</div></div>';
      return;
    }
    container.innerHTML = weakAreas.map((item) => `
      <div class="weak-area-card">
        <div class="weak-info">
          <div class="weak-name">${window.APP.formatType(item.type)}</div>
          <div class="weak-accuracy">正解率 ${item.accuracy}% / ${item.attempts}回挑戦</div>
          <p class="text-muted">同型を3問ずつ連続で解き、式や判断根拠を1行で残すと修正が早くなります。</p>
        </div>
      </div>
    `).join("");
  }

  function renderRecommendations() {
    const container = document.getElementById("recommendations");
    if (!container) {
      return;
    }
    const cards = getRecommendations();
    if (!cards.length) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">☁️</div><div class="empty-text">まずは1問解くと分析が始まります</div></div>';
      return;
    }
    container.innerHTML = cards.map((item) => `
      <div class="recommend-card">
        <div class="card-title"><span>🐾</span>${item.title}</div>
        <p class="question-text-sm">${window.APP.escapeHtml(item.question.question)}</p>
        <p class="text-muted">${item.reason}</p>
        <button class="btn btn-primary btn-sm" data-open-practice="${item.question.id}">この問題へ</button>
      </div>
    `).join("");
    container.querySelectorAll("[data-open-practice]").forEach((button) => {
      button.addEventListener("click", () => window.APP.openPracticeQuestion(button.dataset.openPractice));
    });
  }

  function renderBadges() {
    const container = document.getElementById("achievements");
    if (!container) {
      return;
    }
    container.innerHTML = BADGES.map((badge) => {
      const earned = badge.check(summaryCache);
      return `
        <div class="badge ${earned ? "earned" : "unearned"}">
          <div class="badge-icon-wrap">${badge.icon}</div>
          <div class="badge-name">${badge.name}</div>
        </div>
      `;
    }).join("");
  }

  function renderCategoryStats() {
    ["verbal", "nonverbal", "english"].forEach((key) => {
      const item = summaryCache.byCategory[key];
      const percent = item.attempts ? Math.round((item.correct / item.attempts) * 100) : 0;
      const bar = document.getElementById(`stat-${key}-bar`);
      const label = document.getElementById(`stat-${key}-pct`);
      if (bar) {
        bar.style.width = `${percent}%`;
      }
      if (label) {
        label.textContent = `${percent}%`;
      }
    });
  }

  function renderScores() {
    renderHeader();
    const streakNumber = document.getElementById("scores-streak-number");
    const streakSub = document.getElementById("scores-streak-sub");
    const totalCorrect = document.getElementById("scores-total-correct");
    if (streakNumber) {
      streakNumber.textContent = String(summaryCache.streak.current);
    }
    if (streakSub) {
      streakSub.textContent = summaryCache.streak.current ? `最長 ${summaryCache.streak.longest} 日連続` : "学習を始めると分析が表示されます";
    }
    if (totalCorrect) {
      totalCorrect.textContent = String(summaryCache.totalCorrect);
    }
    renderChart();
    renderHeatmap();
    renderWeakAreas();
    renderRecommendations();
    renderCategoryStats();
    renderBadges();
  }

  window.addEventListener("cocoro:ready", (event) => {
    setSummary(event.detail.summary);
    renderScores();
  });
  window.addEventListener("cocoro:data-updated", renderScores);
  window.addEventListener("cocoro:tab-changed", (event) => {
    if (event.detail.tab === "scores") {
      renderScores();
    }
  });

  window.SCORES = {
    setSummary,
    getSummary,
    getAttempt,
    recordAttempt,
    recordExam,
    getWeakAreas,
    getRecommendations,
    renderScores,
  };
})();
