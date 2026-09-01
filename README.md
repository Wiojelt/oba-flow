![ÖBA Flow banner](assets/banner.svg)

# ÖBA Flow

ÖBA içeriklerinde görünen **Kursu Başlat** / **Başlamak için tıklayınız** düğmelerini ve video sonunda etkinleşen **İLERİ** düğmesini kullanır. Mevcut içerik `check_circle` ile tamamlandığında listedeki hemen sonraki kilidi açılmış içeriğe geçebilir.

SCORM oynatıcısının yalnızca gerçek girdiyi kabul eden başlangıç katmanı bulunur ve alt çerçevedeki hedef noktası ana sayfaya çevrilir. Önce fare, gerekirse dokunma ve klavye girdisi kullanılır. Bu işlem sırasında aynı sekmede DevTools açık olmamalıdır.

Chrome/Brave, gerçek girdi gönderilirken kısa süreli bir hata ayıklama bildirimi gösterebilir. Bağlantı işlem tamamlanınca otomatik olarak kapatılır; kalıcı değildir.

## Kurulum

1. ZIP'i bir klasöre çıkarın.
2. Brave'de `brave://extensions`, Chrome'da `chrome://extensions` sayfasını açın.
3. **Geliştirici modu**nu etkinleştirin.
4. **Paketlenmemiş öğe yükle** ile klasörü seçin.
5. ÖBA sayfasını yenileyin.

Popup üzerinden otomatik ileri ve içerik geçişi ayrı ayrı kapatılabilir. İki uçlu çubukla 0–10 saniye arasında bir tıklama aralığı seçilir; her işlem bu aralıktan yeni bir gecikme kullanır.

## Sınırlar

- İçeriği ileri sarmaz veya tamamlanmamış içeriği tamamlanmış göstermez.
- Yalnızca mevcut öğe `check_circle` olduğunda sıradaki kilidi açılmış öğeye geçer; son öğede durur.
- Sekme görünürlüğünü ya da tarayıcı odak durumunu taklit etmez.
- `Tamamla` veya `Bitir` düğmelerine basmaz.

Erişim ve iletişim: [Twitter @wiojelt](https://twitter.com/wiojelt) · [GitHub @Wiojelt](https://github.com/Wiojelt)

Copyright © 2026 wiojelt. All rights reserved.
