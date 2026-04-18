(function () {
  const STORAGE_KEY = "cocoro_secret_routes";
  const state = {
    heroClicks: 0,
    footerClicks: 0,
    noteTapCount: 0,
    noteTapTimer: null,
    practiceCorrectStreak: 0,
    unlocked: loadUnlocked(),
  };

  function loadUnlocked() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch (error) {
      return [];
    }
  }

  function saveUnlocked() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.unlocked));
  }

  function unlock(id, title, message) {
    if (state.unlocked.includes(id)) {
      return;
    }
    state.unlocked.push(id);
    saveUnlocked();
    window.APP.showToast(`Secret unlocked: ${title}`);
    window.APP.openModal({
      title,
      html: `<p>${message}</p>`,
      confirmText: "閉じる",
    });
  }

  function registerHeroSecret() {
    const dot = document.getElementById("hero-secret-dot");
    const note = document.querySelector(".hero-note");
    const footerTitle = document.querySelector(".footer-title");
    if (dot) {
      dot.addEventListener("click", () => {
        state.heroClicks += 1;
        if (state.heroClicks >= 5) {
          unlock(
            "blue-sky-route",
            "Blue Sky Route",
            "ココが気づくくらい静かな隠しルート。ちゃんと見てくれる人向けの小さな合図です。"
          );
        }
      });
    }
    if (note) {
      const tapHandler = () => {
        state.noteTapCount += 1;
        window.clearTimeout(state.noteTapTimer);
        state.noteTapTimer = window.setTimeout(() => {
          state.noteTapCount = 0;
        }, 700);
        if (state.noteTapCount >= 3) {
          state.noteTapCount = 0;
          unlock(
            "cloud-note",
            "Cloud Note",
            "青い雲の下で、ココと一緒に落ち着いて積み上げる。そういう準備の仕方がいちばん強いです。"
          );
        }
      };
      note.addEventListener("click", tapHandler);
      note.addEventListener("touchend", tapHandler, { passive: true });
    }
    if (footerTitle) {
      footerTitle.addEventListener("click", () => {
        state.footerClicks += 1;
        if (state.footerClicks >= 3) {
          unlock(
            "jinjjang-signal",
            "Jinjjang Signal",
            "見つけた人だけ分かる小さなサイン。성진の気配は、派手じゃなくていい。"
          );
        }
      });
    }
  }

  function registerKeySecret() {
    let typed = "";
    window.addEventListener("keydown", (event) => {
      typed = (typed + event.key.toLowerCase()).slice(-12);
      if (typed.includes("cocoro")) {
        unlock(
          "cocoro-keyword",
          "Cocoro Route",
          "ココの名前をちゃんと打った人にだけ、夜空色の小さなごほうび。"
        );
      }
      if (typed.includes("seongjin") || typed.includes("진짱")) {
        unlock(
          "seongjin-route",
          "Quiet Signature",
          "진짱の名前はサイトの奥に静かに残しておきました。目立たなくていいけど、消えない形で。"
        );
      }
    });
  }

  function registerPracticeSecret() {
    window.addEventListener("cocoro:answer-recorded", (event) => {
      state.practiceCorrectStreak = event.detail.correct ? state.practiceCorrectStreak + 1 : 0;
      if (state.practiceCorrectStreak >= 5) {
        unlock(
          "steady-five",
          "Steady Five",
          "5問連続正解。焦らず積み上げる人だけ開くルートです。"
        );
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    registerHeroSecret();
    registerKeySecret();
    registerPracticeSecret();
  });
})();
