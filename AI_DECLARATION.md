# Süni İntellekt (AI) İstifadəsi Haqqında Rəsmi Bəyannamə
**Layihə:** Urban Crisis & Crowd Evacuation Engine  
**Tarix:** 15 Noyabr 2026  
**Müsabiqə / Hackathon:** Urban Crisis & Crowd Evacuation Prototype Challenge  

---

## 1. Giriş və Məqsəd
Bu bəyannamə "Urban Crisis & Crowd Evacuation Engine" prototipinin hazırlanması prosesində istifadə edilmiş süni intellekt alətlərinin, onların tətbiq sahələrinin, istifadə olunan dəqiq sorğuların (prompt-ların) və komandanın nəzarət mexanizminin şəffaf təsvirini təmin edir.

Layihə çərçivəsində AI vasitələri insan mühəndis nəzarəti altında proqramlaşdırma köməkçisi, arxitektura konsultantı və avtomatlaşdırılmış test generatoru kimi tətbiq edilmişdir.

---

## 2. İstifadə Edilən AI Alətləri və Rolları

| AI Aləti / Platforma | Əsas Rolu | İcra Edilən Tapşırıqlar |
|---|---|---|
| **Google DeepMind Antigravity (Gemini)** | Baş Arxitektor və Planlayıcı Agent | Sistem səviyyəli Master Planın qurulması, təhlükəsizlik və DoS müdafiə planının (`SECURITY_PLAN.md`) hazırlanması, tipografiya və real xəritə inteqrasiya layihələndirilməsi, mühit/asılılıqların idarəsi və test orkestrasiyası. |
| **OpenAI Codex (VS Code Agent)** | Kod Yazarı və Test Mühəndisi | Domen məntiqinin (`engine.ts`, `commands.ts`, `store.ts`), D1 verilənlər bazası adapterinin, JWT/RBAC avtorizasiya sisteminin, 98 ədəd vahid və inteqrasiya testlərinin yazılması və refaktoring. |

---

## 3. Kodun Yazılmasında, Arxitekturada və Test Seçimində AI İstifadəsi

### A. Arxitektura və Alqoritmik Seçimlər
- **Deterministik Routing:** AI təklifləri əsasında LLM-lərin qeyri-müəyyənliyindən qaçmaq üçün fövqəladə hal marşrutlaşdırmasında klassik **Dijkstra alqoritmi** (`məsafə × congestion`) seçildi. Maneəsiz (♿) rejim üçün pilləkənli yollar istisna edildi və sürət 50 m/dəq təyin olundu.
- **Optimistik Kilidlənmə (CAS):** Çoxsaylı vətəndaşların eyni vaxtda müraciət etdiyi zaman yarış vəziyyətlərinin (race conditions) və sığınacaqların həddindən artıq dolmasının qarşısını almaq üçün **Compare-And-Swap (revision check)** modeli quruldu.
- **Token Bucket Rate-Limiting:** 500 paralel saxta SOS hücumunun qarşısını almaq üçün 3 pilləli (Vətəndaş sessiyası, IP ünvanı, Qlobal server) limit mexanizmi dizayn edildi.
- **Circuit Breaker Şablonu:** Xarici marşrut xidmətlərində yaranan gecikmələrin (503 xətası və ya 5 saniyəlik timeout) daxili sistemi dondurmaması üçün 30 saniyəlik soyuma və yarıaçıq vəziyyət dövrü tətbiq olundu.

### B. Kodlaşdırma
- Bütün kod bazası sərt tipləşdirilmiş **TypeScript** dilində yazılmışdır (`strict: true`, `noImplicitAny: true`).
- Cloudflare Workers / D1 platformasına uyğunlaşdırılmış asinxron əməliyyatlar və sessiya idarəetməsi kodlaşdırılmışdır.
- Çoxdilli dəstək (AZ / EN) və Web Speech API vasitəsilə deterministik səsli təcili çağırış modulu yaradılmışdır.

### C. Testlərin Seçimi və Əhatəliliyi
AI alətləri tərəfindən 98 fərqli sınaq ssenarisi generasiya edilmiş və icra olunmuşdur:
1. **Sərhəd Şərtləri (Boundary Conditions):** Tam 300 saniyəlik zaman pəncərəsi, tam 500 metr radius, 90% və 95% kritik doluluq hədləri.
2. **Qonşuluq və Qruplaşma Xətaları:** Tranzitiv zəncirvari saxta klasterlərin (A yaxındır B-yə, B yaxındır C-yə) qarşısının alınması.
3. **Paralelizm və Təkrarlanma:** Eyni vətəndaşın eyni anda göndərdiyi 10 dublikat QR və ya SOS sorğusunun bazada cəmi 1 dəfə artımı.
4. **Yük və DoS Testi:** Eyni anda 500 fərqli IP və kuki ilə daxil olan SOS selinin 300 ms-dən aşağı gecikmə ilə filtirlənməsi (`tests/load-sos.mjs`).

---

## 4. İstifadə Olunan Əsas Sorğular (Prompts)

Layihə boyu AI alətlərinə verilmiş faktiki və həlledici prompt-ların nümunələri:

### Prompt 1: SOS Flood və DoS Hücumundan Müdafiə
```text
"bohran zamani panika veya bot hucumu neticesinde sisteme eyni anda 500-den cox saxta sos sorgusu
(sos flood/spam attack) gonderilmesi senarisinaktivlesmisdri.
komanda sos endpointlerini rate limiting ve duplicate filterizasiyasi ile qorumali 
(saxta sorgularin dispetcer panelinin bloklanmasinin qarsisini almali), 
dispetcer panelinin kritik emeiyyatlarinin (xilas etme briqadasinin yonlendirilmesi) 
jwt / rol based access control ile tehlukesizlesdirmeli ve kutlevi sorgular zamani 
sistemin orta cavab muddetinin (latency) 300 msden asagi qalmasini temin etmelidir.
Implementation plan qur və testlərini hazırla."
```

### Prompt 2: Master Arxitektura və Genişlənmə Modulları
```text
"Urban Crisis & Crowd Evacuation Engine prototipi üçün vahid master implementasiya planı hazırla:
1. Əlçatan (♿) marşrutlaşdırma və prioritetli SOS.
2. Idempotent QR kod check-in mexanizmi (tutum aşılmasının qarşısını alan atomik CAS).
3. Sığınacaq ehtiyatlarının (su, qida, tibbi ləvazimat) monitorinqi və kritik təchizat xəbərdarlıqları.
4. Könüllülərin geo-lokasiya üzrə cəlb edilməsi və tapşırıq statusu axını.
5. PWA offline rejim, Service Worker və davamlı sorğu növbəsi (offline queue).
Bütün tələblər üçün Node.js testləri və Azərbaycan dilində interfeys təmin edilməlidir."
```

### Prompt 3: Vizual Təkmilləşdirmə və Xəritə İnterfeysi
```text
"Dashboard-da olan SVG xəritəni CartoDB Dark Matter Leaflet xəritəsi ilə əvəzləmək üçün plan hazırla.
Fontu daha müasir 'Plus Jakarta Sans' və metrikalar üçün 'JetBrains Mono' ilə əvəzlə.
SOS nöqtələrində CSS əsaslı pulsasiya edən mayaklar (radar beacons) və neon marşrut xətləri əlavə et."
```

### Prompt 4: Çoxtərəfli Agent İş Birliyi (Antigravity + Codex)
```text
"VS Code daxilində eyni vaxtda Codex agenti işləyir. Fayllarda konflikt yaranmaması üçün
bütün dəyişiklikləri cərrahi (surgical edits) üsulla apar, mövcud faylları əvvəlcədən oxu,
tam faylın üzərinə yazma və kod bazasını sinxron saxla."
```

---

## 5. İnsan Nəzarəti və Etik Öhdəliklər

1. **Deterministik İcra:** Heç bir insan həyatı və ya böhran vəziyyəti üçün kritik olan qərar (məsələn, xilasetmə briqadasının hadisə yerinə göndərilməsi, ehtiyat sığınacağın açılması) generativ süni intellektə həvalə olunmayıb. Bütün analitika riyazi düsturlar və əvvəlcədən təyin olunmuş qaydalarla icra olunur; qərar verən tərəf insan operatordur.
2. **Koda Nəzarət və Təsdiq:** AI tərəfindən generasiya edilmiş bütün kodlar:
   - TypeScript statik analizindən (`tsc --noEmit`),
   - 98 avtomatlaşdırılmış vahid və inteqrasiya testindən (`npm test`),
   - Next.js istehsalat komplyasiyasından (`npm run build`)
   tam uğurla keçmiş və komanda tərəfindən sınaqdan keçirilmişdir.
3. **Məxfilik:** Şəxsi məlumatların və istifadəçi identifikatorlarının açıqlanmaması üçün `publicState` filtri tətbiq olunmuş, vətəndaş cookie və geolokasiya məlumatları anonimləşdirilmişdir.
