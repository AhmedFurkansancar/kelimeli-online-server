# Kelimeli Online Server v0.2

Bu sürüm canlı oda altyapısına gerçek karşılaşma motorunu ekler.

- 2 sabit genel oda (4 kişi)
- 2 sabit birebir oda (2 kişi)
- 6 haneli 2/3/4 kişilik özel oda
- Genel odada en az 2 hazır oyuncu -> 10 sn geri sayım
- Birebirde 2/2 hazır -> 3 sn geri sayım
- Özel odada tüm oyuncular hazırken kurucu başlatır -> 3 sn geri sayım
- Aynı 5 harfli kelime, 6 tahmin, varsayılan 120 sn
- Doğru kelime yalnızca sunucuda tutulur; maç bitene kadar rakiplere gönderilmez
- Rakipler yalnızca renk desenlerini görür
- Pes etme, süre dolumu, sıralama ve 10 sn sonra oda reseti
- 15 sn reconnect rezervi

Sunucu portu: `3000`

Canlı test: `/test`
Sağlık: `/health`

Kelime sayısı: 5162
