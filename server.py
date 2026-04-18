#!/usr/bin/env python3
import json
import os
import sqlite3
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent
DB_DIR = Path(os.environ.get("DATA_DIR") or os.environ.get("RENDER_DISK_PATH") or "/tmp")
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DB_DIR / "cocoro_spi.db"
USER_NAME = "Cocoro"
MAX_BODY_BYTES = 64 * 1024
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_MAX_REQUESTS = 90
RATE_LIMITS = defaultdict(deque)


def now_iso():
    return datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")


def utc_today():
    return datetime.now(UTC).date()


def client_ip(handler):
    forwarded = handler.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    return forwarded or handler.client_address[0]


def rate_limited(handler):
    ip = client_ip(handler)
    now = time.time()
    queue = RATE_LIMITS[ip]
    while queue and now - queue[0] > RATE_LIMIT_WINDOW_SECONDS:
      queue.popleft()
    if len(queue) >= RATE_LIMIT_MAX_REQUESTS:
        return True
    queue.append(now)
    return False


def label_category(value):
    return {
        "verbal": "言語",
        "nonverbal": "非言語",
        "english": "英語",
    }.get(value, value)


def label_type(value):
    return {
        "vocabulary": "語彙",
        "reading": "読解",
        "calculation": "計算",
        "reasoning": "推論",
        "grammar": "英語",
    }.get(value, value)


def label_difficulty(level):
    return "★" * int(level)


def source_note(title, url, note):
    return {"title": title, "url": url, "note": note}


SOURCE_LANGUAGE = source_note(
    "キャリタス就活: SPI言語を完全対策",
    "https://job.career-tasu.jp/guide/step/139/",
    "二語の関係、語句の意味、熟語の成り立ち、文の並べ替えなどの頻出形式整理を参考に改題。",
)
SOURCE_NONVERBAL = source_note(
    "キャリタス就活: SPI非言語を完全対策",
    "https://job.career-tasu.jp/guide/step/141/",
    "割合、集合、組合せ、速さ、仕事算の頻出分野と公式整理を参考に改題。",
)
SOURCE_PRACTICE = source_note(
    "キャリタス就活: SPI練習問題一覧",
    "https://job.career-tasu.jp/guide/step/150/",
    "速度算、割合、金額計算、分担計算の出題型を参考に改題。",
)
SOURCE_PORT = source_note(
    "PORTキャリア: SPIの例題38選",
    "https://www.theport.jp/portcareer/article/68844/",
    "言語問題の典型パターンと選択肢設計を参考に改題。",
)
SOURCE_ENGLISH = source_note(
    "PORTキャリア: SPI英語攻略ガイド",
    "https://www.theport.jp/portcareer/article/18399/",
    "同意語・反意語・空欄補充・文法の代表形式を参考に改題。",
)
SOURCE_RELATION = source_note(
    "SPI対策問題集: 二語の関係",
    "https://spi.careermine.jp/gengo/relationship-of-two-words",
    "二語の関係における包含・対義・目的語-動詞の見抜き方を参考に改題。",
)
SOURCE_WORK = source_note(
    "SPI対策問題集: 仕事算",
    "https://spi.careermine.jp/articles/spi-shigotozan",
    "仕事量を1日あたりに直す基本手順を参考に改題。",
)
SOURCE_SANRIO = source_note(
    "Sanrio Corporate: Cinnamoroll",
    "https://corporate.sanrio.co.jp/en/business-info/brands/cinnamoroll/",
    "キャラクター設定、性格、誕生日、配色イメージの参照元。",
)
SOURCE_SANRIO_WORLD = source_note(
    "Sanrio: Cinnamoroll",
    "https://www.sanrio.com/pages/cinnamoroll-character-1",
    "公式紹介文と世界観リンクの参照元。",
)


def make_question(qid, category, qtype, subtype, difficulty, question, choices, answer, explanation, tips, source, keywords):
    return {
        "id": qid,
        "category": category,
        "type": qtype,
        "subtype": subtype,
        "difficulty": difficulty,
        "question": question,
        "choices": choices,
        "answer": answer,
        "explanation": explanation,
        "tips": tips,
        "source_title": source["title"],
        "source_url": source["url"],
        "source_note": source["note"],
        "keywords": keywords,
    }


def build_seed_questions():
    questions = []
    seq = 1

    def q(category, qtype, subtype, difficulty, question, choices, answer, explanation, tips, source, keywords):
        nonlocal seq
        questions.append(
            make_question(
                f"SPI-{seq:03d}",
                category,
                qtype,
                subtype,
                difficulty,
                question,
                choices,
                answer,
                explanation,
                tips,
                source,
                keywords,
            )
        )
        seq += 1

    relation_rows = [
        ("監査：業務", ["会議：予定", "契約：書類", "ノート：文房具", "面接：評価"], 2, "「監査」は「業務」の一種ではなく、業務を確認する行為です。一方「ノート」は「文房具」の一種なので包含関係が一致します。", "二語の関係は、まず『AはBの一種』『AでBする』のように短い文に直すと整理しやすいです。"),
        ("柔軟：硬直", ["前進：進歩", "削減：節約", "公開：非公開", "迅速：処理"], 2, "柔軟と硬直は反対関係です。公開と非公開も同じく対義関係です。", "似た意味か反対か、まず方向性を決めると誤答を減らせます。"),
        ("書類：作成", ["会場：案内", "資料：印刷", "会計：精算", "報告：共有"], 1, "『書類を作成する』は目的語と動詞の関係です。『資料を印刷する』も同じです。", "『AをBする』の形になるかを確認してください。"),
        ("品質：向上", ["数字：確認", "効率：改善", "議題：決定", "社員：成長"], 1, "品質を向上させる、効率を改善する。どちらも対象を良くする動作です。", "対象と動作の結びつきを確認すると選びやすいです。"),
        ("大学：教育機関", ["病院：医師", "空港：交通施設", "議論：意見", "市場：売買"], 1, "大学は教育機関の一種です。空港は交通施設の一種で、包含関係が一致します。", "包含関係は『AはBのひとつ』と言えるかで見ます。"),
        ("上司：部下", ["先輩：後輩", "授業：講義", "予算：費用", "顧客：提案"], 0, "上司と部下は立場が対応するペアです。先輩と後輩も同じく対応関係です。", "人どうしの役割関係は、左右が入れ替わってもペアとして成立するかを見ると見抜きやすいです。"),
        ("原因：結果", ["課題：対策", "努力：成果", "注文：出荷", "会話：説明"], 1, "努力が先にあり、そのあと成果が出ます。原因から結果への流れが同じです。", "時間の流れを入れると整理しやすいです。"),
        ("会議：議題", ["契約：条項", "駅：電車", "研修：参加", "出張：移動"], 0, "会議には議題があり、契約には条項があります。どちらも『それを構成する中身』の関係です。", "包含・目的・対義でなければ、『AにはBが含まれる』『AをするとBが生じる』のような関係も疑ってください。"),
    ]
    for stem, choices, answer, explanation, tips in relation_rows:
        q("verbal", "vocabulary", "二語の関係", 2, f"「{stem}」と同じ関係に最も近いものを選びなさい。", choices, answer, explanation, tips, SOURCE_RELATION, ["二語の関係", stem])

    jukugo_rows = [
        ("上下", ["似た意味", "反対の意味", "主語と述語", "修飾関係"], 1, "『上』と『下』は反対語です。", "熟語の成り立ちは、まず2文字をばらして意味の向きを確認します。"),
        ("読書", ["似た意味", "反対の意味", "動詞＋目的語", "主語と述語"], 2, "『読む』『書』ではなく、『書を読む』と考えると動詞＋目的語の形です。", "音ではなく意味で分解してください。"),
        ("青空", ["主語と述語", "修飾関係", "反対の意味", "似た意味"], 1, "青い空、という形なので前の漢字が後ろを修飾しています。", "『前の漢字が後ろを説明しているか』を確認します。"),
        ("日没", ["主語と述語", "動詞＋目的語", "反対の意味", "似た意味"], 0, "日が没する、で主語と述語の関係です。", "『AがBする』と読めるなら主語と述語です。"),
        ("増減", ["修飾関係", "動詞＋目的語", "反対の意味", "似た意味"], 2, "増えると減るは逆向きなので反対の意味です。", "増・減、開・閉のような反対ペアは頻出です。"),
        ("研究", ["似た意味", "主語と述語", "動詞＋目的語", "修飾関係"], 0, "研ぐ・究めるは、どちらも深く調べる方向の近い意味です。", "似た意味かどうか迷うときは、2字を同時に使って意味が強まるかを考えます。"),
        ("帰国", ["動詞＋目的語", "主語と述語", "反対の意味", "修飾関係"], 0, "国に帰る、という動詞＋目的語の関係です。", "『何に対して動くのか』が見えたら動詞＋目的語です。"),
        ("高温", ["修飾関係", "反対の意味", "主語と述語", "似た意味"], 0, "高い温度、なので修飾関係です。", "形容する語が前にあるかを確認しましょう。"),
    ]
    for word, choices, answer, explanation, tips in jukugo_rows:
        q("verbal", "vocabulary", "熟語の成り立ち", 2, f"熟語「{word}」の成り立ちとして最も適切なものを選びなさい。", choices, answer, explanation, tips, SOURCE_LANGUAGE, ["熟語の成り立ち", word])

    verbal_fill = [
        ("会議で発言するときは、結論を先に（　　　）したほうが伝わりやすい。", ["提示", "停車", "混在", "縮小"], 0),
        ("データを見るときは、数字だけでなく増減の理由まで（　　　）する必要がある。", ["考察", "通過", "収納", "合流"], 0),
        ("相手の意見を聞いたうえで、自分の考えとの違いを（　　　）すると議論が進みやすい。", ["整理", "販売", "配布", "停電"], 0),
        ("長文読解では、段落ごとの役割を（　　　）しながら読むと全体像をつかみやすい。", ["意識", "加工", "洗浄", "輸送"], 0),
    ]
    for stem, choices, answer in verbal_fill:
        q("verbal", "reading", "空欄補充", 2, stem, choices, answer, "文脈全体が自然につながる語を選ぶ問題です。前後の関係を見て、動作・目的・結果のどれが入るかを判断します。", "空欄だけを見ず、前後をつないで一文として読むと精度が上がります。", SOURCE_PORT, ["空欄補充"])

    reading_order = [
        (
            ["文章を読む前に問いを確認すると、", "探すべき情報がはっきりし、", "必要な箇所に注意が向きやすくなって、", "限られた時間でも要点を拾いやすい。"],
            ["1→2→3→4", "2→1→3→4", "1→3→2→4", "3→1→2→4"],
            0,
        ),
        (
            ["苦手分野の復習では、", "答えだけでなく誤答の理由を残しておくと、", "次に同じ型を見たときの判断が速くなり、", "得点の取りこぼしを減らせる。"],
            ["1→2→3→4", "2→1→4→3", "1→3→2→4", "3→1→2→4"],
            0,
        ),
    ]
    for parts, choices, answer in reading_order:
        q(
            "verbal",
            "reading",
            "文の並べ替え",
            3,
            "次の文が自然な流れになる順序を選びなさい。\n"
            + "\n".join([f"({index + 1}) {part}" for index, part in enumerate(parts)]),
            choices,
            answer,
            "文の並べ替えは『前提 → 方法 → 効果』の流れを探すのが基本です。接続の向きと因果関係を確認すると順序が定まります。",
            "指示語や『その結果』のようなつなぎ語は、前に説明が必要です。",
            SOURCE_LANGUAGE,
            ["文の並べ替え"],
        )

    word_meanings = [
        ("『堅実』に最も近い意味を選びなさい。", ["着実で無理がない", "派手で目立つ", "気分で変わる", "急いで決める"], 0),
        ("『把握』に最も近い意味を選びなさい。", ["内容を正しくつかむ", "書類を破る", "言葉を飾る", "予定を延期する"], 0),
        ("『適切』に最も近い意味を選びなさい。", ["場面に合っている", "音が大きい", "非常に難しい", "長く続いている"], 0),
        ("『慎重』に最も近い意味を選びなさい。", ["よく注意して進める", "強く反対する", "すぐ忘れる", "勢いだけで進む"], 0),
    ]
    for stem, choices, answer in word_meanings:
        q("verbal", "vocabulary", "語句の意味", 1, stem, choices, answer, "SPIの語句問題では、難しい漢字を日常語に置き換えると判断しやすくなります。", "見慣れない熟語は、短い口語表現に言い換えて確認してください。", SOURCE_LANGUAGE, ["語句の意味"])

    percentage_rows = [
        ("ある商品を20%値下げしたところ、販売数が30%増えた。売上は元の何倍になるか。", ["1.04倍", "0.96倍", "1.10倍", "0.84倍"], 0),
        ("社員120人のうち、研修に参加したのは78人だった。参加率は何%か。", ["65%", "58%", "62%", "70%"], 0),
        ("原価800円の商品に25%の利益をのせて定価をつけた。定価はいくらか。", ["1,000円", "960円", "1,040円", "1,200円"], 0),
        ("売上が150万円から180万円に増えた。増加率は何%か。", ["20%", "16%", "25%", "30%"], 0),
        ("定価5,000円の商品を2割引きで販売した。販売価格はいくらか。", ["4,000円", "3,800円", "4,200円", "4,500円"], 0),
        ("ある部署の正答率が60%から75%に上がった。上昇したポイント数はいくつか。", ["15ポイント", "25ポイント", "12ポイント", "10ポイント"], 0),
    ]
    for stem, choices, answer in percentage_rows:
        q("nonverbal", "calculation", "割合", 2, stem, choices, answer, "SPIの割合は『変化後 ÷ 変化前』か『部分 ÷ 全体』かを先に決めることが重要です。式の型を見誤らないようにしてください。", "『何に対する割合か』を最初に明確にすると計算がぶれません。", SOURCE_NONVERBAL, ["割合"])

    speed_rows = [
        ("Aは時速60km、Bは時速40kmで向かい合って進む。距離が100kmあるとき、何時間後に出会うか。", ["1時間", "1.5時間", "2時間", "2.5時間"], 0),
        ("時速72kmで走る電車は、150mのトンネルを通過するのに何秒かかるか。ただし車体の長さは90mとする。", ["12秒", "9秒", "15秒", "18秒"], 0),
        ("時速5kmで36分歩いた。進んだ距離は何kmか。", ["3km", "2.4km", "3.6km", "4km"], 0),
        ("往復120kmの道のりを、行きは時速40km、帰りは時速60kmで移動した。合計時間は何時間か。", ["5時間", "4時間", "4.5時間", "5.5時間"], 0),
    ]
    for stem, choices, answer in speed_rows:
        q("nonverbal", "calculation", "速さ", 2, stem, choices, answer, "速さの問題は、距離・時間・速さのうち何を求めるかを先に固定します。単位をそろえてから式に入れるのが基本です。", "分を時間に直す、mをkmに直す、といった単位整理を最初に行ってください。", SOURCE_PRACTICE, ["速さ"])

    work_rows = [
        ("Aが1人で6時間、Bが1人で10時間かかる作業を2人で行うと、何時間で終わるか。", ["3.75時間", "4時間", "5時間", "6時間"], 0),
        ("ある作業をAとBが一緒にすると8時間で終わる。Aが4時間作業したあと、残りをBが1人で16時間かけて終えた。Bだけなら何時間かかるか。", ["24時間", "16時間", "20時間", "12時間"], 0),
        ("Xは1人で12日、Yは1人で18日で終える仕事がある。2人で3日進めた後の残りは全体の何割か。", ["5/12", "1/2", "1/3", "7/12"], 0),
        ("Aが1日で全体の1/8、Bが1日で全体の1/12を進める。2人で2日進めた後、残りは全体のどれだけか。", ["7/12", "1/2", "5/12", "2/3"], 0),
    ]
    for stem, choices, answer in work_rows:
        q("nonverbal", "reasoning", "仕事算", 3, stem, choices, answer, "仕事算では『完成までの時間』をそのまま扱わず、1時間または1日あたりの仕事量に直してから合計します。", "最小公倍数で全体仕事量を置く方法と、1あたりで置く方法のどちらかに統一すると安定します。", SOURCE_WORK, ["仕事算"])

    set_rows = [
        ("全体100人のうち、英語が得意な人は58人、数学が得意な人は46人、両方得意な人は20人である。どちらか一方以上が得意な人は何人か。", ["84人", "78人", "88人", "92人"], 0),
        ("A商品を買った人が40人、B商品を買った人が35人、両方買った人が12人いる。少なくともどちらかを買った人は何人か。", ["63人", "75人", "57人", "47人"], 0),
        ("受験者80人のうち、資格X合格者は32人、資格Y合格者は28人、両方合格した人は10人。どちらも合格していない人は何人か。", ["30人", "20人", "24人", "40人"], 0),
        ("アンケートで紅茶が好きな人は45人、コーヒーが好きな人は50人、両方好きな人は18人、どちらも好きでない人は12人だった。全体は何人か。", ["89人", "95人", "107人", "101人"], 0),
    ]
    for stem, choices, answer in set_rows:
        q("nonverbal", "reasoning", "集合", 2, stem, choices, answer, "集合は『片方 + 片方 - 重なり』が基本です。二重に数えている部分を一度引くのがポイントです。", "ベン図を頭の中で描くと条件整理が速くなります。", SOURCE_NONVERBAL, ["集合"])

    permutation_rows = [
        ("数字0,1,2,3,4から異なる3個を選んで3桁の整数をつくる。偶数は何通りできるか。", ["24通り", "18通り", "30通り", "36通り"], 0),
        ("A,B,C,D,Eの5人から委員長と副委員長を1人ずつ選ぶ方法は何通りか。", ["20通り", "10通り", "25通り", "15通り"], 0),
        ("6冊の異なる本から3冊を選ぶ方法は何通りか。", ["20通り", "18通り", "120通り", "15通り"], 0),
        ("赤3本、青2本、黒1本のペンから異なる色の2本を選ぶ方法は何通りか。", ["11通り", "6通り", "9通り", "8通り"], 2),
    ]
    permutation_explanations = [
        "偶数なので1の位は0,2,4のいずれかです。0を1の位に置く場合と2または4を置く場合で分けると整理しやすくなります。",
        "役職が異なるので順番あり、つまり順列で考えます。",
        "選ぶだけで役割の差がないので組合せです。",
        "同色を区別しない条件では、色の組合せを整理して数えます。",
    ]
    for index, (stem, choices, answer) in enumerate(permutation_rows):
        q("nonverbal", "calculation", "場合の数", 3, stem, choices, answer, permutation_explanations[index], "順番が関係するかどうかを最初に決めると、順列と組合せの取り違えを防げます。", SOURCE_NONVERBAL, ["場合の数", "順列", "組合せ"])

    logic_rows = [
        ("A、B、Cの3人のうち、1人だけが本当のことを言っている。A『Bが犯人だ』 B『Cは犯人ではない』 C『私は犯人ではない』。犯人は誰か。", ["A", "B", "C", "決められない"], 1),
        ("ある部署では、課長以上は全員が会議に参加し、会議参加者は全員が資料を読んでいる。田中さんは資料を読んでいない。必ず言えることはどれか。", ["田中さんは課長以上である", "田中さんは会議に参加した", "田中さんは課長以上ではない", "田中さんは社員ではない"], 2),
        ("『新規案件を受けるなら、人員を増やす必要がある。人員を増やさないなら、新規案件は受けない。』この内容と同じものを選びなさい。", ["新規案件を受けるときだけ人員を増やす", "人員を増やさなければ新規案件は受けない", "人員を増やせば必ず新規案件を受ける", "新規案件を受けなくても人員は増やす"], 1),
        ("PならばQである。Qは成り立つ。必ず言えることはどれか。", ["Pである", "Pではない", "Pかもしれないし、そうでないかもしれない", "PならばQではない"], 2),
    ]
    logic_explanations = [
        "Bが犯人だとするとAが真になり、Bの発言も真になって2人真になってしまいます。Cが犯人だとBだけが真になります。",
        "課長以上なら会議参加、会議参加なら資料を読む、の流れです。資料を読んでいないなら、少なくとも課長以上ではありません。",
        "命題を言い換えると『人員を増やさない → 新規案件を受けない』です。",
        "Qが成り立っても、Pが原因とは限りません。逆は必ずしも言えません。",
    ]
    for index, (stem, choices, answer) in enumerate(logic_rows):
        q("nonverbal", "reasoning", "推論", 3, stem, choices, answer, logic_explanations[index], "推論は、日本語を短い論理式に置き換えると整理しやすくなります。", SOURCE_PORT, ["推論"])

    proverb_rows = [
        ("『石の上にも三年』に最も近い意味を選びなさい。", ["すぐに結果を求めず続けることが大切", "安全第一で動くことが大切", "人に頼るほうが速い", "意見は変えないほうがよい"], 0),
        ("『備えあれば憂いなし』に最も近い意味を選びなさい。", ["準備しておけば不安を減らせる", "心配ごとは忘れるべきだ", "急いで決めればうまくいく", "迷ったら人に合わせる"], 0),
        ("『急がば回れ』に最も近い意味を選びなさい。", ["近道に見えても安全で確実な方法を選ぶ", "急げるときは一気に進む", "回り道はいつも損である", "最初の考えを変えない"], 0),
        ("『塵も積もれば山となる』に最も近い意味を選びなさい。", ["小さな積み重ねが大きな成果になる", "大きな目標は意味がない", "一度の努力ですべて決まる", "量よりも運が重要だ"], 0),
    ]
    for stem, choices, answer in proverb_rows:
        q("verbal", "vocabulary", "ことわざ", 1, stem, choices, answer, "SPIのことわざは暗記だけでなく、仕事や勉強の場面に言い換えると意味が取りやすくなります。", "抽象表現は『つまりどういう行動か』に直してみてください。", SOURCE_PORT, ["ことわざ"])

    honorific_rows = [
        ("『部長は会議室にいます』を尊敬語として最も適切なものを選びなさい。", ["部長は会議室にいらっしゃいます", "部長は会議室におられますです", "部長は会議室に参ります", "部長は会議室でございます"], 0),
        ("『後ほど確認します』を謙譲語として最も適切なものを選びなさい。", ["後ほど確認いたします", "後ほどご確認になります", "後ほど確認されます", "後ほど確認でございます"], 0),
        ("『言う』の尊敬語として最も適切なものを選びなさい。", ["おっしゃる", "申す", "いたす", "存じる"], 0),
        ("『見る』の謙譲語として最も適切なものを選びなさい。", ["拝見する", "ご覧になる", "見られる", "お見えになる"], 0),
    ]
    for stem, choices, answer in honorific_rows:
        q("verbal", "reading", "敬語", 2, stem, choices, answer, "敬語は『相手を上げるか、自分を下げるか』の方向で整理すると安定します。", "尊敬語・謙譲語・丁寧語を混ぜず、主語が誰かをまず確認してください。", SOURCE_LANGUAGE, ["敬語"])

    passage_rows = [
        (
            "ある受験者は、SPIでは『知らない問題を考えすぎるより、取れる問題を確実に取るほうが得点が安定する』と考え、難問に時間を使いすぎない方針を立てた。この文の要点として最も適切なものを選びなさい。",
            ["難問に固執せず、取れる問題を確実に取るほうが安定する", "SPIでは難問を解けないと合格できない", "SPIはすべての問題に同じ時間をかけるべきだ", "時間配分より知識量だけが重要だ"],
            0,
        ),
        (
            "企業研究では、情報量の多さより『自分が何を軸に企業を見るか』を決めるほうが比較しやすい。たとえば仕事内容、評価制度、勤務地など軸を先に決めると、複数社を並べても迷いにくくなる。筆者の主張として最も適切なものを選びなさい。",
            ["比較の前に見る軸を決めると企業研究しやすい", "企業研究は情報量が多いほど必ず成功する", "勤務地だけ見れば十分である", "比較せず第一印象で決めるべきだ"], 0,
        ),
        (
            "非言語では公式を覚えるだけでは不十分で、どの場面でその式を使うのかを判断できることが重要だ。たとえば割合なのか増加率なのかを見分けられないと、正しい公式を知っていても点につながらない。最も適切な要点を選びなさい。",
            ["公式の暗記だけでなく、使い分けの判断が必要である", "非言語は公式さえ暗記すれば十分である", "割合と増加率は同じ意味である", "非言語は読む力だけで解ける"], 0,
        ),
        (
            "面接準備では、完璧な回答を暗記するよりも『どんな質問でも自分の経験に戻れる柱』を作っておくほうが応用しやすい。柱があれば聞き方が変わっても答えの軸はぶれにくい。筆者の考えに最も近いものを選びなさい。",
            ["暗記よりも経験の柱を準備するほうが応用しやすい", "面接では同じ文章を暗唱するのが最善だ", "質問が変わることはないので準備は不要だ", "経験より一般論を増やすべきだ"], 0,
        ),
    ]
    for stem, choices, answer in passage_rows:
        q("verbal", "reading", "長文読解", 3, stem, choices, answer, "長文読解では細部より先に『筆者が何を言いたいか』をつかみます。対比や結論の位置に注目すると判断しやすくなります。", "選択肢は本文の一部だけを強調してズラすことがあります。主張全体と一致するかを見てください。", SOURCE_PORT, ["長文読解"])

    profit_rows = [
        ("原価1,200円の商品に25%の利益を見込んで定価をつけた。定価はいくらか。", ["1,500円", "1,440円", "1,320円", "1,600円"], 0),
        ("定価8,000円の商品を15%引きで売った。販売価格はいくらか。", ["6,800円", "7,200円", "6,400円", "7,400円"], 0),
        ("原価2,000円の商品を2,500円で販売した。利益率は何%か。", ["25%", "20%", "30%", "15%"], 0),
        ("定価5,000円の商品を2割引きで販売し、それでも原価4,000円を上回った。利益はいくらか。", ["0円", "500円", "800円", "1,000円"], 0),
    ]
    for stem, choices, answer in profit_rows:
        q("nonverbal", "calculation", "損益算", 2, stem, choices, answer, "損益算は『何に対する割合か』を明確にするのが基本です。利益率は原価基準、値引き率は定価基準です。", "原価・定価・売価の3つを混同しないように、まず図にして整理してください。", SOURCE_PRACTICE, ["損益算"])

    passing_rows = [
        ("長さ150mの列車が長さ210mの橋を渡りきるのに18秒かかった。列車の速さは毎秒何mか。", ["20m", "18m", "15m", "24m"], 0),
        ("長さ120mの電車が、反対方向から来る長さ80mの電車とすれ違うのに5秒かかった。2本の相対速度は毎秒何mか。", ["40m", "32m", "24m", "50m"], 0),
        ("長さ90mの列車が、時速54kmで走っている。長さ60mのホームを通過するのに何秒かかるか。", ["10秒", "8秒", "12秒", "9秒"], 0),
        ("長さ160mの列車がトンネルを通過するのに14秒かかった。列車の速さは毎秒25mである。トンネルの長さは何mか。", ["190m", "180m", "200m", "210m"], 0),
    ]
    for stem, choices, answer in passing_rows:
        q("nonverbal", "calculation", "通過算", 3, stem, choices, answer, "通過算では『先頭が入り始めてから最後尾が抜けるまで』に進む距離は、通過対象の長さと列車の長さの合計です。", "橋・トンネル・列車の長さを足すのか引くのかを、通過の始まりと終わりで考えてください。", SOURCE_PRACTICE, ["通過算"])

    age_rows = [
        ("父は42歳、子は12歳である。何年後に父の年齢が子の年齢の2倍になるか。", ["18年後", "16年後", "20年後", "14年後"], 0),
        ("兄は現在20歳、弟は14歳である。何年前に兄の年齢が弟の年齢の2倍だったか。", ["8年前", "6年前", "4年前", "10年前"], 1),
        ("Aさんは現在30歳、Bさんは24歳である。何年後に2人の年齢の和が70歳になるか。", ["8年後", "10年後", "6年後", "12年後"], 0),
        ("母は現在45歳、娘は15歳である。何年前に母の年齢は娘の3倍だったか。", ["0年前", "5年前", "10年前", "15年前"], 0),
    ]
    for stem, choices, answer in age_rows:
        q("nonverbal", "reasoning", "年齢算", 2, stem, choices, answer, "年齢算は、現在の年齢を基準にして『同じ年数だけ増減する』ことを式にします。", "比が出る問題でも、いきなり比で考えず現在から前後にずらす式を立てると安定します。", SOURCE_NONVERBAL, ["年齢算"])

    table_rows = [
        ("A〜Dの4人が1週間で解いた問題数は、A:18、B:24、C:15、D:27である。平均は何問か。", ["21問", "20問", "19問", "22問"], 0),
        ("ある模試の3科目合計点が、国語72点、数学65点、英語83点だった。平均との差は何点か。", ["9点", "8点", "10点", "7点"], 0),
        ("売上が月ごとに 120, 150, 135, 165 万円だった。最も増加幅が大きい月間変化は何万円か。", ["30万円", "15万円", "45万円", "20万円"], 0),
        ("5日間の来店者数が 40, 55, 50, 65, 40 人だった。中央値は何人か。", ["50人", "55人", "40人", "65人"], 0),
    ]
    for stem, choices, answer in table_rows:
        q("nonverbal", "reasoning", "表の読み取り", 2, stem, choices, answer, "表の読み取り系は式より先に、何を比較するのかを一行で決めることが大切です。", "平均・中央値・増加幅など、問われている指標の意味を取り違えないでください。", SOURCE_PORT, ["表の読み取り"])

    english_rows = [
        ("Select the word closest in meaning to 'reliable'.", ["trustworthy", "fragile", "distant", "silent"], 0, "reliable means you can trust it or depend on it."),
        ("Select the word closest in meaning to 'improve'.", ["enhance", "delay", "refuse", "borrow"], 0, "improve means make something better."),
        ("Select the opposite of 'expand'.", ["reduce", "repeat", "prepare", "observe"], 0, "expand and reduce move in opposite directions."),
        ("Select the opposite of 'temporary'.", ["permanent", "careful", "rapid", "separate"], 0, "temporary means for a short time, so permanent is the opposite."),
        ("If the meeting starts at 9:00, please be (   ) by 8:50.", ["ready", "busy", "empty", "public"], 0, "The natural collocation is 'be ready'."),
        ("She (   ) the report before sending it yesterday.", ["checked", "checks", "checking", "check"], 0, "Yesterday is a past-time marker, so the past form is needed."),
        ("We need data that is clear and easy to (   ).", ["understand", "understood", "understanding", "understands"], 0, "After 'to', the base form is used."),
        ("No sooner (   ) the deadline announced than the team revised the plan.", ["was", "were", "had", "did"], 2, "This inverted structure takes 'had' with the past participle."),
        ("Choose the best word to complete the sentence: The manager asked us to submit the report (   ) Friday afternoon.", ["by", "for", "since", "during"], 0, "'By Friday afternoon' means no later than that time."),
        ("Choose the best word to complete the sentence: This manual is too technical, so please make it easier for new staff to (   ).", ["follow", "following", "followed", "follows"], 0, "After 'to', use the base form. 'Follow' fits the meaning of understanding steps."),
        ("Select the word closest in meaning to 'efficient'.", ["productive", "fragile", "casual", "uncertain"], 0, "efficient means achieving good results without wasting time or effort."),
        ("Select the opposite of 'accurate'.", ["incorrect", "careful", "formal", "silent"], 0, "accurate means correct, so incorrect is the opposite."),
    ]
    for stem, choices, answer, explanation in english_rows:
        difficulty = 2 if "No sooner" not in stem else 3
        subtype = "空欄補充" if "(   )" in stem else "語彙"
        q("english", "grammar", subtype, difficulty, stem, choices, answer, explanation + " In SPI English, speed matters, so rely on signal words and fixed patterns.", "Check tense markers, prepositions, and fixed expressions before translating the whole sentence.", SOURCE_ENGLISH, ["SPI英語"])

    return questions


def get_connection():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=10000")
    return connection


def init_db():
    connection = get_connection()
    cursor = connection.cursor()
    cursor.executescript(
        """
        CREATE TABLE IF NOT EXISTS questions (
            id TEXT PRIMARY KEY,
            category TEXT NOT NULL,
            type TEXT NOT NULL,
            subtype TEXT NOT NULL,
            difficulty INTEGER NOT NULL,
            question TEXT NOT NULL,
            choices_json TEXT NOT NULL,
            answer INTEGER NOT NULL,
            explanation TEXT NOT NULL,
            tips TEXT NOT NULL,
            source_title TEXT NOT NULL,
            source_url TEXT NOT NULL,
            source_note TEXT NOT NULL,
            keywords_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS attempts (
            question_id TEXT PRIMARY KEY,
            user_name TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            correct INTEGER NOT NULL DEFAULT 0,
            last_attempted TEXT,
            wrong_choices_json TEXT NOT NULL DEFAULT '[]',
            category TEXT NOT NULL,
            type TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS daily_activity (
            day TEXT PRIMARY KEY,
            count INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS exams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            category TEXT NOT NULL,
            score INTEGER NOT NULL,
            total INTEGER NOT NULL,
            percent INTEGER NOT NULL,
            time_used INTEGER,
            breakdown_json TEXT NOT NULL,
            question_ids_json TEXT NOT NULL
        );
        """
    )
    for question in build_seed_questions():
        cursor.execute(
            """
            INSERT OR REPLACE INTO questions (
                id, category, type, subtype, difficulty, question, choices_json, answer,
                explanation, tips, source_title, source_url, source_note, keywords_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                question["id"],
                question["category"],
                question["type"],
                question["subtype"],
                question["difficulty"],
                question["question"],
                json.dumps(question["choices"], ensure_ascii=False),
                question["answer"],
                question["explanation"],
                question["tips"],
                question["source_title"],
                question["source_url"],
                question["source_note"],
                json.dumps(question["keywords"], ensure_ascii=False),
            ),
        )
    connection.commit()
    connection.close()


def fetch_questions():
    connection = get_connection()
    rows = connection.execute("SELECT * FROM questions ORDER BY id").fetchall()
    connection.close()
    result = []
    for row in rows:
        result.append(
            {
                "id": row["id"],
                "category": row["category"],
                "categoryLabel": label_category(row["category"]),
                "type": row["type"],
                "typeLabel": label_type(row["type"]),
                "subtype": row["subtype"],
                "difficulty": row["difficulty"],
                "difficultyLabel": label_difficulty(row["difficulty"]),
                "question": row["question"],
                "choices": json.loads(row["choices_json"]),
                "answer": row["answer"],
                "explanation": row["explanation"],
                "tips": row["tips"],
                "sourceTitle": row["source_title"],
                "sourceUrl": row["source_url"],
                "sourceNote": row["source_note"],
                "keywords": json.loads(row["keywords_json"]),
            }
        )
    return result


def fetch_summary():
    connection = get_connection()
    attempts_rows = connection.execute("SELECT * FROM attempts").fetchall()
    exam_rows = connection.execute("SELECT * FROM exams ORDER BY created_at DESC LIMIT 30").fetchall()
    daily_rows = connection.execute("SELECT * FROM daily_activity ORDER BY day").fetchall()
    connection.close()

    attempts = {}
    total_attempts = 0
    total_correct = 0
    by_category = {
        "verbal": {"attempts": 0, "correct": 0},
        "nonverbal": {"attempts": 0, "correct": 0},
        "english": {"attempts": 0, "correct": 0},
    }
    by_type = {}

    for row in attempts_rows:
        attempts[row["question_id"]] = {
            "attempts": row["attempts"],
            "correct": row["correct"],
            "lastAttempted": row["last_attempted"],
            "wrongChoices": json.loads(row["wrong_choices_json"]),
            "category": row["category"],
            "type": row["type"],
        }
        total_attempts += row["attempts"]
        total_correct += row["correct"]
        by_category[row["category"]]["attempts"] += row["attempts"]
        by_category[row["category"]]["correct"] += row["correct"]
        by_type.setdefault(row["type"], {"attempts": 0, "correct": 0})
        by_type[row["type"]]["attempts"] += row["attempts"]
        by_type[row["type"]]["correct"] += row["correct"]

    daily = {row["day"]: row["count"] for row in daily_rows}
    dates = sorted(daily.keys())
    longest = 0
    current_run = 0
    previous_date = None
    for day in dates:
        day_date = datetime.fromisoformat(day)
        if previous_date and (day_date - previous_date).days == 1:
            current_run += 1
        else:
            current_run = 1
        longest = max(longest, current_run)
        previous_date = day_date

    current = 0
    today = utc_today()
    for offset in range(365):
        check = today - timedelta(days=offset)
        if check.isoformat() in daily:
            current += 1
        else:
            break

    exams = []
    for row in exam_rows:
        exams.append(
            {
                "date": row["created_at"],
                "category": row["category"],
                "score": row["score"],
                "total": row["total"],
                "percent": row["percent"],
                "timeUsed": row["time_used"],
                "breakdown": json.loads(row["breakdown_json"]),
                "questionIds": json.loads(row["question_ids_json"]),
            }
        )

    return {
        "attempts": attempts,
        "exams": exams,
        "daily": daily,
        "totalAttempts": total_attempts,
        "totalCorrect": total_correct,
        "byCategory": by_category,
        "byType": by_type,
        "streak": {
            "current": current,
            "longest": longest,
            "totalDaysPracticed": len(dates),
        },
    }


def bootstrap_payload():
    return {
        "questions": fetch_questions(),
        "summary": fetch_summary(),
        "meta": {
            "categories": {
                "verbal": "言語",
                "nonverbal": "非言語",
                "english": "英語",
            },
            "types": {
                "vocabulary": "語彙",
                "reading": "読解",
                "calculation": "計算",
                "reasoning": "推論",
                "grammar": "英語",
            },
        },
        "theme": {
            "characterName": "Cinnamoroll",
            "heroTitle": "Cocoro の SPI準備室",
            "heroSubtitle": "サンリオ公式プロフィールの雲・カフェ・やさしい青をモチーフに再構成。",
            "officialLinks": [SOURCE_SANRIO, SOURCE_SANRIO_WORLD],
        },
        "sources": [
            SOURCE_LANGUAGE,
            SOURCE_NONVERBAL,
            SOURCE_PRACTICE,
            SOURCE_PORT,
            SOURCE_ENGLISH,
            SOURCE_RELATION,
            SOURCE_WORK,
            SOURCE_SANRIO,
            SOURCE_SANRIO_WORLD,
        ],
        "generatedAt": now_iso(),
    }


def json_response(handler, payload, status=200):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class CocoroHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com data:; "
            "img-src 'self' data:; "
            "script-src 'self'; "
            "connect-src 'self'; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none';",
        )
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/bootstrap":
            json_response(self, bootstrap_payload())
            return
        if parsed.path == "/api/health":
            json_response(self, {"ok": True, "time": now_iso()})
            return
        if parsed.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        if rate_limited(self):
            json_response(self, {"error": "rate_limited"}, status=429)
            return
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_BODY_BYTES:
            json_response(self, {"error": "payload_too_large"}, status=413)
            return
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            json_response(self, {"error": "invalid_json"}, status=400)
            return

        if parsed.path == "/api/attempts":
            self.handle_attempt(payload)
            return
        if parsed.path == "/api/exams":
            self.handle_exam(payload)
            return
        json_response(self, {"error": "not_found"}, status=404)

    def handle_attempt(self, payload):
        question_id = payload.get("questionId")
        selected_index = int(payload.get("selectedIndex", -1))
        is_correct = bool(payload.get("isCorrect"))
        category = payload.get("category")
        qtype = payload.get("type")
        if not question_id or category is None or qtype is None:
            json_response(self, {"error": "missing_fields"}, status=400)
            return
        if selected_index not in (0, 1, 2, 3):
            json_response(self, {"error": "invalid_choice"}, status=400)
            return
        if category not in {"verbal", "nonverbal", "english"}:
            json_response(self, {"error": "invalid_category"}, status=400)
            return
        if qtype not in {"vocabulary", "reading", "calculation", "reasoning", "grammar"}:
            json_response(self, {"error": "invalid_type"}, status=400)
            return
        connection = get_connection()
        row = connection.execute("SELECT * FROM attempts WHERE question_id = ?", (question_id,)).fetchone()
        wrong_choices = []
        attempts = 0
        correct = 0
        if row:
            wrong_choices = json.loads(row["wrong_choices_json"])
            attempts = row["attempts"]
            correct = row["correct"]
        attempts += 1
        if is_correct:
            correct += 1
        else:
            wrong_choices = [selected_index] + wrong_choices[:9]
        connection.execute(
            """
            INSERT OR REPLACE INTO attempts (
                question_id, user_name, attempts, correct, last_attempted,
                wrong_choices_json, category, type
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (question_id, USER_NAME, attempts, correct, now_iso(), json.dumps(wrong_choices), category, qtype),
        )
        day = utc_today().isoformat()
        connection.execute(
            """
            INSERT INTO daily_activity (day, count)
            VALUES (?, 1)
            ON CONFLICT(day) DO UPDATE SET count = count + 1
            """,
            (day,),
        )
        connection.commit()
        connection.close()
        json_response(self, {"ok": True})

    def handle_exam(self, payload):
        required = ["category", "score", "total", "percent", "breakdown", "questionIds"]
        if not all(key in payload for key in required):
            json_response(self, {"error": "missing_fields"}, status=400)
            return
        if payload["category"] not in {"all", "verbal", "nonverbal", "english"}:
            json_response(self, {"error": "invalid_category"}, status=400)
            return
        if not isinstance(payload["questionIds"], list) or len(payload["questionIds"]) > 100:
            json_response(self, {"error": "invalid_question_ids"}, status=400)
            return
        connection = get_connection()
        connection.execute(
            """
            INSERT INTO exams (
                user_name, created_at, category, score, total, percent,
                time_used, breakdown_json, question_ids_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                USER_NAME,
                payload.get("date") or now_iso(),
                payload["category"],
                int(payload["score"]),
                int(payload["total"]),
                int(payload["percent"]),
                payload.get("timeUsed"),
                json.dumps(payload["breakdown"], ensure_ascii=False),
                json.dumps(payload["questionIds"], ensure_ascii=False),
            ),
        )
        connection.commit()
        connection.close()
        json_response(self, {"ok": True})


def main():
    init_db()
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), CocoroHandler)
    print(f"Serving Cocoro SPI app on http://0.0.0.0:{port} with db {DB_PATH}")
    server.serve_forever()


if __name__ == "__main__":
    main()
