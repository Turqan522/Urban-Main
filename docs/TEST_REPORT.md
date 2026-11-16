# Test hesabatı

Tarix: 15 noyabr 2026. Mühit: Windows, Node.js 25.2.1, yerli Cloudflare Worker və D1/SQLite.

| Yoxlama | Nəticə |
|---|---|
| `npm test` | 87/87 keçdi: 70 əvvəlki + 17 əlavə modul testi |
| `npm run typecheck` | TypeScript səhvi yoxdur |
| `npm run build` | Worker, SSR və client artefaktları uğurla yarandı |
| `npm run setup:local` | Yerli SQL miqrasiyası uğurludur |
| `node tests/api-smoke.mjs http://127.0.0.1:4173` | 30/30 real HTTP/D1 assertion keçdi; demo sonda sıfırlandı |
| `node tests/expansion-api.mjs http://127.0.0.1:4173` | 18/18 real HTTP/D1 assertion keçdi; demo sonda sıfırlandı |
| `/`, `/manifest.json`, `/sw.js` | Yerli serverdən HTTP 200 |
| Brauzerdə vizual və interaktiv sınaq | Bu yeniləmədə aparıla bilmədi: browser aləti `sandboxPolicy` metadata xətası verdi |
| Real mikrofon, PWA quraşdırılması, mobil cihaz | Bu mühitdə təsdiqlənməyib |

## Əhatə olunan davranışlar

- 5 fərqli vətəndaş, 300 saniyə, radius/zona OR, gələcək/köhnə hadisələr və 90/95 faiz sərhədləri.
- Standart və əlçatan Dijkstra yolları, 50/75 m/dəq ETA, bağlı yollar və bütün məntəqələrin dolması.
- Prioritet 1, aktiv SOS-un əlçatanlıq rejimi ilə yenilənməsi, prioritet alerti və zona sayları.
- Beş QR oxutma ilə yalnız +1; başqa məntəqədə təkrar; invalid/bağlı/dolu məntəqə; son bir yer üçün paralel yarış.
- Eyni CAS port dövründə 10 müxtəlif paralel SOS; 10 təkrar QR sorğusunda 9 idempotent nəticə. Bu iki axın həqiqi lokal D1 HTTP testi ilə də yoxlanılıb.
- Briqada ETA/path, atomik briqada+ehtiyat, ən yaxın ehtiyat, əlçatmaz resurs, tamamlanma, son vətəndaş safe olduqda briqadanın buraxılması, yol bağlanmasında blocked vəziyyəti.
- İtmiş cavabdan sonra gecikmiş SOS replay-in safe hadisəni açmaması; sessiya uyğunluğu; köhnə JSON snapshot miqrasiyası.
- AZ/EN səs açar sözləri və tərcümə cütlərinin tamlığı.
- Növbənin diskdə qalması, sıra, deduplikasiya, göndəriş zamanı yeni element, xəta zamanı silinməməsi və storage quota xətası.
- Service worker install/activate, başqa cache-ləri qoruma, API/POST-u cache-ləməmə, offline HTML və JS cavabı, asset warmup origin filtri, PNG ikon ölçüləri.
- Circuit breaker üçün ilk 503, 5 saniyə timeout, OPEN zamanı daxili Dijkstra, 30 saniyə sonra tək HALF_OPEN yoxlaması.
- Su <20% və qida <10% sərhədləri, marşrutdan çıxarma, narıncı alert, inventar validasiyası və 100%-ə karvan bərpası.
- Könüllü qeydiyyatı/təsdiqi/hazırlığı, bacarıq və məsafə filtri, üç məşğul briqada demosu, səfərbərlik və status ardıcıllığı; peşəkar SOS-un aktiv qalması və telefonun ümumi cavabdan çıxarılması.
- Təsdiqlənmiş klaster və bağlı yoldan zona/1 km üzrə xəbər yayımı; köhnə D1 snapshot-larının yeni sahələrlə miqrasiyası.
- Köhnə brauzer snapshot-unda `resources` sahəsi olmadıqda offline marşrut hesabından əvvəl sahənin tamamlanması.

PWA testləri Node VM-də service worker hadisələrini icra edir; real brauzer lifecycle sınağının əvəzi kimi təqdim edilmir. Səs testləri mətn təsnifatını yoxlayır, mikrofon və brauzerin tanıma xidmətini yoxlamır. Yük, penetrasiya, gerçek fövqəladə hal və tam coverage sertifikasiyası iddiası yoxdur.

## Əl ilə tamamlanacaq brauzer sınağı

1. Production serveri açın; AZ/EN dəyişin, desktop və mobil görünüşü yoxlayın.
2. Vətəndaş rejimində ♿ aktivləşdirin, bir SOS göndərin; dispetçerdə prioriteti yoxlayın.
3. QR simulyasiyasını iki dəfə basın: birinci +1 və safe; ikinci qeydiyyat xəbərdarlığı.
4. Demo cluster yaradın, təsdiqləyin; briqada yolu, ETA və ehtiyat məntəqəni yoxlayın.
5. Səhifə bir dəfə online yükləndikdən sonra şəbəkəni ayırın, yeniləyin və SOS/status növbəsini yoxlayın. Bağlantı bərpa olunanda növbə ardıcıl boşalmalıdır.
6. Mikrofon icazəsi verilən uyğun brauzerdə “Yanğın” / “Fire” deyin. İcazəni rədd etdikdə alternativ SOS düymələri işləməlidir.
7. 503 və 5 saniyəlik marşrut sınaqlarında sarı banneri, 30 saniyə sonra bərpanı yoxlayın.
8. Su demo ssenarisində narıncı alerti, marşrutdan çıxmanı və karvan sonrası bərpanı yoxlayın.
9. Könüllü demo ssenarisində iki vərəqdə qeydiyyat → təsdiq → hazırlıq → səfərbərlik → qəbul → yerində → tamamlandı axınını və tibbi SOS-un aktiv qalmasını yoxlayın.
