# Kelimeli Online Server v0.5

Kelimeli Karşılaşma modu için gerçek zamanlı Node.js + Socket.IO sunucusu.

## v0.5

- Bire Bir, Çoklu ve Özel Oda akışları
- 6 haneli özel oda kodu
- Sunucu tarafında ortak kelime ve Wordle değerlendirmesi
- Çok turlu maç, hazır sistemi, geri sayım, puan ve sıralama
- Reconnect desteği
- **Online Harf Alayım**: `match:hint` olayı sunucuda bilinmeyen bir konumu seçer; cevap bütünü istemciye açılmaz. Maliyet bilgisi: **1 altın**.
- **Online Yanlışımı Sil**: `match:undo` son yanlış tahmini sunucuda geri alır ve deneme hakkını iade eder. Maliyet bilgisi: **3 altın**.
- `match:self-state`, yeniden bağlanınca daha önce alınmış harf ipuçlarını da geri döndürür.
- `/health` artık desteklenen jokerleri ve maliyetlerini bildirir.

> Not: Oyuncunun mevcut altın bakiyesi şu an iOS uygulamasındaki yerel Kelimeli ekonomisinde tutuluyor. Sunucu jokerin oyun durumunu otoriter biçimde yönetir; altın düşümü uygulama tarafında, başarılı ACK sonrasında yapılır. Hesap tabanlı kalıcı ekonomi geldiğinde bakiye kontrolü sunucuya taşınabilir.

## Socket olayları

### Harf ipucu

İstemci:

```js
socket.emit("match:hint", {}, ack => { ... });
```

Başarılı ACK örneği:

```json
{
  "ok": true,
  "position": 2,
  "letter": "l",
  "hints": [{ "position": 2, "letter": "l" }],
  "cost": 1
}
```

### Son yanlış tahmini geri alma

İstemci:

```js
socket.emit("match:undo", {}, ack => { ... });
```

Başarılı ACK içinde `removed`, kalan `guesses`, yeni `attempt` ve `cost: 3` döner. Doğru tahmin, pes edilmiş tur veya bitmiş tur geri alınamaz.

## Deploy

Mevcut GitHub reposunun köküne bu ZIP içindeki dosyaları yükle/değiştir ve commit et. Dokploy'da **Deploy** kullan.

Container portu: `3000`.

Deploy sonrası:

- `/health` içinde `version: "0.5.0"` görünmeli.
- `powerups.hint.enabled` ve `powerups.undo.enabled` `true` olmalı.
- Tarayıcıdan `/test` açıp iki oyuncuyla Harf Alayım ve Yanlışımı Sil akışlarını test edebilirsin.
