# Настройка TorrServer на VPS (IP: 213.165.34.107)

## Шаг 1: Подключение к VPS

```bash
ssh root@213.165.34.107
# Пароль: YS7KX5d91uKt
```

## Шаг 2: Проверка и запуск TorrServer

### Вариант A: Если TorrServer уже установлен

```bash
# Проверить статус
systemctl status torrserver-gst

# Запустить если остановлен
systemctl start torrserver-gst

# Включить автозагрузку
systemctl enable torrserver-gst

# Открыть порт в firewall
ufw allow 8080/tcp

# Проверить что работает
curl http://127.0.0.1:8080/status
```

### Вариант B: Установка TorrServer с нуля

Вам нужно скачать и установить **TorrServer MatriX.143**:

**Способ 1 - Прямой запуск:**
```bash
cd /opt
wget https://github.com/MatriX.143/TorrentStream/releases/latest/download/TorrServer-Matrix.143-gst.tar.gz
tar -xzf TorrServer-Matrix.143-gst.tar.gz
chmod +x TorrServer-Matrix.143-gst

# Запуск в фоне
./TorrServer-Matrix.143-gst --listen 0.0.0.0:8080 &
```

**Способ 2 - Docker:**
```bash
docker run -d \
  --name torrserver \
  --restart always \
  -p 8080:8080 \
  matrixtv/torrservice:gst
```

## Шаг 3: Настройка cloudflared tunnel (для публичного доступа)

Если хотите доступ через HTTPS без открытия портов:

```bash
# Установка cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
dpkg -i cloudflared.deb

# Авторизация (откроет браузер)
cloudflared tunnel login

# Создание туннеля
cloudflared tunnel create kiema-torr

# Автоматическое создание временного URL (самый простой способ)
cloudflared tunnel --url my-torrserver-kiema

# ВАЖНО: Скопируйте URL который выведется! Например:
# https://my-torrserver-kiema-abcd1234.trycloudflare.com
```

**Сохраните этот URL!** Вам понадобится для шага 4.

## Шаг 4: Настройка переменных окружения в Vercel

1. Зайдите на [Vercel Dashboard](https://vercel.com/dashboard)
2. Проект: KIHEMA
3. Settings → Environment Variables
4. Добавьте новую переменную:

```
NAME: TORRSERVER_URL
VALUE: https://ваш-url-cloudflared.trycloudflare.com
```

Или если используете прямой IP:

```
NAME: TORRSERVER_URL
VALUE: http://213.165.34.107:8080
```

5. Нажмите "Save"

## Шаг 5: Тестирование

После деплоя на Vercel протестируйте:

```bash
# С SSH на VPS
curl -X POST "http://127.0.0.1:8080/torrents" \
  -H "Content-Type: application/json" \
  -d '{"action":"add","link":"magnet:?xt=urn:btih:EXAMPLE&dn=test","title":"test"}'

# Ответ должен быть: {"hash":"abc123..."} или {"error":"..."}
```

## Решение проблем

### Проблемы с подключением из Vercel

Если видите ошибку `fetch failed`:

1. Проверьте что cloudflared запущен:
   ```bash
   ps aux | grep cloudflared
   ```

2. Перезапустите туннель:
   ```bash
   pkill cloudflared
   cloudflared tunnel --url my-torrserver-kiema
   ```

3. Убедитесь что порт 8080 открыт:
   ```bash
   ufw status
   # Должен быть: 8080 ALLOW
   ```

### Торренты не находятся

Если торренты не находятся при поиске:
- Увеличьте время ожидания в коде (сейчас стоит 120 секунд)
- Проверьте логи на Vercel: последние Deployments → Logs

## Итоговая конфигурация

После настройки у вас должно быть:
- ✅ TorrServer запущен на VPS (порт 8080)
- ✅ cloudflared tunnel активен
- ✅ Переменная `TORRSERVER_URL` в Vercel настроена
- ✅ Деплой на Vercel завершён успешно

Проверьте сайт — торренты должны работать! 🎉
