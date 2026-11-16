# Master planın tətbiq xəritəsi

15 noyabr 2026 — yalnız `Urban_Crisis_Prototype` yenilənib. İstifadəçinin verdiyi plan `MASTER_PLAN.md`-də saxlanılıb.

Əlavə müstəqil plan `ADDITIONAL_PLAN.md`-də saxlanılıb; dörd yeni modul mövcud axının üzərinə qurulub:

| Yeni modul | Tətbiq |
|---|---|
| Circuit breaker | `circuit-breaker.ts` CLOSED/OPEN/HALF_OPEN, ilk xəta/5s timeout ilə fallback, 30s cooldown, tək probe; `/api/routes` daxili qrafı istifadə edir və `routing` metadata qaytarır. UI sarı banner və Demo Lab sınaqları var. |
| Könüllü | Qeydiyyat, operator təsdiqi, hazır olma, 1 km + ilk yardım bacarığı + maneəsiz yol filtri, bir klik dəvət, qəbul/yolda/hadisə yerində/tamamlandı; peşəkar SOS aktiv qalır. Telefon ümumi cavabdan çıxarılır. |
| Geo xəbərlər | Klaster təsdiqi və yol bağlanması eyni CAS əməliyyatında xəbər yaradır; zonaya və ya 1 km-ə görə API/UI filtri, AZ/EN məzmunu və tibbi könüllü çağırışı. |
| Sığınacaq resursları | Su, qida, tibbi dəst, batareya. Su <20% və ya qida <10% olduqda yeni yönləndirmə dayandırılır; narıncı alert, inventar yeniləmə və karvanla 100%-ə bərpa. |

Əlavə planın 1. paraqrafında su <20% olduqda yönləndirmənin dayandırılması, nümunə kodunda isə <15% qeyd olunur. Daha ehtiyatlı 20% həddi seçilib; 20% tam olduqda məntəqə uyğundur. Köhnə D1 snapshot-ları `migrateState` ilə genişləndirilir.

| Faza | Tətbiq |
|---|---|
| 1: Core | `types`, `seed`, `engine`, `commands`: əlçatan yol/məntəqə, prioritet, check-in, ETA, ən yaxın ehtiyat; `migrate` köhnə JSON-u genişləndirir |
| 2: AZ/EN, voice | `i18n.ts` bütün UI yazıları, yer adlarının təsviri; `voice.ts` AZ/EN açar söz təsnifatı; mikrofon icazəsi və dəstək xətaları |
| 3: Vətəndaş | Xəritə qovşağı, GPS/koordinat; ən yaxın 3 yol; ♿ checkbox; dörd bir klik SOS; səs; native dialog ilə QR kod/simulyasiya; safe |
| 4: Dispetçer | Qırmızı banner, prioritet lenti, zona cədvəli, yaşıl briqada yolu/hərəkət/ETA, bir klik confirm, bitirmə, yol/doluluq idarəsi |
| 5: PWA | Manifest, PNG ikonları, service worker shell/asset keşi, localStorage snapshot/növbə, sıralı replay, Web Locks, retry və görünən rədd xətaları |
| 6: Test/demo | Domen, CAS, növbə, səs, PWA testləri; real lokal D1 API smoke; README, API, AI deklarasiyası və 3 dəqiqəlik demo |

## Qərarlar və sərhədlər

- **Məlumat portu:** `StatePort` storage-dan asılı deyil; D1 adapteri həqiqi `UPDATE ... WHERE revision=?` edir. Test adapteri eyni transaction dövrünü paralel çağırır.
- **İdempotentlik:** bir aktiv SOS/sessiya, sorğu qəbzləri, bir check-in/sessiya. Eyni vətəndaş başqa məntəqəyə təkrar qeydiyyatdan keçəndə ikinci sayılmır.
- **Tutum:** yeni check-in tam dolu məntəqəyə saxta çatma yazmaq əvəzinə rədd edilir; son bir yerə iki paralel sorğudan yalnız biri qəbul edilir.
- **Bir klik qərar:** klasterdə briqada və mövcud ehtiyat eyni atomik yazıdadır. Ehtiyat tükənməsi briqada göndərişini dayandırmır. Doluluq alerti üçün ehtiyat zəruridir.
- **Növbə:** hər sorğu göndərilməzdən əvvəl diskə yazılır. Yalnız uğurlu cavabdan sonra silinir. Şəbəkə/409/5xx halları yenidən sınanır; 4xx sorğunu saxlayıb istifadəçiyə göstərir. Sessiya bitəndə köhnə sorğu yeni sessiyaya aid edilmir.
- **Offline:** tətbiq ilk dəfə online açılmalıdır; app bağlananda göndəriş dayanır, açıldıqda davam edir. Fiziki mesh/Bluetooth rabitəsi əlavə edilməyib; planın offline növbə simulyasiyası tətbiq olunub.
- **QR:** planın icazə verdiyi simulyasiya və kod mətni girişi tətbiq edilib; kamera dekoderi yoxdur.
- **Hərəkət:** ETA və xəritə animasiyası hesablanmış simulyasiyadır. Yol əməliyyatında briqada marşrutu bazadan yenilənir. Canlı GPS yoxdur.
- **Miqrasiya:** mövcud `crisis_state.payload`-a default sahələr əlavə olunur; baza və doluluq reset edilmir. Yeni SQL cədvəli tələb olunmur.
- **Qiymətləndirmə:** tətbiq və test nəticələri sənədləşdirilir; 100/100 bal və ya tam test coverage zəmanəti verilmir.
