#!/bin/bash
# Автоматическая настройка TorrServer на VPS (IP: 213.165.34.107)
# Выполняйте эту команду после SSH входа в VPS

echo "======================================"
echo "Автоматическая настройка TorrServer"
echo "VPS: 213.165.34.107"
echo "======================================"

# Переменные окружения
VPS_IP="213.165.34.107"

# Шаг 1: Установка cloudflared
echo ""
echo "Шаг 1: Установка cloudflared..."
if command -v cloudflared &> /dev/null; then
    echo "✓ Cloudflared уже установлен"
else
    curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cloudflared.deb
    dpkg -i cloudflared.deb
    rm cloudflared.deb
    echo "✓ Cloudflared установлен"
fi

# Шаг 2: Проверка TorrServer
echo ""
echo "Шаг 2: Проверка TorrServer..."
if pgrep -f "TorrServer|torrservice" > /dev/null; then
    echo "✓ TorrServer запущен"
else
    echo "⚠ TorrServer НЕ запущен"
    echo ""
    echo "Сейчас попробую найти и запустить TorrServer..."
    
    # Поиск исполняемого файла
    TORR_PATH=$(find /opt /root /home -name "TorrServer*" -type f -executable 2>/dev/null | head -1)
    
    if [ -z "$TORR_PATH" ]; then
        echo ""
        echo "❌ TorrServer НЕ НАЙДЕН!"
        echo ""
        echo "Вам нужно установить его вручную:"
        echo "1. Скачайте с: https://github.com/MatriX.143/TorrentStream"
        echo "2. Разархивируйте в /opt/torrserver"
        echo "3. Запустите: cd /opt/torrserver && ./TorrServer-Matrix.143-gst --listen 0.0.0.0:8080 &"
        exit 1
    else
        echo "Найден: $TORR_PATH"
        echo "Запуск в фоне..."
        nohup $TORR_PATH --listen 0.0.0.0:8080 > /tmp/torrserver.log 2>&1 &
        sleep 2
        if pgrep -f "TorrServer" > /dev/null; then
            echo "✓ TorrServer запущен успешно"
        else
            echo "❌ Не удалось запустить TorrServer"
            cat /tmp/torrserver.log
            exit 1
        fi
    fi
fi

# Шаг 3: Открытие порта в firewall
echo ""
echo "Шаг 3: Открытие порта 8080..."
ufw allow 8080/tcp 2>/dev/null || true
echo "✓ Порт 8080 открыт"

# Шаг 4: Запуск cloudflared туннеля
echo ""
echo "Шаг 4: Запуск облачного туннеля..."

# Останавливаем предыдущие туннели
pkill cloudflared 2>/dev/null || true
sleep 1

echo "Запускаю temporary туннель cloudflared..."
echo ""
echo "⚠ ВАЖНО: Туннель потребует авторизацию Cloudflare"
echo ""
echo "Если появится запрос 'cloudflared tunnel login', нажмите Ctrl+C,"
echo "выполните: cloudflared tunnel login"
echo "Затем запустите этот скрипт снова."
echo ""

# Выводим временный URL и ждем
cloudflared tunnel --url kiema-torrserver-$(date +%s) 2>&1 | while read line; do
    echo "$line"
    
    # Ищем URL в выводе
    if [[ "$line" == *"https://"*".trycloudflare.com"* ]]; then
        echo ""
        echo "=========================================="
        echo "✅ ТАУННЕЛЬ УСПЕШНО СОЗДАН!"
        echo "=========================================="
        echo ""
        echo "ВАШ URL ДЛЯ VERCEL:"
        echo "      $(echo $line | grep -oE 'https://[^ ]+\.trycloudflare\.com')"
        echo ""
        echo "=========================================="
        
        # Сохраняем URL в файл
        echo $(echo $line | grep -oE 'https://[^ ]+\.trycloudflare\.com') > /tmp/torrserver_url.txt
        
        # Выход с кодом успеха
        exit 0
    fi
done

URL_EXIT_CODE=$?

# Если туннель прервался, выводим инструкцию
if [ $URL_EXIT_CODE -ne 0 ]; then
    echo ""
    echo "⚠ Туннель прерван или требует настройки"
    echo ""
    echo "Для ручной настройки выполните:"
    echo "  cloudflared tunnel login"
    echo "  cloudflared tunnel create kiema-torr"
    echo "  cloudflared config update --url kiema-torr"
    echo "  cloudflared tunnel run kiema-torr"
    echo ""
    echo "ИЛИ используйте temporary режим:"
    echo "  cloudflared tunnel --url my-service-name"
fi

exit 1
