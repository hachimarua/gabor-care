# Gabor Care

iPhoneのホーム画面から使う、個人用のガボール刺激トレーニングPWAです。

## 現在の機能

- 数式から生成するガボールパッチ
- 2区間強制選択の標準トレーニング
- 見本と同じ縞を探すゲームモード
- 2、4、6 cycles/degreeの空間周波数
- 2-down / 1-upに近いコントラスト自動調整
- カード短辺を使った画面実寸校正
- 開始前後の眼精疲労記録
- 終了後20秒の遠方視休憩
- 端末内履歴保存
- オフライン対応

## ローカル確認

```bash
npm run verify
npm run build
npm run serve
```

ブラウザで `http://localhost:4173` を開きます。

## Cloudflare Pages

- Production branch: `main`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: 空欄

## iPhone導入に必要な次の手順

PWAとしてホーム画面へ追加するには、HTTPSで公開されたURLが必要です。GitHub PagesまたはCloudflare Pagesへ配置した後、Safariの共有メニューから「ホーム画面に追加」を選びます。

## 医学的な位置づけ

これは医療機器、視力検査、屈折異常の治療ではありません。ガボール刺激を用いた知覚課題と休憩習慣を支援する個人用ツールです。痛み、複視、急な視力低下、持続するかすみがある場合は使用せず、眼科で評価を受けてください。
