(function () {
  const state = {
    category: "all",
    type: "all",
    difficulty: "all",
    shuffle: false,
    currentIndex: 0,
    questionIds: [],
    locked: false,
  };

  function getFilteredQuestions() {
    const list = window.APP.filterQuestions({
      category: state.category,
      type: state.type,
      difficulty: state.difficulty,
    });
    return state.shuffle ? window.APP.shuffleArray(list) : list;
  }

  function updateProgress(list) {
    const summary = window.SCORES.getSummary();
    let attempts = 0;
    let correct = 0;
    list.forEach((question) => {
      const item = summary.attempts[question.id];
      if (item) {
        attempts += item.attempts;
        correct += item.correct;
      }
    });
    const percent = attempts ? Math.round((correct / attempts) * 100) : 0;
    document.getElementById("practice-progress-pct").textContent = attempts ? `${percent}%` : "未挑戦";
    document.getElementById("practice-progress-fill").style.width = `${percent}%`;
  }

  function renderQuestion() {
    const list = getFilteredQuestions();
    state.questionIds = list.map((question) => question.id);
    const card = document.getElementById("practice-question-card");
    const explanation = document.getElementById("practice-explanation");
    if (!list.length) {
      card.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">条件に合う問題がありません</div></div>';
      explanation.classList.remove("visible");
      document.getElementById("practice-counter").textContent = "問題 0 / 0";
      updateProgress(list);
      return;
    }
    if (state.currentIndex >= list.length) {
      state.currentIndex = 0;
    }
    const question = list[state.currentIndex];
    card.innerHTML = `
      <div class="question-meta">
        <span class="meta-pill">${question.categoryLabel}</span>
        <span class="meta-pill accent">${question.subtype || question.typeLabel}</span>
        <span class="meta-pill lavender">${question.difficultyLabel}</span>
      </div>
      <div class="question-number">${question.id}</div>
      <div class="question-text">${window.APP.escapeHtml(question.question).replace(/\n/g, "<br>")}</div>
      <div class="choices">
        ${question.choices.map((choice, index) => `
          <button class="choice-btn" data-choice-index="${index}">
            <span class="choice-label">${String.fromCharCode(65 + index)}</span>
            <span>${window.APP.escapeHtml(choice)}</span>
          </button>
        `).join("")}
      </div>
      <div class="source-line">形式参考: <a href="${question.sourceUrl}" target="_blank" rel="noreferrer">${window.APP.escapeHtml(question.sourceTitle)}</a></div>
    `;
    document.getElementById("practice-counter").textContent = `問題 ${state.currentIndex + 1} / ${list.length}`;
    explanation.classList.remove("visible");
    state.locked = false;
    bindChoices(question);
    updateProgress(list);
  }

  function bindChoices(question) {
    document.querySelectorAll("#practice-question-card .choice-btn").forEach((button) => {
      button.addEventListener("click", () => {
        if (state.locked) {
          return;
        }
        state.locked = true;
        const selectedIndex = Number(button.dataset.choiceIndex);
        const isCorrect = selectedIndex === question.answer;
        window.SCORES.recordAttempt(question, selectedIndex, isCorrect);
        document.querySelectorAll("#practice-question-card .choice-btn").forEach((item, index) => {
          item.classList.add("disabled");
          if (index === question.answer) {
            item.classList.add("correct");
          }
          if (index === selectedIndex && !isCorrect) {
            item.classList.add("wrong");
          }
        });
        document.getElementById("practice-explanation-text").textContent = question.explanation;
        document.getElementById("practice-explanation").classList.add("visible");
        document.getElementById("practice-tips").style.display = "flex";
        document.getElementById("practice-tips-text").innerHTML = `
          <strong>解き方の視点:</strong> ${window.APP.escapeHtml(question.tips)}<br>
          <span class="text-muted">出題形式参考: <a href="${question.sourceUrl}" target="_blank" rel="noreferrer">${window.APP.escapeHtml(question.sourceTitle)}</a></span>
        `;
        window.APP.showToast(isCorrect ? "正解です。" : "不正解です。根拠を確認しましょう。");
        window.dispatchEvent(new CustomEvent("cocoro:answer-recorded", {
          detail: { questionId: question.id, correct: isCorrect, mode: "practice" },
        }));
        window.APP.notifyDataUpdated();
      });
    });
  }

  function syncFilters() {
    document.querySelectorAll("#practice-filter-bar [data-category]").forEach((button) => {
      button.classList.toggle("active", button.dataset.category === state.category);
    });
    document.querySelectorAll("#practice-filter-bar [data-difficulty]").forEach((button) => {
      button.classList.toggle("active", button.dataset.difficulty === state.difficulty);
    });
    document.getElementById("practice-type-select").value = state.type;
    document.getElementById("practice-shuffle").checked = state.shuffle;
  }

  function registerEvents() {
    document.querySelectorAll("#practice-filter-bar [data-category]").forEach((button) => {
      button.addEventListener("click", () => {
        state.category = button.dataset.category;
        state.currentIndex = 0;
        syncFilters();
        renderQuestion();
      });
    });
    document.querySelectorAll("#practice-filter-bar [data-difficulty]").forEach((button) => {
      button.addEventListener("click", () => {
        state.difficulty = button.dataset.difficulty;
        state.currentIndex = 0;
        syncFilters();
        renderQuestion();
      });
    });
    document.getElementById("practice-type-select").addEventListener("change", (event) => {
      state.type = event.target.value;
      state.currentIndex = 0;
      renderQuestion();
    });
    document.getElementById("practice-shuffle").addEventListener("change", (event) => {
      state.shuffle = event.target.checked;
      state.currentIndex = 0;
      renderQuestion();
    });
    document.getElementById("practice-prev-btn").addEventListener("click", () => {
      if (!state.questionIds.length) {
        return;
      }
      state.currentIndex = (state.currentIndex - 1 + state.questionIds.length) % state.questionIds.length;
      renderQuestion();
    });
    document.getElementById("practice-next-btn").addEventListener("click", () => {
      if (!state.questionIds.length) {
        return;
      }
      state.currentIndex = (state.currentIndex + 1) % state.questionIds.length;
      renderQuestion();
    });
    window.addEventListener("cocoro:open-practice-question", (event) => {
      const question = window.APP.getQuestionById(event.detail.questionId);
      if (!question) {
        return;
      }
      state.category = question.category;
      state.type = question.type;
      state.difficulty = String(question.difficulty);
      state.shuffle = false;
      syncFilters();
      const list = getFilteredQuestions();
      state.currentIndex = Math.max(list.findIndex((item) => item.id === question.id), 0);
      renderQuestion();
    });
  }

  document.addEventListener("DOMContentLoaded", registerEvents);
  window.addEventListener("cocoro:ready", () => {
    syncFilters();
    renderQuestion();
  });
})();
