# Challenge Drop dəyişiklik jurnalı

12:00 / 13:00 / 14:00 üçün təşkilatçıların verəcəyi əlavə şərtlər bu versiya hazırlanarkən təqdim edilməyib. Aşağıdakılar hazırlıq imkanlarıdır; verilməmiş challenge-lərin tamamlandığı iddia edilmir.

| Şərt kateqoriyası | Hazır dəyişiklik nöqtəsi | Sübut |
|---|---|---|
| Zaman, radius, say həddi | UI “Analitika qaydaları” və POST /api/config | config threshold testi |
| 90 / 95 hədlərinin dəyişməsi | routeLimit / alertLimit | sərhəd testləri |
| Yolun bağlanması | POST /api/road | alternativ yol testi |
| Yeni doluluq mənbəyi | POST /api/occupancy / gələcək adapter | doluluq validasiyası |
| Yeni marşrut mənbəyi | engine routes() üçün adapter | qrafdan API qaytarış müqaviləsi |
| Yeni təhlükə növü | commands TYPES + UI dangerNames | yeni növ qəbul/rədd testi əlavə edin |
| Şəbəkə kəsilməsi | offline banner, 8s GET / 12s POST timeout | brauzerdə ayrıca kəsilmə sınağı tələb edir |
| Təkrar/paralel hadisələr | sessiya dedup + versioned CAS | məntiq testi; yerli HTTP smoke skripti daxildir |

## Hər drop üçün doldurun

- Vaxt və təşkilatçı şərtinin olduğu kimi mətni:
- Cari davranış / gözlənilən yeni davranış:
- Dəyişən fayl və API:
- Regresiya testi və alınmış nəticə:
- Komanda üzvü və commit:
- Demo addımı:
- Qalan məhdudiyyət:

Yeni qaydanı əvvəl test nümunəsi ilə ifadə edin. Yalnız testə uyğun kodu dəyişin. Konfiqurasiya miqrasiyası lazımdırsa əvvəlki payload-lar üçün default təmin edin. Mövcud SQL miqrasiyasını dəyişmək əvəzinə yenisini əlavə edin.

## 15 noyabr 2026 — Master plan genişləndirməsi

- Zaman 30–1800 saniyə, hədd 2–50 fərqli vətəndaş, radius 50–2000 m, marşrut 50–95%, kritik doluluq 90–100%: paneldən dərhal dəyişir; `/api/rules` alias-ı da var.
- ♿ qaydası: əlçatan kənar/məntəqə, 50 m/dəq, SOS priority=1; kodda ayrıca routing seçimi var.
- QR qaydası: bir sessiya bir check-in; eyni və başqa məntəqədə təkrar artım yoxdur, tam dolu məntəqə yeni qeydiyyatı rədd edir.
- Briqada: 300 m/dəq, əlçatan ən qısa yol, ən yaxın ehtiyat; klasterdə eyni CAS yazısı ilə icra.
- Offline: unikal sorğu qəbzi, FIFO replay, sessiya yoxlaması və görünən retry/discard.
- Əlavə limitlər və davranışlar 87 test + 48 lokal HTTP assertion ilə yoxlanılıb. Bu maddələr tətbiq edilən plan genişləndirmələridir, ayrıca təşkilatçıdan alınmış real challenge drop kimi təqdim edilmir.

## Əlavə müstəqil planın tətbiqi

- Xarici marşrut API-si üçün 503/timeout circuit breaker və daxili Dijkstra fallback.
- Təsdiqli könüllünün ilk yardım dəstəyi; üç məşğul briqada və tibbi SOS demo ssenarisi.
- Klaster/yol hadisələrindən zona və 1 km radius üzrə rəsmi xəbər yayımı.
- Su/qida həddinə görə yönləndirmə və 100%-lik təchizat bərpası.
