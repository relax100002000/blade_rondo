# Blade Rondo P2P · 純前端線上對戰

完全不需要自己跑伺服器的版本。雙方瀏覽器透過 **MQTT over WebSocket** 連到
公開的 EMQX broker（`wss://broker.emqx.io:8084/mqtt`），訂閱同一個房號 topic
即可互傳訊息進行對戰。

卡牌資料來自 https://sdrice.name/br.html  
（旭翼文化 / Domina Game 版權所有，本程式僅供學習研究用途）

## 啟動方式

**不需要 Node.js、不需要 npm install。**

1. 把 `blade-rondo-p2p/` 整個資料夾放到任意位置。
2. 雙擊 `index.html` 直接在瀏覽器開啟即可。
3. 兩個分頁（或兩台電腦）都打開 index.html：
   - A 端：輸入名稱 → 點「建立房間」→ 畫面上會顯示 4 碼房號（如 `AZCK`）
   - B 端：輸入名稱 + A 給的房號 → 點「加入」
4. 兩邊都進入「選牌」畫面，各自挑 7 張 → 點「確認牌組」→ 自動開戰。

> **需要網路。** 因為是透過 EMQX 公開 broker 中繼，無網路時無法配對。  
> **不要關掉瀏覽器分頁。** 關閉等於斷線；對戰中斷線目前不會自動恢復。  

## 架構

```
[A 端瀏覽器]                                [B 端瀏覽器]
   index.html                                  index.html
   ├ cards.js                                  ├ cards.js
   ├ game.js   <-- 主機端跑遊戲邏輯             ├ game.js  (備援，不主動執行)
   ├ net.js    -- MQTT WebSocket --            ├ net.js
   └ client.js          │                      └ client.js
                        ▼
              wss://broker.emqx.io:8084/mqtt
                topic = bladerondo/v2/{房號}
```

- **主機端 (host)**：點「建立房間」的那一邊。執行 `game.js` 內所有狀態機，
  收到對方 action 後處理 → 廣播新的 state。
- **訪客端 (guest)**：點「加入」的那一邊。只送 action、收 state 並渲染。

## 訊息協定

兩邊在同一 MQTT topic 上發佈 JSON：

| 來自 | type | 說明 |
|------|------|------|
| guest | `guest_hello` | 加入時送 `{name}`，host 收到後新增玩家並廣播 state |
| host  | `host_announce` | 連線完成時廣播，讓 guest 知道 host 在 |
| host  | `state` | 廣播給 guest 的 publicView |
| guest | `action` | 玩家動作 `{kind, ...}`，kind 可為 `submit_deck` / `play_card` / `react` / `pass_react` / `end_turn` / `rematch` |
| 任一  | `chat` | `{text, fromName}` 聊天訊息 |

訊息都含 `from: myId` 欄位，自己發出的訊息會被自己過濾掉避免迴圈。

## 已實作 vs. 簡化

✅ 完整：物理／魔法攻擊、ATK/DEF/魔力結算、反應卡、日/月、中毒、刻印、HP=0 勝負判定、再戰  
⚠ 簡化：召喚物多回合在場、錬成/凍結/COIN 設置區、需手動指定目標的效果改為立即／隨機  

## 想換掉 MQTT broker？

EMQX 公開 broker 雖然免費但無 SLA。要改用其他 broker（例如自架的 mosquitto、
HiveMQ 公開 broker、或 PieSocket）只要修改 `net.js` 裡的 `BROKERS` 陣列即可。

```js
const BROKERS = [
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081',
];
```

如果要更安全，建議自己註冊 HiveMQ Cloud 免費方案（拿到專屬帳密 + WSS URL）
然後在 `mqtt.connect()` options 加上 `username` / `password`。

## License

- 卡牌效果、用語 © 旭翼文化 / Domina Game  
- 卡牌資料整理 © sdrice.name  
- 本程式碼 MIT
