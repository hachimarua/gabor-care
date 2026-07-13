# 48時間ナッジのセットアップ

## 動作

- トレーニングを最後まで完了した時点から48時間を数える
- 次の通知希望時刻に1回だけ通知する。既定は日本時間18:30
- 希望時刻は06:30から21:30まで30分単位で選べる
- 22:00から翌06:29は送信しない
- 通知を送った後は、次のトレーニングを完了するまで再通知しない
- iPhoneではホーム画面に追加したPWAで、設定画面の明示的な操作からだけ通知許可を求める

通知タップ時は、絵探しゲームの開始前の疲労度記録へ進む。

## 保存する情報

Cloudflare D1には、端末ごとの匿名識別子、ハッシュ化した端末トークン、Web Pushの通知先、最後の完了日時、通知済み状態、通知希望時刻だけを保存する。疲労度、正答率、問題内容、個人名は送信しない。

## 初回のCloudflare設定

このリポジトリは既存のCloudflare Pagesをそのまま使う。通知設定APIと定時送信は、同じCloudflare Workerが担う。PWAからWorkerへ接続するのは通知先・匿名端末識別子・完了日時だけであり、Workerは本番PagesのURLだけをCORSで許可する。

1. VAPID鍵を生成する。出力した秘密鍵は記録せず、次の手順でCloudflare Secretへ直接設定する。

   ```bash
   npm run vapid:keys
   ```

2. D1データベースを作成する。

   ```bash
   cd workers/nudge
   npm install
   npx wrangler d1 create gabor-care-nudge
   ```

   表示された `database_id` を [wrangler.jsonc](../workers/nudge/wrangler.jsonc) の `REPLACE_WITH_D1_DATABASE_ID` と置き換える。

3. スキーマを本番D1へ反映する。

   ```bash
   npx wrangler d1 execute gabor-care-nudge --remote --file migrations/0001_devices.sql
   ```

4. Scheduled Workerに秘密値を設定してデプロイする。

   ```bash
   npx wrangler secret put VAPID_PUBLIC_KEY
   npx wrangler secret put VAPID_PRIVATE_KEY
   npx wrangler secret put VAPID_SUBJECT
   npx wrangler deploy
   ```

   `VAPID_SUBJECT` は `mailto:your-address@example.com` の形式にする。Workerは5分ごとに確認するが、希望時刻を過ぎた同日にだけ送信し、夜間には送信しない。

5. Workerへ本番PagesのURLをSecretとして設定する。

   ```bash
   printf '%s' 'https://gabor-care.pages.dev' | npx wrangler secret put ALLOWED_ORIGIN
   ```

6. `main`へ反映してPagesを再デプロイする。PWA側の通知設定画面がWorker APIへ接続する。

## 動作確認

1. iPhoneのSafariで本番URLを開き、「ホーム画面に追加」する。
2. ホーム画面のGabor Careを開き、設定 > 継続の通知で時刻を選び、「通知を設定」を押す。
3. iPhoneの通知許可を与える。
4. テスト用にD1の `last_completed_at` と `next_nudge_at` を近い時刻に設定し、通知が希望時刻以降に1回だけ届くことを確認する。
5. 22:00以降と06:29以前には通知されず、06:30以降にだけ候補となることを確認する。
6. 通知をタップすると絵探しゲームの開始前画面に進むこと、トレーニング完了後は同じ周期で再通知されないことを確認する。

`npm run nudge:check` はWorkerをCloudflareへ送らずにバンドル検証する。実際の送信確認には上記のD1・Secret設定とWorkerデプロイが必要である。
