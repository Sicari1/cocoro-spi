(function () {
  const state = {
    heroClicks: 0,
    footerClicks: 0,
    noteTapCount: 0,
    noteTapTimer: null,
    galleryTapCount: 0,
    galleryTapTimer: null,
    practiceCorrectStreak: 0,
    typed: "",
  };

  const CINNAMOROLL_TRIVIA = [
    {
      title: "Cinnamoroll Trivia 01",
      message: "シナモロールはサンリオ公式プロフィールでは、遠い空の雲の上で生まれた白いこいぬ。大きな耳で空を飛べる設定です。",
    },
    {
      title: "Cinnamoroll Trivia 02",
      message: "シナモロールの誕生日は 3月6日。やさしい青と白の世界観が公式紹介でも象徴的に使われています。",
    },
    {
      title: "Cinnamoroll Trivia 03",
      message: "シナモロールはカフェの看板犬として知られていて、ふわふわしたしっぽがシナモンロールみたいだから『シナモン』と呼ばれるようになった設定があります。",
    },
    {
      title: "Cinnamoroll Trivia 04",
      message: "シナモロールのチャームポイントは、長い耳とくるんとしたしっぽ。サイトのヒーロー構成でもその丸いリズムを使っています。",
    },
  ];

  function showSecret(title, message) {
    window.APP.showToast(title);
    window.APP.openModal({
      title,
      html: `<p>${message}</p>`,
      confirmText: "閉じる",
    });
  }

  function showRandomTrivia() {
    const item = CINNAMOROLL_TRIVIA[Math.floor(Math.random() * CINNAMOROLL_TRIVIA.length)];
    showSecret(item.title, item.message);
  }

  function registerHeroSecret() {
    const dot = document.getElementById("hero-secret-dot");
    const note = document.querySelector(".hero-note");
    const footerTitle = document.querySelector(".footer-title");
    const gallery = document.querySelector(".footer-mini-gallery");

    if (dot) {
      dot.addEventListener("click", () => {
        state.heroClicks += 1;
        if (state.heroClicks >= 5) {
          state.heroClicks = 0;
          showSecret(
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
          showSecret(
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
          state.footerClicks = 0;
          showSecret(
            "Jinjjang Signal",
            "見つけた人だけ分かる小さなサイン。성진の気配は、派手じゃなくていい。"
          );
        }
      });
    }

    if (gallery) {
      const galleryTap = () => {
        state.galleryTapCount += 1;
        window.clearTimeout(state.galleryTapTimer);
        state.galleryTapTimer = window.setTimeout(() => {
          state.galleryTapCount = 0;
        }, 900);
        if (state.galleryTapCount >= 4) {
          state.galleryTapCount = 0;
          showRandomTrivia();
        }
      };
      gallery.addEventListener("click", galleryTap);
      gallery.addEventListener("touchend", galleryTap, { passive: true });
    }
  }

  function registerKeySecret() {
    window.addEventListener("keydown", (event) => {
      state.typed = (state.typed + event.key.toLowerCase()).slice(-16);
      if (state.typed.includes("cocoro")) {
        showSecret(
          "Cocoro Route",
          "ココの名前をちゃんと打った人にだけ、夜空色の小さなごほうび。"
        );
      }
      if (state.typed.includes("seongjin") || state.typed.includes("진짱")) {
        showSecret(
          "Quiet Signature",
          "진짱の名前はサイトの奥に静かに残しておきました。目立たなくていいけど、消えない形で。"
        );
      }
      if (state.typed.includes("cinnamon")) {
        showRandomTrivia();
      }
    });
  }

  function registerPracticeSecret() {
    window.addEventListener("cocoro:answer-recorded", (event) => {
      state.practiceCorrectStreak = event.detail.correct ? state.practiceCorrectStreak + 1 : 0;
      if (state.practiceCorrectStreak >= 5) {
        state.practiceCorrectStreak = 0;
        showSecret(
          "Steady Five",
          "5問連続正解。焦らず積み上げる人だけ開くルートです。"
        );
      }
      if (event.detail.correct && Math.random() < 0.18) {
        showRandomTrivia();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    registerHeroSecret();
    registerKeySecret();
    registerPracticeSecret();
  });
})();
