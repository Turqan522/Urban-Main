# 3 dəqiqəlik demo və müdafiə

Əvvəl: `npm run build`, `npm run setup:local`, `npm start -- --port 4173`. Vətəndaş və operator üçün ayrı brauzer profilləri açın; eyni profildəki vərəqlər bir vətəndaş sessiyasını paylaşır. Demo Lab → İlkin vəziyyət. Mikrofon dəstəyini əvvəlcədən yoxlayın; dəstək yoxdursa bir klik SOS istifadə edin.

| Vaxt | Hərəkət və izah |
|---|---|
| 0:00–0:30 | “Urban Crisis şəhər təxliyəsinin iki modullu simulyasiyasıdır.” Dispetçer/vətəndaş rejimlərini və AZ → EN → AZ keçidini göstərin. |
| 0:30–1:15 | Vətəndaşda ♿ rejimini aktiv edin. Yalnız maneəsiz yol və sığınacaqlar, 50 m/dəq hesabı. Mikrofonla “Yanğın” deyin və ya Yanğın seçib SOS göndər düyməsini basın. Dispetçer lentində prioritet 1 görünür. |
| 1:15–1:50 | Demo Lab → 5 SOS yarat. Qırmızı banneri göstərin. “Təsdiqlə və icra et”: yaxın briqada, yaşıl marşrut, ETA, hərəkət simulyasiyası və varsa ehtiyat məntəqə açılır. |
| 1:50–2:25 | Vətəndaş → QR ilə çatma qeydiyyatı → məntəqə simulyasiyası. Doluluq +1, öz SOS-u safe. Yenidən oxutma: doluluq dəyişmir. Bütün təyin edilmiş vətəndaşlar təhlükəsizdirsə briqada buraxılır. |
| 2:25–3:00 | Analitika qaydaları: radius/zaman/say/faizləri dəyişin. Növbə və offline shell-i izah edin. Avtomatik və yerli API sınaqlarının nəticəsini `TEST_REPORT.md`-dən oxuyun. |

## Əlavə modulların demosu

1. Demo Lab → **503 xəta sınağı**: sarı ehtiyat marşrut banneri və daxili qraf yolu görünür. 30 saniyədən sonra yarıaçıq yoxlama ilə normal marşrut bərpa olur. `timeout` düyməsi 5 saniyəlik gecikməni ayrıca göstərir.
2. Demo Lab → **Su ehtiyatını azalt**: Mərkəzi Parkın suyu 12%-ə düşür, narıncı xəbərdarlıq yaranır və məntəqə marşrutlardan çıxır. Dispetçer “Təchizat karvanı göndər” basanda bütün ehtiyatlar 100% olur.
3. Demo Lab → **Briqadalar məşğul · tibbi SOS**: bu ssenari əvvəlki demonu sıfırlayır. Vətəndaş rejimində tibbi SOS yaxınlığında könüllü qeydiyyatı edin; dispetçerdə təsdiqləyin; vətəndaş “Mən hazıram” seçsin. Dispetçer tövsiyə olunan könüllünü səfərbər etsin. Vətəndaş dəvəti qəbul edib “yolda” → “hadisə yerində” → “tamamlandı” addımlarını keçsin. Tibbi SOS aktiv qalır.
4. Demo Lab → **Marşrutu bağla** və ya klasteri təsdiqlə: `GET /api/news` və ekrandakı yerli xəbərlər panelində həmin əraziyə aid xəbər görünür.

## Offline əlavəsi (əsas demodan ayrıca)

Production səhifəsini online açın. Şəbəkəni söndürün, səhifəni yeniləyin; son məlumatın köhnə olduğunu göstərən banner qalmalıdır. Yeni SOS göndərin: server uğuru əvəzinə növbə görünür. Şəbəkəni açın: tətbiq açıqkən sırayla göndərilir. Səhv QR kimi rədd olunan sorğu görünən xəta ilə növbədə qalır; retry və ya silmə mövcuddur.

## Müdafiə sualları

- **Niyə Dijkstra?** Yol çəkisi məsafə × sıxlıqdır; bağlı və əlçatan olmayan kənarlar filtrdən çıxır. Marşrutlar tutum həddini də nəzərə alır.
- **Niyə 90 və 95 ayrıdır?** 90%-də yeni axını yönləndiririk, 95%-i keçdikdə ayrıca kritik tutum qərarı veririk.
- **Təkrar nə olur?** Sessiya üzrə bir aktiv SOS, unikal requestId qəbzi və bir check-in qeydi var.
- **Paralel yazı necə qorunur?** Port/adapter sərhədində reviziya CAS; konfliktə düşən sorğu təzə state oxuyub əmri yenidən hesablayır.
- **AI qərar verir?** Xeyr. Böhran qaydaları deterministikdir. Web Speech brauzerin səs tanımasıdır; LLM dispetçer qərarı vermir.
- **Real xidmətə hazırdır?** Xeyr. Xəritə, tutum, briqada hərəkəti və ETA simulyasiyadır. Operator/admin rolları demo üçün mövcuddur; ayrıca istifadəçi hesabları, MFA və real xidmət/GPS inteqrasiyası yoxdur.

Bu ssenari hazırlanmış demo təlimatıdır; bu sessiyada canlı brauzer təqdimatının aparıldığı iddia edilmir.

## Tam demo üçün diqqət ediləcək şərtlər

- Əvvəl Demo Lab → İlkin vəziyyət seçin. Bu əməliyyat paylaşılan demo məlumatlarını sıfırlayır.
- Vətəndaş profili: Sahil · Nizami küçəsini seçin, yanğını seçib SOS göndərin. Göstərilən qəbul statusu real xidmət çağırışı deyil.
- Operator profili: 5 SOS ssenarisini işə salın, klasteri təsdiqləyin. Vətəndaşın SOS-u klasterə daxil olarsa təyin edilmiş briqada statusunu göstərin.
- Yolun bağlanmasını göstərmək üçün əvvəl və sonra tövsiyə edilən yolu müqayisə edin. Yol bağlanması hər vəziyyətdə alternativ yol olacağına zəmanət vermir.
- Vətəndaş təhlükəsiz olduğunu bildirsin; operator hadisə lentini yenidən yoxlasın. Demo vaxtında klaster pəncərəsi bitərsə sıfırlayıb yenidən yaradın.
- Offline nümayişi ayrıca edin: SOS yalnız cihazdakı növbədə qalır və tətbiq açıqkən bağlantı qayıtdıqda göndərilir.
