/**
 * 新UI（GaiXer 医療版）の表示文言を集約する定数ファイル。
 *
 * 決定 D3（判断メモ_Phase1着工ブロッカー.md）に基づき、新UIは日本語固定とする。
 * i18n（t()）は使わず、文言はJSXに直書きせず本ファイルへ集約する。将来多言語化が
 * 必要になった場合は、本ファイルを翻訳キー定義へ機械的に変換できる形を保つこと。
 */
export const GX = {
  brand: {
    name: 'GaiXer',
    tag: '医療版',
  },
  sidebar: {
    newWork: '新しい作業',
    sectionFeatures: '機能',
    sectionHistory: '会話履歴',
    searchPlaceholder: '会話・議事録・実行を検索',
    admin: '管理者設定',
    adminBadge: '管理者',
    adminTitle: '管理者ロールのみ表示',
    settingsTitle: '設定',
    autoBadge: '自動',
    emptyHistory: '会話履歴はまだありません',
  },
  notifications: {
    title: '通知',
    ariaOpen: '通知を開く',
    close: '閉じる',
    empty: '通知はありません',
    markAllRead: 'すべて既読',
  },
  nav: {
    agents: 'AIエージェント',
    minutes: '議事録生成',
    scheduler: 'スケジューラー',
  },
  dateGroups: {
    today: '今日',
    yesterday: '昨日',
    last7: '過去7日間',
    older: 'それ以前',
  },
  pages: {
    home: 'トップ',
    chat: 'チャット',
    agents: 'AIエージェント一覧',
    minutes: '議事録ワークベンチ',
    scheduler: 'スケジューラー運用コンソール',
    admin: '管理コンソール',
    settings: '設定',
  },
  placeholder: {
    note: 'この画面はPhase 1以降で実装予定です（Phase 0: シェルのみ）',
  },
  chat: {
    crumbRoot: '会話',
    newTitle: '新しい会話',
    modelLabel: 'GaiXer Medical',
    filesButton: 'ファイル',
    emptyTitle: '何をお手伝いしましょうか',
    emptySub: '相談したいことを入力してください。資料の添付もできます。',
    loadingMessages: '会話を読み込んでいます…',
  },
  message: {
    you: 'あなた',
    aiName: 'GaiXer Medical',
    copy: 'コピー',
    retry: '再生成',
  },
  composer: {
    placeholderInline: 'メッセージを入力…（Shift + Enter で改行）',
    placeholderHero: '相談したいことを入力してください…',
    attach: 'ファイルを添付',
    micStart: '音声入力を開始',
    micStop: '音声入力を停止',
    send: '送信',
    stop: '生成を停止',
    startGenerate: '生成をはじめる',
    // hero（トップ）のツール行はラベル付きピル（プロト optB-tool）。チップが横に並ぶため短い語にする。
    toolMicLabel: '音声入力',
    toolAttachLabel: '文書を添付',
    // D2：ファイルパネル本体は Phase 1 では出さない。参照ファイルトレイはパネル着工時に有効化する。
  },
  agents: {
    // ヒーロー（GxPageHero）
    eyebrow: 'AI エージェント · ライブラリ',
    // 見出しは GxAgentsPage 側でグラデ強調を組み込むため、語片で持つ
    titleLead: 'どんなことを',
    titleEmphasis: '任せたい',
    titleTrail: 'ですか？',
    sub: 'やりたいことを入力すると、当院で使えるエージェントから合うものを絞り込みます。',
    // 検索
    searchPlaceholder:
      '例: 退院時の塩分制限の指導文を作るのに使えるエージェントは？',
    examplesLabel: '例:',
    examples: ['退院サマリ', '感染対策の通知文', '診療報酬の確認', '外来FAQ'],
    // 一覧セクション
    sectionTitle: 'すべてのエージェント',
    countSuffix: '件',
    // バッジ（GxOriginBadge）
    badgeSystem: '公式',
    badgeUser: '院内',
    // 状態
    loading: 'エージェントを読み込んでいます…',
    empty: '該当するエージェントが見つかりませんでした。',
    emptyHint: '別のキーワードで試してみてください。',
    // フッタ
    footer:
      '入力内容は一覧の絞り込みにのみ使用され、医療記録には保存されません。',
  },
  // 議事録ワークベンチ — 入口の「方法を選ぶ」画面（MChoose 移植）
  minutes: {
    choose: {
      eyebrowBadge: '議事録生成',
      eyebrowText: '会議の音声から、文字起こし → 議事録を自動作成',
      // 見出しはページ側でグラデ強調を組むため語片で持つ
      titleLead: 'さあ、',
      titleEmphasis: '議事録',
      titleTrail: 'にまとめましょう。',
      sub: 'まずは、文字起こしの方法を選んでください。どちらも完了後そのまま編集画面で整えられます。',
      // ライブ（録音）カード
      liveTag: 'ライブ',
      liveTitle: 'その場で文字起こし',
      liveDesc:
        '会議中にマイクで集音し、話しているそばからリアルタイムに文字起こしします。会議をしながら記録を確認できます。',
      liveFeat1: '途中経過がその場で見える',
      liveFeat2: '終了したらそのまま編集画面へ',
      liveGo: 'マイクで始める',
      // ファイルカード
      fileTag: 'アップロード',
      fileTitle: 'ファイルから文字起こし',
      fileDesc:
        'すでに録音・録画したファイルをアップロードして文字起こしします。会議後にまとめて処理したいときに。',
      fileFeat1: '長時間でもまとめて一括処理',
      fileFeat2: '完了したら通知でお知らせ',
      fileGo: 'ファイルを選ぶ',
    },
    // 録音中（MRecording 移植・step 3b）
    record: {
      crumbRoot: '議事録生成',
      title: 'その場で文字起こし',
      // ヘッダの録音バッジ
      statusRecording: '文字起こし中',
      statusPaused: '一時停止中',
      // 話者は停止後にまとめて割り当てる設計（SpDetect）
      speakerInfo: '話者を自動で分離中',
      // 操作ボタン
      pause: '一時停止',
      resume: '再開',
      stop: '停止して整える',
      marker: 'ここに目印',
      markerLabel: '目印',
      backTitle: '方法選択に戻る',
      // 注記（太字部分は noteBold で分割）
      noteLead: '録音中はリアルタイムに文字起こしされます。',
      noteBold:
        '話者の割り当てと本文の修正は、停止後の編集画面でまとめて行います。',
      // 文字起こしがまだ無いときの待機表示
      waiting: '話しはじめると、ここに文字起こしが表示されます…',
      // 認識中（partial）行の話者プレースホルダ
      partialSpeaker: 'spk_?',
      // 話者ラベルが付かない発話の表示名
      speakerUnknown: '話者',
      // マイク開始待ち
      preparing: 'マイクを準備しています…',
    },
    // ファイルから文字起こし（MEntryFile / MUploadProc 移植・step 3c）
    file: {
      title: 'ファイルから文字起こし',
      backTitle: '方法選択に戻る',
      // パンくず（タイトル下の補足）
      crumbSetup: '録音・録画ファイルをアップロードして文字起こし',
      crumbProcessing: '文字起こし中',
      // ヘッダの状態バッジ
      statusNew: '新規ジョブ',
      statusProcessing: '文字起こし中',
      // ドロップゾーン
      dropTitle: 'ファイルをドラッグ＆ドロップ',
      dropTitleEmphasis: ' またはクリックして選択',
      dropSub: '音声・動画ファイルを1つ選択（最大 2GB）',
      // セットアップ
      uploadedLabel: 'アップロード済みのファイル',
      uploadedDone: '完了',
      speakerLabelTitle: '話者分離',
      speakerLabelDesc: '発言者ごとに区別して記録します',
      speakerCount: '想定人数',
      speakerCountHint: '自動検出されるため目安でOK',
      // 話者命名は完了後にまとめて（SpDetect）
      detectLead: '話者の名前は',
      detectBold: '文字起こし完了後',
      detectTail: 'に、spk_0・spk_1… のラベルへまとめて割り当てます。',
      // アクションバー
      actionReady: 'アップロード完了',
      actionStart: '文字起こしを開始',
      // 開始前の未選択状態
      noFile: 'ファイルを選択してください',
      estPrefix: '開始後はバックグラウンドで実行',
      // 処理中
      bgRunningTitle: 'バックグラウンドで実行中',
      bgRunningDesc:
        'この画面を閉じても処理は続きます。完了したらサイドバーのベルとメールでお知らせします。',
      historyButton: '履歴で確認',
      processingTitle: '文字起こししています…',
      processingNote:
        '音声ファイルは一括処理のため、途中経過の文字起こしは表示されません。完了すると全文がまとめて表示されます。（録音は逐次表示できます）',
      // 完了→編集画面へ
      doneTitle: '文字起こしが完了しました',
      goEdit: '確認・修正へ',
    },
    // 編集ワークベンチ（MEditA / MEShared 移植・step 5）
    workbench: {
      backTitle: '議事録一覧に戻る',
      defaultTitle: '無題の会議',
      loading: '会議を読み込んでいます…',
      loadError: '会議を読み込めませんでした。',
      // ヘッダの保存インジケータ
      saving: '保存中…',
      savedPrefix: '保存済み',
      unsaved: '未保存',
      autosave: '自動保存',
      // 要確認 順送り
      triagePrefix: '要確認',
      triageSuffix: '件',
      triageNext: '次へ',
      triageClear: '要確認なし',
      // 話者ロスター
      rosterTitle: '話者の割り当て',
      rosterCount: (total: number, named: number) =>
        `${total}名 · ${named}名 割当済`,
      rosterPlaceholder: (id: number) => `spk_${id} の名前`,
      addSpeaker: '話者を追加',
      mergeHeading: (name: string) => `「${name}」を別の話者に統合`,
      mergeInto: (name: string) => `${name} に統合`,
      reassignHeading: 'この発言の話者を変更',
      reassignFoot: '話者名は上の一覧でまとめて付けられます',
      // 文字起こしペイン
      transcriptTitle: '文字起こし',
      turnCount: (n: number) => `${n} 発話`,
      search: '検索',
      seekTitle: 'この時点の音声を再生',
      tipSplit: 'ここで分割',
      tipMerge: '次の発話と結合',
      tipAdd: '下に発話を追加',
      tipDelete: '削除',
      manualPlaceholder: '（手動追加）ここに発言を入力…',
      estLabel: '時刻 目安',
      manualLabel: '手動追加',
      lowConfLabel: '話者 要確認',
      // 議事録ペイン
      minutesTitle: '議事録',
      genSynced: '最新の文字起こしから生成済み',
      regen: '再生成',
      // 空ステート
      emptyTitle: '文字起こしから議事録を作成します',
      emptyDesc:
        '左の文字起こしをもとに、要約・決定事項・ToDo を自動で抽出します。作成後も自由に編集できます。',
      ghostSummary: '要約',
      ghostDecisions: '決定事項',
      ghostTodos: 'ToDo・宿題',
      genButton: '議事録を生成',
      genHint: '先に話者を割り当てておくと、担当者の精度が上がります',
      // 生成中
      loadingTitle: '議事録を生成しています…',
      loadingDesc: '要約・決定事項・ToDo を抽出しています',
      genError: '議事録の生成に失敗しました。もう一度お試しください。',
      // 要再生成バナー
      staleTitle: '文字起こしを修正しました',
      staleDesc: '変更を議事録に反映するには、再生成してください。',
      // 再生成 確認
      confirmTitle: '再生成すると手編集が上書きされます',
      confirmDesc:
        '議事録の本文を手で直した内容は、最新の文字起こしから作り直されて置き換わります。続けますか？',
      confirmCancel: 'やめる',
      confirmOk: '再生成する',
      // 議事録ドキュメント
      docDate: '日時',
      docAttendees: '出席者',
      secSummary: '要約',
      secDecisions: '決定事項',
      secTodos: 'ToDo・宿題',
      evidence: '根拠',
      emptyMinutesSection: '（該当なし）',
    },
  },
  top: {
    // ヒーロー（eyebrow はピル＋グラデバッジ。プロト optB-eyebrow）
    eyebrowBadge: '医療機関向け',
    eyebrowText: 'GaiXer — 安全な医療現場のための生成AI',
    // 見出しはグラデ強調を語片で持つ（patient-explain 系の温度感）
    titleLead: '今日は、',
    titleEmphasis: 'どんなお手伝い',
    titleTrail: 'をしましょう？',
    sub: '日本語でやりたいことを書くか、下のシーンから選んでください。',
    // コンポーザ（hero バリアントへ placeholder として渡す）
    composerPlaceholder:
      '例：80代女性、入院中の心不全患者さんの退院後の生活指導文を作成したい。塩分制限と服薬管理を中心に。',
    // クイックボタン（よくはじめる作業）
    quickLabel: 'よくはじめる作業',
    // フィルタ
    filterAll: 'すべて',
    // セクション見出し
    sectionTitle: 'シーンから選ぶ',
    countSuffix: '件',
    // フィーチャータイル（統計タイルは非表示。バッジは利用頻度に依らない中立表現）
    featureBadge: 'はじめやすいシーン',
    featureCta: 'このシーンではじめる',
    // フッタ（静的な動作表示。横断集計の数値は出さない）
    footer:
      'ローカル/院内環境にデータが残らない設定で動作中 · モデル: GaiXer Medical',
    // エージェント自動提案エリア（入力を止めると判定エンドポイントを呼ぶ）
    suggest: {
      loading: 'マッチするエージェントを探しています',
      readyTitle:
        'このメッセージなら、こちらのエージェントの方が詳しいかもしれません',
      countLead: '· 上位 ',
      countTail: ' 件',
      skip: '提案を閉じて汎用に送る',
      send: 'このエージェントに送る',
      emptyLead:
        'ピッタリなエージェントは見つかりませんでした。そのまま送信すると ',
      emptyBold: '汎用エージェント',
      emptyTail: ' が対応します。',
    },
    // カテゴリ（dot 色は topData 側でトークンに対応づける）
    categories: {
      patient: '患者・家族向け',
      meeting: '会議・引き継ぎ',
      clinical: '臨床・調査',
      admin: '院内文書・事務',
      learning: '研修・教育',
      visualize: '可視化・音声',
    },
    // クイックボタン（行き先のない議事録・図解は差し替え済み。メモ §4.2）
    quicks: [
      {
        label: '退院サマリから生活指導文を書く',
        icon: 'ScDischarge',
        content:
          '退院される患者さんに渡す生活指導文を作成してください。退院サマリや経過を踏まえ、服薬・食事・運動・次回受診の目安まで含めてください。\n\n・患者さんの状況（疾患・治療経過）：\n・特に注意してほしいこと：',
      },
      {
        label: '検査結果をやさしく説明',
        icon: 'ScResultExplain',
        content:
          '次の検査結果を、患者さんが理解しやすい平易な言葉で説明してください。数値の意味と、次にすべきこともあわせて示してください。\n\n・検査項目と結果：',
      },
      {
        label: '英語論文を3分で要約',
        icon: 'ScPaperSummary',
        content:
          '次の英語論文を、目的・方法・結果・限界の構成で日本語に要約してください。\n\n・論文のタイトルまたは本文：',
      },
      {
        label: '院内通知文の下書き',
        icon: 'ScNotice',
        content:
          '次の内容で、院内通知文・お知らせの下書きを作成してください。\n\n・知らせたい内容（運用変更・感染状況・人事など）：\n・対象（全職員／病棟など）：',
      },
      {
        label: '栄養指導の下書き',
        icon: 'ScForm',
        content:
          '減塩・糖尿病食・腎臓食などの栄養指導文の下書きを作成してください。\n\n・対象（疾患・制限内容）：\n・患者さんの状況：',
      },
    ],
    // シーン（テキスト系14。議事録 conference / 音声 voice / 図解 diagram は除外＝メモ §4.1）
    // content = チャットへ流し込むプロンプト初期値（D5）。icon は topData で対応づける。
    scenes: [
      {
        id: 'patient-explain',
        cat: 'patient',
        title: '患者さんへの説明文をやさしく書く',
        one: '難しい医学用語を、家族にも伝わる言葉に整えます',
        detail:
          '病名・検査結果・治療方針を、患者さん本人やご家族向けにわかりやすい言葉で文章化します。',
        time: '約2分',
        content:
          '次の内容を、患者さんやご家族にも伝わるやさしい言葉で説明する文章にしてください。\n\n・病名／検査・治療の内容：\n・特に伝えたいこと：',
      },
      {
        id: 'discharge',
        cat: 'patient',
        title: '退院後の生活指導文を作る',
        one: '服薬・食事・受診時期まで、退院サマリから抜けなく',
        detail:
          '退院サマリや治療経過から、服薬指導・食事・運動・次回受診のタイミングまでをまとめた患者向け案内を生成します。',
        time: '約3分',
        content:
          '退院される患者さんに渡す生活指導文を作成してください。退院サマリや経過を踏まえ、服薬・食事・運動・次回受診の目安まで含めてください。\n\n・患者さんの状況（疾患・治療経過）：\n・特に注意してほしいこと：',
      },
      {
        id: 'result-explain',
        cat: 'patient',
        title: '検査結果をやさしい言葉で説明する',
        one: '数値の意味と、次に何をすべきかをセットで',
        detail:
          '血液検査・画像検査の結果を、患者さんが理解しやすい平易な日本語に翻訳します。',
        time: '約2分',
        content:
          '次の検査結果を、患者さんが理解しやすい平易な言葉で説明してください。数値の意味と、次にすべきこともあわせて示してください。\n\n・検査項目と結果：',
      },
      {
        id: 'handover',
        cat: 'meeting',
        title: '申し送りメモを整える',
        one: '走り書きや音声を、構造化された申し送り表に',
        detail:
          '夜勤交代時の走り書き・音声メモを、患者ごとの観察事項・処置・注意点に整形します。',
        time: '約1分',
        content:
          '次の申し送り内容を、患者ごとに観察事項・処置・注意点が整理された申し送り表にまとめてください。\n\n・申し送りメモ（走り書き可）：',
      },
      {
        id: 'committee',
        cat: 'meeting',
        title: '委員会の資料を要点化する',
        one: '長い議事録から決定・次回課題だけを抜き出す',
        detail:
          '感染対策・医療安全などの委員会議事録を、結論・アクション・次回議題に要約します。',
        time: '約2分',
        content:
          '次の委員会議事録から、結論・決定事項・アクション・次回議題だけを抜き出して要点化してください。\n\n・議事録本文：',
      },
      {
        id: 'guideline',
        cat: 'clinical',
        title: '診療ガイドラインを要点だけ知りたい',
        one: '数十ページのPDFも、3分で要点把握',
        detail:
          '学会ガイドラインや院内マニュアルから、診断・治療フローの要点を抽出します。臨床判断は必ずご自身で。',
        time: '約3分',
        content:
          '次のガイドライン／マニュアルから、診断・治療フローの要点を抜き出して整理してください。臨床判断は自分で行います。\n\n・対象資料またはテーマ：',
      },
      {
        id: 'paper',
        cat: 'clinical',
        title: '英語論文を日本語で要約する',
        one: 'Abstract+Results を日本語で。引用にも使える形に',
        detail:
          'PubMed等の英語論文を、目的・方法・結果・限界の構成で日本語要約します。',
        time: '約3分',
        content:
          '次の英語論文を、目的・方法・結果・限界の構成で日本語に要約してください。\n\n・論文のタイトルまたは本文：',
      },
      {
        id: 'translate',
        cat: 'clinical',
        title: '外国人患者向けの説明を翻訳する',
        one: '英・中・韓・ベトナム語に医療文脈で翻訳',
        detail:
          '問診票や説明文を医療文脈に配慮した自然な翻訳に。逆翻訳で意味のずれもチェックできます。',
        time: '約1分',
        content:
          '次の説明文／問診票を、患者さん向けに自然な〔　〕語へ翻訳してください。医療文脈に配慮してください。\n\n・原文：\n・翻訳先の言語：',
      },
      {
        id: 'notice',
        cat: 'admin',
        title: '院内通知文・お知らせを書く',
        one: '感染対策・運用変更・人事まで、定型通り',
        detail:
          '新しい運用ルール、感染状況、設備停止などの院内通知文を院内テンプレートに沿って下書きします。',
        time: '約1分',
        content:
          '次の内容で、院内通知文・お知らせの下書きを作成してください。\n\n・知らせたい内容（運用変更・感染状況・人事など）：\n・対象（全職員／病棟など）：',
      },
      {
        id: 'manual',
        cat: 'admin',
        title: '手順書・マニュアルを下書きする',
        one: '口頭で説明している暗黙手順を、文書化',
        detail:
          'ベテランしか知らない手順を、新人にも伝わる手順書として整形します。',
        time: '約3分',
        content:
          '次の手順を、新人にも伝わる手順書・マニュアルとして整理してください。\n\n・対象の業務・手順：',
      },
      {
        id: 'form',
        cat: 'admin',
        title: '医療事務文書を整える',
        one: '診断書・紹介状・意見書のたたき台に',
        detail:
          'テンプレート+患者情報から、診断書・紹介状などの初稿を作成。最終的には医師の確認・署名が必須です。',
        time: '約2分',
        content:
          '次の情報をもとに、〔診断書／紹介状／意見書〕のたたき台を作成してください。最終確認は医師が行います。\n\n・文書の種類：\n・患者情報・記載したい内容：',
      },
      {
        id: 'training',
        cat: 'learning',
        title: '新人向けの研修資料を作る',
        one: '症例ベースの教材を、レベル別に',
        detail:
          '症例情報や手順書から、新人ナース・研修医向けに学習資料を構成します。',
        time: '約4分',
        content:
          '次のテーマで、新人ナース・研修医向けの研修資料を作成してください。\n\n・テーマ：\n・対象者のレベル：',
      },
      {
        id: 'study',
        cat: 'learning',
        title: '院内勉強会の資料を準備する',
        one: 'テーマと聴衆を伝えるだけで構成案ができる',
        detail:
          '聴衆のレベル・時間枠を入力すると、目次・スライド構成・想定質問まで提案します。',
        time: '約3分',
        content:
          '次の条件で、院内勉強会の構成案（目次・スライド構成・想定質問）を作成してください。\n\n・テーマ：\n・聴衆と時間枠：',
      },
      {
        id: 'faq',
        cat: 'visualize',
        title: '患者からよくある質問をFAQに整理する',
        one: '外来で聞かれる質問を、ホームページ用に',
        detail:
          '問診メモや診療記録から、よくある質問とその回答候補を整理してFAQ化します。',
        time: '約2分',
        content:
          '次の問診メモ／診療記録から、外来でよく聞かれる質問とその回答候補を整理し、FAQ形式にまとめてください。\n\n・元になる情報：',
      },
    ],
  },
} as const;
