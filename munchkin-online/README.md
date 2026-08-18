# Munchkin Online

Первый runnable-прототип онлайн-стола для игры в Munchkin.

## v0.2

- комнаты по 6-значному коду;
- до 6 игроков;
- уникальный playerId для каждой вкладки;
- realtime-синхронизация через WebSocket;
- переподключение WebSocket;
- сервер авторитетно проверяет ход и действия;
- игровой лог;
- чат;
- тестовые карты двери;
- health-check для деплоя;
- конфигурация Render через `render.yaml`.

## Архитектура

`server.js` — HTTP API, комнаты, игровой state и WebSocket.

`public/` — клиентский интерфейс.

Состояние комнат пока хранится в памяти процесса. Это сознательное решение для раннего MVP; позже состояние будет вынесено в устойчивое хранилище, когда появятся reconnect/resume и несколько инстансов.

## Локальный запуск

```bash
npm install
npm start
```

Откройте http://localhost:3000.

## Render

Для Render используйте Root Directory `munchkin-online`, Build Command `npm install`, Start Command `npm start`, Health Check `/api/health`.

Render может автоматически деплоить изменения из подключённой ветки GitHub. На этапе разработки основная рабочая ветка проекта — `munchkin-online`. 
