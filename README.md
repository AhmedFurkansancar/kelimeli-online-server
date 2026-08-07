# Kelimeli Online Server v0.1

Kelimeli'nin ilk canlı oda/lobby altyapısı.

## Var
- 2 sabit 4 kişilik genel oda
- 2 sabit 2 kişilik birebir oda
- 2/3/4 kişilik özel oda
- 6 haneli özel oda kodu
- Son kişi çıkınca özel odayı otomatik silme
- Hazır/bekliyor durumu
- Bağlantı kopunca 15 saniyelik reconnect rezervi
- `GET /health`
- `GET /api/rooms`
- `POST /api/session`
- Socket.IO
- `/test` tarayıcı test ekranı

## Henüz yok
Maçın kelime/süre/puan/kazanan kuralları. Önce oda altyapısı iki cihazla doğrulanacak.

## Dokploy
- Provider: Git (public HTTPS repository)
- Branch: `main`
- Build type: `Dockerfile`
- Dockerfile path: `Dockerfile`
- Container port: `3000`
- İlk test için environment variable zorunlu değil.
