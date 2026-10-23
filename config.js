/* 設定ファイル（公開してOKな内容だけ書く） */
var SITE_CONFIG = {
  // アクセス時のbot認証（Cloudflare Turnstile）。ローディングの途中で表示される
  //   siteKey    : Turnstile のサイトキー（公開してOK）。空にするとbot認証なし
  //   ttlMinutes : 一度通ってから、もう一度確認するまでの時間（分）
  //   ※ シークレットキーはここに書かない（Worker の Secret に入れる）
  //   ※ 下の hitokoto.api（WorkerのURL）が入っていると、サーバー側でも確認する
  turnstile: {
    siteKey: "0x4AAAAAAFgrWVzr5n9niR7_",
    ttlMinutes: 60
  },

  hitokoto: {
    // Cloudflare Worker のURL（worker.js をデプロイして、そのURLをここに入れる）。
    // 空のままだと hitokoto.json の静的ファイル方式になる
    api: "https://hitokoto.n4v7h5dv5g.workers.dev/",
    file: "hitokoto.json",
    fallback: "エラー"
  }
};
