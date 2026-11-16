# JSON HTTP API

Bütün cavablar UTF-8 JSON-dur; `Cache-Control: no-store`. Eyni origin istifadə edilir. Dəyişdirən sorğularda `Content-Type: application/json` tələb olunur. Server HttpOnly `crisis_citizen` kukisi verir. Demo mühitində bütün operator endpointləri açıqdır; bu, RBAC deyil.

| Metod | Yol | Body / query | Cavab |
|---|---|---|---|
| GET | `/api/health` | — | `ok`, `mode`, `persistence` |
| GET | `/api/state` | — | qraf, anonim SOS, briqadalar, audit, `revision`, `serverTime`, öz `sessionId`, `mySafety`, `myAccessibleMode`, `myCheckin`, `zones[]` |
| GET | `/api/routes` | `lat=40.374&lng=49.838&accessible=true` | ən çox 3 marşrut; sessiyanın əlçatanlıq seçimi də nəzərə alınır |
| GET | `/api/news` | `lat=40.374&lng=49.838` | eyni zona və ya 1 km radius daxilində rəsmi xəbərlər |
| POST | `/api/sos` | `{"lat":40.374,"lng":49.838,"type":"fire"}` | yenilənmiş vəziyyət |
| POST | `/api/safe` | `{}` | öz aktiv SOS-u safe; təhlükəsiz status saxlanır |
| POST | `/api/accessibility` | `{"enabled":true}` | sessiyanın marşrut rejimi və aktiv SOS prioriteti yenilənir |
| POST | `/api/checkin` | `{"qrCode":"QR-SHELTER-S1"}` və ya `{"shelterId":"s1"}` | doluluq +1, SOS safe; təkrarda `alreadyCheckedIn:true`, status 200 |
| POST | `/api/road` | `{"id":"r0-1","closed":true}` | yolun vəziyyəti |
| POST | `/api/occupancy` | `{"id":"s1","occupied":485}` | faktiki insan sayı dəyişir |
| POST | `/api/confirm` | `{"id":"<alerts[].id>"}` | xəbərdarlığın növünə uyğun faktiki dispatch/open; təkrarı ikinci əməliyyat yaratmır |
| POST | `/api/team-complete` | `{"id":"t1"}` | bağlı SOS-lar resolved, briqada available |
| POST | `/api/scenario` | `{"name":"cluster"}` | 5 fərqli demo SOS |
| POST | `/api/scenario` | `{"name":"capacity"}` | s1 → 97% |
| POST | `/api/scenario` | `{"name":"blocked","roadId":"r0-1"}` | göstərilən yol bağlanır; ID yoxdursa ilk yol |
| POST | `/api/scenario` | `{"name":"resource"}` | s2 su ehtiyatı 12%-ə düşür |
| POST | `/api/scenario` | `{"name":"volunteer"}` | demo sıfırlanır, 3 briqada məşğul və yeni tibbi SOS yaradılır |
| POST | `/api/scenario` | `{"name":"reset"}` | demo silinib ilkin vəziyyət qurulur |
| POST | `/api/config` | `{"sosThreshold":5,"windowSeconds":300}` | qismən və ya tam qayda dəyişikliyi |
| POST | `/api/rules` | `/api/config` ilə eyni | config alias |
| POST | `/api/resource-update` | `{"id":"s1","waterLiters":900}` | yalnız 0–max aralığında inventar yeniləyir |
| POST | `/api/resource-resupply` | `{"id":"s1"}` | bütün ehtiyatları 100%-ə qaytarır, audit |
| POST | `/api/volunteer-register` | `{"name":"Samir","phone":"+994 50 123 45 67","skills":["first_aid"],"lat":40.374,"lng":49.838}` | öz könüllü profilini təsdiq gözləyən vəziyyətdə yaradır |
| POST | `/api/volunteer-verify` | `{"id":"<volunteerId>","verified":true}` | demo operatorun yoxlaması |
| POST | `/api/volunteer-ready` | `{"available":true,"lat":40.374,"lng":49.838}` | təsdiqli könüllünün öz əlçatanlığı |
| POST | `/api/volunteer-dispatch` | `{"sosId":"<id>","volunteerId":"<id>"}` | yalnız aktiv tibbi SOS, bütün briqadalar məşğul, 1 km, bacarıq, maneəsiz yol |
| POST | `/api/volunteer-status` | `{"status":"en_route"}` → `on_scene` → `completed` | yalnız öz tapşırığının ardıcıl keçidi |

`type`: `fire`, `collapse`, `flood`, `medical`.

Koordinat ərazisi: 40.35 ≤ lat ≤ 40.41, 49.81 ≤ lng ≤ 49.88. Bu hədd yalnız demo qrafı üçündür.

Qayda intervalları: windowSeconds 30–1800; sosThreshold 2–50; radiusMeters 50–2000; routeLimit 50–95; alertLimit 90–100. Tam ədəd tələb olunur, `routeLimit ≤ alertLimit`.

Route obyektində `shelter`, `nodeIds`, `roadIds`, `meters`, `minutes`, `occupancy` verilir. Başlanğıc koordinat ən yaxın qovşağa snap edilir. Boş `routes: []` əlçatan uyğun məntəqə tapılmadığını bildirir.

SOS obyektlərində daxili citizenId çıxarılır; `mine` cari sessiyanı göstərir. ID-lər UUID-dir; brauzerdən başqasının SOS ID-si göndərməklə safe etmək üçün endpoint yoxdur. Operatorların demo səlahiyyəti isə ayrıca məhdudlaşdırılmayıb.

Vətəndaş əməliyyatları əlavə `requestId` (8–80 alfanumerik/tire simvolu) və `sessionId` qəbul edir. UI bu sahələri növbədə saxlayır. Eyni sorğu sonradan, SOS bağlandıqdan sonra gəlsə belə yenidən hadisə yaratmır. `sessionId` kukiyə uyğun deyilsə `SESSION_EXPIRED` xətası verilir; başqa sessiyanın identifikatorları cavabda göstərilmir. `voiceTranscript` SOS üçün maksimum 500 simvol saxlanır. Prioritet müştəridən qəbul edilmir, serverdə `accessibleMode` əsasında seçilir.

Klaster təsdiqi briqada + varsa ən yaxın əlçatan ehtiyatı bir CAS yazısı ilə saxlayır. Briqadada `targetNode`, `etaMinutes`, `routePath`, `routeMeters`, `dispatchedAt`, `routeBlocked` verilir. Son vətəndaş təhlükəsiz olduqda boş tapşırıq avtomatik buraxılır.

Xətalar: 400 giriş / resurs vəziyyəti xətası; 403 uyğun olmayan Origin; 404 endpoint və ya əməliyyat yoxdur; 409 24 CAS cəhdi bitdi; 413 body 10000 simvoldan çoxdur; 415 JSON Content-Type deyil; 503 DB / daxili xəta. Xəta forması `{"error":"izah"}`. Tam dolu və bağlı məntəqəyə yeni check-in 400 qaytarır. Body həddi ümumi server ingress limiti əvəzi deyil.
