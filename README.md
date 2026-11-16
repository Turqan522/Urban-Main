# Urban Crisis & Crowd Evacuation Engine

## Canlı sayt

**[Proqramı aç — Urban Main](https://urban-main.turqan522.workers.dev)**

Bu ünvan hamıya açıqdır. GitHub mənbə kodunu saxlayır; tətbiq və D1 bazası Cloudflare-da işləyir. Canlı operator/admin parolları yerli demo parollarından fərqlidir və GitHub-da saxlanmır.

Cloudflare hesabına `npx wrangler login` ilə daxil olduqdan sonra yeniləmələri `npm run deploy:cloudflare` ilə yayımlayın. Bu əmr build edir, baza miqrasiyalarını tətbiq edir və serveri yeniləyir. İlk yayımlamada secret-lər ayrıca təyin olunub; növbəti yayımlamalar onları saxlayır. Konfiqurasiya: `wrangler.production.json`.

Windows-da asan başlatma: `start-local.cmd` faylını iki dəfə klikləyin. Paketlər yoxdursa quraşdırılır, build və yerli baza hazırlanır, sonra `http://127.0.0.1:4173` açmağa hazır olur. Server pəncərəsini açıq saxlayın. PowerShell `npm.ps1` xətası verərsə, aşağıdakı əmrlərdə `npm` əvəzinə `npm.cmd` istifadə edin.

AZ / EN dillərində vətəndaş təhlükəsizliyi və fövqəladə hallar dispetçer prototipi. [Master plan](docs/MASTER_PLAN.md), [əlavə innovasiya planı](docs/ADDITIONAL_PLAN.md), [SOS müdafiə planı](docs/SECURITY_PLAN.md) və [tətbiq xəritəsi](docs/IMPLEMENTATION.md).

**Bu versiya simulyasiyadır.** Məntəqələr, tutumlar, yollar və briqadalar nümunə məlumatlarıdır. Heç bir SOS real xidmətə göndərilmir. Şəhər sxemi real naviqasiya xəritəsi deyil.

## Sürətli işəsalma

Tələblər: Node.js **22.13+** (bu yeniləmənin sınaq mühiti: Windows, Node 25.2.1), npm və ilk quraşdırma üçün internet. Layihə qovluğunda:

```sh
npm run install:ci
npm run build
npm run setup:local
npm start -- --port 4173
```

`http://127.0.0.1:4173` ünvanını açın. PWA / offline sınağı üçün production server istifadə edin. Kod dəyişiklikləri üçün `npm run dev` (`http://localhost:5173`) mövcuddur; service worker development rejimində qeydiyyata alınmır. İki pəncərə eyni sessiyanı paylaşır; fərqli vətəndaş üçün ayrıca brauzer profili istifadə edin.

Yerli `npm run dev` və `npm run setup:local` ilk dəfə `.dev.vars` yaradır. Demo girişi: `operator / crisis2026`, admin qaydaları üçün `admin / admin2026`. Bu fayl GitHub-a daxil edilmir. Sites-də yerləşdirəndə `CRISIS_JWT_SECRET` (ən azı 32 simvol), `CRISIS_OPERATOR_PASSWORD` və `CRISIS_ADMIN_PASSWORD` secret-lərini ayrıca təyin edin. GitHub-a yüklənəcək kodda parol və token saxlamayın.

`setup:local` yalnız **yerli** bazaya miqrasiyaları tətbiq edir; təkrar icrası artıq tətbiq olunmuş miqrasiyanı yenidən işləmir. `npm start` hazırlanmış Worker-i yerli rejimdə açır. Dəyişiklikdən sonra `npm run build` yenidən işlədilməlidir. Yerli məlumatlar `.wrangler/state` qovluğundadır. Brauzeri yeniləmək məlumatları silmir.

## Hazır funksiyalar

### Modul 1 — Vətəndaş

- Zona/qovşaq seçimi, koordinat daxil etmə və icazə verilərsə brauzerin geolokasiyası.
- Açıq, əlçatan və doluluğu 90%-dən aşağı məntəqələrə ən qısa piyada marşrutları.
- Park, sığınacaq, stansiya; insan sayı, tutum, doluluq faizi.
- Yanğın, dağıntı, su basması, tibbi yardım üçün bir düymə ilə SOS.
- “Mən təhlükəsizəm” statusu: istifadəçinin öz aktiv SOS-u bağlanır; status bazada saxlanır.
- Yol bağlandıqda və ya əvvəlki məntəqə 90%-ə çatdıqda avtomatik yenidən hesablama, xəritədə yeni marşrut və bildiriş.
- Təhlükəsiz marşrut qalmadıqda açıq boş vəziyyət; uydurma alternativ göstərilmir.
- ♿ Rejim: yalnız maneəsiz yol və məntəqələr, 50 m/dəq; yeni və mövcud aktiv SOS-da prioritet 1.
- Səslə SOS: Web Speech API, AZ/EN açar sözləri, tanınan mətnin saxlanması. Dəstəklənməyən brauzerdə düymələr işləyir.
- QR kod mətni və ya QR oxutma simulyasiyası: doluluq +1, öz SOS-u safe; eyni və başqa məntəqədə təkrar qeydiyyat ikinci dəfə sayılmır. Tam dolu/bağlı məntəqə rədd edilir.
- PWA shell və son vəziyyət keşi; `localStorage`-da ardıcıl SOS/status növbəsi, bağlantı bərpa olunanda açıq tətbiqdə avtomatik ötürülmə.
- AZ / EN dil seçimi, son mövqe və dil cihazda saxlanır.
- Təsdiqli könüllü ilk yardımçı qeydiyyatı, operator yoxlaması, 1 km-də tövsiyə və qəbul → yolda → hadisə yerində → tamamlandı axını. Könüllü işi peşəkar SOS-u bağlamır.
- Zonaya/1 km radiusa aid avtomatik operativ xəbər lenti; təsdiqli klaster və bağlı yol xəbər yaradır.

### Modul 2 — Dispetçer və analitika

- 3 saniyəlik polling ilə ortaq server vəziyyəti, SOS axını, məntəqələr, briqadalar və audit jurnalı.
- Son 300 saniyədə eyni zonada **və ya** bir SOS-un ətrafında 500 metr radiusda ən azı 5 fərqli vətəndaş: qırmızı xəbərdarlıq.
- Açıq məntəqənin doluluğu **95%-dən çox** olduqda: ehtiyat məntəqə açma xəbərdarlığı.
- Klaster təsdiqi ən yaxın briqadanı göndərir və əlçatan bağlı ehtiyat varsa eyni atomik əməliyyatda açır. Ehtiyat qalmadıqda briqada yenə göndərilir. Doluluq təsdiqi isə ən yaxın əlçatan ehtiyatı açır; ehtiyat yoxdursa xəta qaytarır.
- Təsdiqin təkrar sorğusu ikinci briqada ayırmır. Aktiv, təsdiqlənmiş zona xəbərdarlığına gələn yeni SOS mövcud tapşırığa qoşulur.
- “Bitir” əməliyyatı təyin edilmiş SOS-ları həll edir, briqadanı sərbəst buraxır.
- Yolun açılıb-bağlanması; doluluq sayının redaktəsi; JSON audit ixracı.
- Demo Lab: 5 SOS, 97% doluluq, yol bağlanması, su çatışmazlığı, briqadaların məşğul olduğu tibbi SOS, 503/timeout marşrut sınağı və ilkin vəziyyətə qaytarma.
- Yaşıl briqada marşrutu, müsbət tam ETA (300 m/dəq), vaxtdan asılı simulyasiya hərəkəti və tapşırıq tamamlama.
- Prioritetli SOS-lar hadisə lentində öndədir; hər zonanın aktiv/prioritet SOS sayı, orta doluluğu və son hadisəsi göstərilir.
- Bütün təyin edilmiş vətəndaşlar təhlükəsiz olduqda briqada avtomatik sərbəst buraxılır.
- Hər məntəqədə su, qida, tibbi dəst və batareya göstəriciləri; su <20% və ya qida <10% olduqda yeni marşrutdan kənarlaşdırma və bir klik təchizat karvanı.
- Xarici marşrut xidməti qoşulduqda 503/5s timeout üçün circuit breaker; 30s soyuma, yarıaçıq yoxlama və daxili Dijkstra fallback. Demo Lab-da 503/timeout sınağı var.

## Vacib sərhədlər

| Qayda | Davranış |
|---|---|
| Doluluq 89.8% | Marşrut üçün qəbul edilir, ekranda yuvarlaq faiz 90 görünə bilər |
| Doluluq tam 90% | Yeni təxliyə marşrutuna daxil edilmir |
| Doluluq tam 95% | Kritik doluluq xəbərdarlığı yaratmır |
| Doluluq 95%-dən çox | Kritik doluluq xəbərdarlığı yaradır |
| SOS yaşı tam 300 saniyə | Zaman pəncərəsinə daxildir |
| SOS yaşı 300 saniyədən çox | Kritik klaster hesabına daxil edilmir |
| Təkrar SOS, eyni sessiya | Bir aktiv SOS; fərqli vətəndaş kimi sayılmır |
| Təhlükəsiz / həll edilmiş SOS | Cari böhran klasterinə daxil edilmir |
| Yol qalmayıb | Əlçatan marşrut yoxdur |

Doluluq qərarları yuvarlaqlaşdırılmamış nisbətlə hesablanır. Briqada yönləndirməsi demo əməliyyatıdır; real xidmət inteqrasiyası yoxdur.

## Arxitektura

```text
Brauzer (React + TypeScript)
  -> JSON HTTP API (Vinext App Router / Cloudflare Worker)
  -> Məntiq: marşrutlar, SOS klasterləri, təsdiq əmrləri
  -> D1 / SQLite: versiyalı ortaq vəziyyət + audit
```

- `app/ui.tsx`: hər iki modulun istifadəçi interfeysi.
- `app/globals.css`: rənglər, adaptiv ölçülər, fokus və azaldılmış animasiya dəstəyi.
- `app/api/[...path]/route.ts`: HTTP giriş nöqtəsi, JSON/origin yoxlamaları və sessiya kukisi.
- `lib/crisis/types.ts`: domen tipləri.
- `lib/crisis/seed.ts`: simulyasiya qrafı, məntəqələr, briqadalar, standart qaydalar.
- `lib/crisis/engine.ts`: Haversine məsafəsi, Dijkstra, marşrut və xəbərdarlıq hesabı.
- `lib/crisis/commands.ts`: giriş yoxlamaları və vəziyyət keçidləri.
- `lib/crisis/store.ts`, `transaction.ts`: D1 adapteri və `StatePort` CAS dövrü; 24 cəhd, qısa backoff.
- `lib/crisis/migrate.ts`: köhnə JSON vəziyyətini məlumat itirmədən genişləndirir.
- `lib/i18n.ts`, `lib/voice.ts`, `lib/offline.ts`: dillər, səs təsnifatı və davamlı növbə.
- `components/crisis-map.tsx`, `components/checkin-dialog.tsx`: xəritə/hərəkət və klaviatura fokusunu qoruyan QR dialoqu.
- `public/sw.js`, `manifest.json`, `icon-*.png`: offline shell və quraşdırma metadata-sı.
- `lib/crisis/circuit-breaker.ts`, `volunteers.ts`, `news.ts`, `resources.ts`: yeni modullar; `app/ui-volunteers.tsx`, `ui-news.tsx`, `ui-resources.tsx`: görünüşlər.
- `db/schema.ts`, `drizzle/`: sxem və versiyalı SQL miqrasiyası.
- `tests/`: avtomatik məntiq testləri və yerli HTTP inteqrasiya testi.
- `docs/`: API izahı, demo ssenarisi, texniki müdafiə, Challenge Drop və test hesabatı.

Marşrut: açıq yollar üzrə `məsafə × congestion` qiymətli Dijkstra; adi piyada 75, maneəsiz rejim 50, briqada 300 m/dəq. Koordinat ən yaxın qovşağa bağlanır; birbaşa başlanğıc məsafəsi əlavə edilir. Bu hissənin real əlçatanlığı təsdiqlənmir. UI/API ən yaxın üç uyğun məntəqəni göstərir. Briqada hərəkəti hesablanmış yol/ETA əsasında simulyasiyadır, canlı GPS deyil.

Klaster: tranzitiv DBSCAN zənciri istifadə edilmir. Eyni zona qrupları və hər siqnal ətrafında radius ayrıca qiymətləndirilir; vətəndaş ID-si ilə təkrarlar çıxarılır. Daha böyük artıq göstərilmiş qrupun tam altqrupu ikinci xəbərdarlıq yaratmır. Radius mərkəzi mövcud SOS nöqtəsidir; bütün mümkün coğrafi dairələr axtarılmır. Hər API oxunuşunda server vaxtı ilə aktiv xəbərdarlıqlar yenidən hesablanır.

D1-də bir versiyalı JSON aggregate saxlanır. Bu seçim kiçik hackathon simulyasiyasında hadisə + briqada + audit dəyişikliklərini bir atomik CAS əməliyyatına yığır. Yazılardan biri konfliktə düşəndə yeni versiya oxunaraq yenidən yoxlanır. Böyük miqyasda ayrıca indeksli cədvəllər və queue/spatial index tələb olunur.

## Yoxlama

```sh
npm test
npm run typecheck
npm run build
```

Yerli server işləyərkən, **yalnız silinə bilən demo bazası** üçün:

```sh
node tests/api-smoke.mjs http://127.0.0.1:4173
node tests/expansion-api.mjs http://127.0.0.1:4173
```

Bu HTTP testləri demo vəziyyətini əvvəl və sonra sıfırlayır; paralel SOS, könüllü axını və resurs yönləndirməsini də yoxlayır. Uzaq ünvanlara qəsdən icazə verilmir. Avtomatik test nəticələri və sınaq məhdudiyyətləri `docs/TEST_REPORT.md` faylındadır.

## Challenge Drop

“Analitika qaydaları” səhifəsində zaman pəncərəsi, fərqli vətəndaş sayı, radius və iki doluluq həddi serverdə saxlanılan parametrlərdir. Hər saat veriləcək faktiki şərtlər hələ təqdim edilməyib; uyğunlaşma qeydi `docs/CHALLENGE_DROP.md` faylındadır. Parametr dəyişikliyi ilə həll olunmayan şərt ayrıca kod dəyişikliyi və test tələb edəcək.

## Məlum məhdudiyyətlər / növbəti addımlar

- Şəhər məlumatları tam simulyasiyadır. Xarici xəritə/routing API-si qoşulmayıb; `/api/routes` simulyasiya endpointidir.
- Operator/admin əməliyyatları 8 saatlıq imzalı token və server tərəfli rol yoxlaması ilə qorunur. Demo parolları yalnız yerli `.dev.vars`-da yaranır. Paylaşılan real sistemdə ayrıca istifadəçi bazası, parol hash-ləri, MFA və audit actor-u lazımdır.
- HttpOnly sessiya identifikatoru bir brauzer profilini fərqləndirir; real şəxsin unikal kimliyini sübut etmir. Yeni profil və ya saxta kuki ilə Sybil hücumu mümkündür.
- İstifadəçi koordinatları prototipdə operator görünüşündə mövcuddur. İstehsalda razılıq, məhdud giriş, şifrələmə, retention siyasəti lazımdır.
- Normal vəziyyətdə 3 saniyəlik gecikmə mümkündür; WebSocket/SSE və mobil push növbəti mərhələdir. Bağlantı qırıldıqda son vəziyyət “cari təsdiqlənmir” bildirişi ilə qalır.
- Bir açıq incident üzrə yeni SOS mövcud briqadaya bağlanır. Yeni briqada tələb edən artan risk/say eskalasiyası ayrıca gələcək qaydadır.
- Briqadanın başlanğıc bazası saxlanır; simvol marşrut üzrə interpolasiya edilir. Yol dəyişdikdə ETA bazadan yenidən hesablanır. Real GPS və xidmətə göndəriş yoxdur.
- SOS sayı 1000 aktiv siqnal ilə məhdudlaşır; auditdə son 200 qeyd, təhlükəsiz statuslarda son 24 saat / 1000 sessiya saxlanır. Bu demo limitləri yük sınağı ilə təsdiqlənmiş istehsal tutumu deyil.
- Xəritənin zoom düymələri sxemi böyüdür; sürükləmə və tam GIS naviqasiyası yoxdur. Geolokasiya yalnız demo ərazisində qəbul edilir.
- İnterfeys xarici şrift sorğusu etmədən sistem şriftləri ilə işləyir.
- Offline növbə tətbiq açıq olanda və ya yenidən açıldıqda ötürülür; bağlı brauzerdə Background Sync/mesh radio rabitəsi yoxdur. Sessiya bitərsə köhnə növbə başqa istifadəçi adından göndərilmir: görünən xəta ilə saxlanır.
- Xarici marşrut xidməti default olaraq qoşulmayıb. `ROUTING_API_URL` Worker env-də yalnız etibarlı server ünvanı kimi verildikdə onun `{"shelterIds":["s1",...]}` cavabı yerli uyğun marşrutları sıralayır. Xarici xidmət təhlükəsizlik filtrlərini keçə bilmir. Demo Lab 503/timeout-u bu servis olmadan da sınaqdan keçirir. Circuit vəziyyəti Worker isolate yaddaşındadır; çoxlu isolate arasında paylaşılmır.
- Könüllü təsdiqi rol ilə qorunan demo operator əməlidir; real sertifikat verifikasiyası və push/sms yoxdur. Səsli çağırış yalnız tətbiq açıq olanda brauzerin audio imkanından asılıdır. Könüllü telefonu ümumi state cavabına daxil edilmir.
- QR kamera dekoderi əvəzinə planda icazə verilən simulyasiya və kod mətni girişi var. Səs tanıma brauzerin dəstəyindən, mikrofon icazəsindən və bəzən onun şəbəkə xidmətindən asılıdır.
- AI kritik qərarı təsdiqləmir. Analitika deterministik qaydalarla işləyir; son briqada/məntəqə əməliyyatını insan operator seçir.

## Təhvil materialları

- İşlək mənbə kodu və dependency lockfile.
- Bu `README.md` — işəsalma və arxitektura.
- `AI_DECLARATION.md` — AI istifadəsi və faktiki tapşırıq.
- `TEXNIKI_IZAH.txt` — Notepad / Word ilə açılan UTF-8 texniki izah.
- `docs/DEMO_VE_MUDAFIE.md`, `docs/API.md`, `docs/CHALLENGE_DROP.md`, `docs/TEST_REPORT.md`.
