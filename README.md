# Kelimeli Online Server v0.3

Kelimeli Karşılaşma modu için gerçek zamanlı Node.js + Socket.IO sunucusu.

## v0.3 özellikleri

- 2 sabit 4 kişilik Çoklu oda
- 2 sabit 2 kişilik Bire Bir oda
- Sunucu tarafında doluya en yakın uygun odaya hızlı eşleştirme
- 6 haneli özel oda kodu
- Özel odada 2/3/4 oyuncu, 3/5/7/10 kelime ve 90/120/150/200/240/300 saniye ayarı
- Standart Bire Bir ve Çoklu: 5 kelime × 200 saniye
- Her kelimede 6 tahmin
- Aynı kelime tüm oyuncular için sunucuda seçilir; cevap tur bitmeden istemciye gönderilmez
- Tur puanlama:
  - Kelimeyi bilme +20
  - İlk bilen +15
  - İkinci bilen +5
  - Yalnız 1 kişi bilirse o kişiye +20
  - Tam 2 kişi bilirse ikisine de +5
- Her kelime sonunda puan dökümü ve kümülatif sıralama
- Son kelimeden sonra genel sıralama ve kazanan
- 15 saniyelik reconnect toleransı
- `/health` ve `/test`

## Deploy

Mevcut GitHub reposunun köküne bu paketteki dosyaları yükleyip commit et. Dokploy'da `Deploy` kullan.

Container portu: `3000`.

Deploy sonrası `/health` çıktısında `version: "0.3.0"` görülmelidir.
