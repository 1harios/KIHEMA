#!/bin/bash
# ===========================================
# Настройка TorrServer на VPS с облачным доступом
# ===========================================

echo "=========================================="
echo "Установка TorrServer с cloudflared tunnel"
echo "=========================================="

# Проверка текущих сервисов
echo "Проверка TorrServer..."
if systemctl list-units --type=service | grep -q torrserver; then
    echo "✓ TorrServer уже установлен"
else
    echo "Торрент-сервис НЕ обнаружен"
    echo ""
    echo "Вам нужно установить TorrServer MatriX.143 вручную:"
    echo "1. Скачайте из https://github.com/MatriX.143/TorrentStream"
    echo "2. Запустите: ./TorrServer-Matrix.143-gst --listen 0.0.0.0:8080"
    echo "3. Или используйте docker (если поддерживается)"
    exit 1
fi

# Проверка cloudflared
echo ""
echo "Проверка cloudflared..."
if command -v cloudflared &> /dev/null; then
    echo "✓ Cloudflared уже установлен"
else
    echo "Установка cloudflared..."
    if [ -f "/tmp/cloudflared-linux-amd64.deb" ]; then
        dpkg -i /tmp/cloudflared-linux-amd64.deb
    else
        curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared-linux-amd64.deb
        dpkg -i /tmp/cloudflared-linux-amd64.deb
    fi
fi

# Создание туннеля
echo ""
echo "Настройка туннеля..."
cd /root
mkdir -p .cloudflared

# Генерация UUID туннеля
TUNNEL_UUID=$(cat /proc/sys/kernel/random/uuid)
TUNNEL_NAME="kiema-torr-${TUNNEL_UUID}"

echo "Создаём конфиг туннеля..."
cat > /root/.cloudflared/config.yml << OEOF
tunnel: ${TUNNEL_NAME}
credentials-file: /root/.cloudflared/credential.json

ingress:
  - hostname: your-domain.com
    service: http://127.0.0.1:8080
  - service: http_status:404
OEOF

echo ""
echo "=== ВАЖНО ==="
echo "Для запуска туннеля в режиме без привязки домена (temporary URL):"
echo ""
echo "1. Авторизация в cloudflared:"
echo "   cloudflared tunnel login"
echo ""
echo "2. Создание туннеля:"
echo "   cloudflared tunnel create kiema-torr"
echo ""
echo "3. Обновление конфига после создания:"
echo "   cloudflared config update --url kiema-torr"
echo ""
echo "4. Запуск туннеля:"
echo "   cloudflared tunnel run kiema-torr"
echo ""
echo "5. Выведется временный URL вида:"
echo "   https://random-name.trycloudflare.com"
echo ""
echo "Этот URL нужно добавить в Vercel как переменную окружения:"
echo "  NAME: TORRSERVER_URL"
echo "  VALUE: <URL из шага 5>"
echo "=========================================="

# Автоматическая попытка создания временного туннеля
echo ""
echo "Попробую создать временный туннель через cloudflared..."
cloudflared tunnel --url kiema-temp-tunnel 2>&1 &
CLOUDFLARED_PID=$!

echo "PID туннеля: $CLOUDFLARED_PID"
echo "Ожидание подключения туннеля (20 секунд)..."
sleep 20

# Проверка есть ли вывод туннеля
if pgrep -f "cloudflared.*--url" > /dev/null; then
    echo "Cloudflared запущен, но требует авторизации"
    echo "Выполните: cloudflared tunnel login"
else
    echo "Туннель не запущен - требуется ручная настройка"
fi

kill $CLOUDFLARED_PID 2>/dev/null || true

echo ""
echo "Далее нужно настроить firewall на VPS:"
echo "sudo ufw allow 8080/tcp"
echo ""
echo "И добавить переменную окружения в Vercel Dashboard:"
echo "https://vercel.com/dashboard/kihema/settings/environment-variables"
echo ""
echo "Переменная:"
echo "  NAME: TORRSERVER_URL"
echo "  VALUE: <ваш-url-из-cloudflared>"
echo ""
echo "=========================================="
