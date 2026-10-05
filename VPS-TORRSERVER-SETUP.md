# KIHEMA: сервер воспроизведения на VPS

Сайт и резолвер работают на Vercel; видео и комнаты — на VPS `93.123.84.128`.
Постоянный HTTPS-адрес: `https://video.93-123-84-128.sslip.io`.
Caddy автоматически обновляет сертификат. Старый VPS и временные туннели не используются.

## Production-переменные Vercel

```dotenv
TORRSERVER_ENABLED=true
TORRSERVER_URL=https://video.93-123-84-128.sslip.io
TORRSERVER_API_KEY=<закрытый ключ из /etc/kihema/caddy.env>
PARTY_SERVER_URL=https://video.93-123-84-128.sslip.io/party
```

При постоянном адресе TORRSERVER_DISCOVERY_URL и PARTY_DISCOVERY_URL не нужны.
После обновления переменных требуется новый deployment.
Ключ сохраняется как sensitive-переменная и передаётся только сервером в заголовке
X-Kihema-Key. В браузер и URL видео он не попадает. Пароли/ключи не храните в Git.

## Установленные службы

- kihema-torrserver: официальный TorrServer-gst MatriX.145.2, GStreamer 1.28.
- kihema-party: существующий Python-сервер комнат, websockets 15.0.1.
- caddy: HTTPS, CORS и закрытое управление API.

Службы работают от непривилегированных системных пользователей, включены в автозапуск
и автоматически перезапускаются при сбоях. Шаблоны находятся в deploy/vps/.

Внутренние порты 8090 (TorrServer) и 8092 (комнаты) слушают только 127.0.0.1.
Публичны 80/443 для HTTPS и 32000 TCP/UDP для пиров, SSH — 22.

## Файлы на VPS

```text
/opt/kihema/bin/TorrServer-gst
/var/lib/kihema/torrserver
/opt/kihema/party-server.py
/opt/kihema/venv
/etc/caddy/Caddyfile
/etc/kihema/caddy.env                  (0600, закрытый ключ)
/etc/systemd/system/caddy.service.d/kihema.conf
/etc/caddy/Caddyfile.kihema-backup     (предыдущая конфигурация)
```

## Проверка и диагностика

```bash
systemctl is-active kihema-torrserver kihema-party caddy
systemctl is-enabled kihema-torrserver kihema-party caddy
curl -fsS http://127.0.0.1:8090/echo
curl -fsS http://127.0.0.1:8090/gst/echo
journalctl -u kihema-torrserver -n 80 --no-pager
journalctl -u caddy -n 40 --no-pager
```

Проверки сайта:

```bash
node --test scripts/tests/playback-server.test.mjs
node scripts/tests/playback-smoke.mjs https://kihema.vercel.app movie 550
```

Первый тест проверяет различие 404 и 503, приватность API-ключа и переход к
следующему кандидату. Smoke-тест запускает настоящий поиск/подготовку потока
и проверяет HLS-манифест, CORS, init-файл и видеосегмент.

На VPS один CPU и 2 ГБ RAM. Кеш ограничен 256 МиБ, GStreamer — четырьмя задачами.
H.264 по возможности перепаковывается без перекодирования; другие кодеки
перекодируются быстрым пресетом. Для старта по умолчанию предпочтительны AVC
и умеренное разрешение. Наличие фильма в TMDB не гарантирует живую раздачу.

## Совместный просмотр

Откройте «Смотреть вместе» в плеере, создайте комнату и отправьте приглашение
кнопкой «Скопировать ссылку» или «Поделиться». Адрес /party/КОД открывает
страницу входа с именем зрителя. Поле входа в плеере принимает и код, и ссылку;
старые приглашения с ?room=КОД также поддерживаются.

Сервер комнат хранит общий таймер и скорость, а клиенты отправляют команды
только от явных действий пользователя. Загрузка HLS не рассылает ложные паузы.
Поздний вход и смена источника ждут готовности зрителей перед общим отсчётом.
Небольшое отставание устраняется корректировкой скорости; крупное — перемоткой.
Временный разрыв соединения сохраняет участника и роль ведущего (12 секунд
до передачи роли), обновление страницы использует приватный токен в sessionStorage.
Если браузер запрещает автозапуск, зритель должен нажать кнопку на видео.

```bash
python scripts/tests/party-server.test.py
node --test scripts/tests/party-sync.test.mjs
node scripts/tests/browser-party.mjs https://kihema.vercel.app
```

После обновления процесса комнат активные комнаты нужно создать заново.
