# Gabor Care

iPhoneのホーム画面から使う、個人用のガボール刺激トレーニングPWAです。

## 現在の機能

画面の設計判断は `docs/03_ui_v2_spec.md`、画面の文言は `docs/mockups/2026-10-18_ui-v2.html` が正。

- ホームの点描: やった日ごとに点が1つ増え、100日で1枚の絵になる（題材は `data/drawings.json` に5枚。完成まで名前は出さない）
- 使い方・設定のシート（使い方／設定／保守）。中央の縞の練習のやり直し、更新の確認
- 数式から生成するガボールパッチ
- 中央だけを見て「見えた / 出なかった」を答える標準トレーニング
- 見本と同じ縞を探すゲームモード
- iPhoneで見やすい絵探しゲームの16択
- 絵探しゲームは2、3、4、5 cycles/degreeの空間周波数
- 2-down / 1-upに近いコントラスト自動調整
- 初回のみ、標準トレーニングの3問練習
- カード短辺を使った画面実寸校正
- 開始前後の目の疲れの記録（0〜10の数字ボタン）
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
