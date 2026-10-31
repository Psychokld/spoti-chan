# Spoti-Chan: развёртывание на виртуальной машине (IaaS)

Эта инструкция описывает **Google Cloud Compute Engine VM**: мы управляем Ubuntu,
Docker, сетью, диском и процессами приложения. Это вариант IaaS. Firebase Hosting,
Vercel и Cloud Run сами по себе не доказывают выполнение требования IaaS.

**Статус:** конфигурация подготовлена в репозитории. Создание облачных ресурсов и
публикация приложения в аккаунте пользователя не выполнялись. Для этого нужны
Google Cloud project с подключённым billing, разрешения на Compute Engine/IAP,
DNS-домен, настройки почты и ключи внешних музыкальных/ИИ-сервисов. Бесплатность
ресурсов не предполагается; расходы и квоты проверяются в выбранном проекте.

## 1. Состав размещения

```text
Браузер → DNS → внешний IP VM → Caddy :443 (HTTPS) → Express :3001
                                                        ↓
                                    Docker volume app_data (SQLite)
                                                        ↓
                                   SMTP / Gemini / Jamendo по HTTPS
```

- `Dockerfile`: Node.js 24, отдельная сборка React/Vite и runtime с production-
  зависимостями; процесс приложения запускается пользователем `node`, а не root.
- `deploy/compose.yaml`: приложение и Caddy. Порт API не публикуется на хосте.
  Только reverse proxy принимает 80/443. Данные приложения находятся в named
  volume `spoti-chan_app_data`, сертификаты Caddy — в собственных volumes.
- `deploy/Caddyfile`: reverse proxy и автоматический HTTPS для указанного домена.
- `deploy/gcp/create-vm.sh`: создаёт сеть, подсеть, firewall, статический IP и VM.
- `deploy/gcp/startup.sh`: устанавливает Docker из официального репозитория и
  клонирует код; не запускает приложение до настройки секретов.

Одна VM и одна SQLite-база подходят для учебного проекта. Автоматический failover,
масштабирование на несколько пишущих реплик и резервное копирование в облако здесь
не настроены. Для такого масштаба потребуется отдельная СУБД и дополнительная
конфигурация инфраструктуры.

## 2. Подготовка и создание VM

Команды ниже выполняет владелец проекта в **Google Cloud Shell или Bash с gcloud**.
Не вставляйте их как PowerShell-синтаксис. Скрипт создания намеренно прекращает
работу, если ресурс с таким именем уже существует: после частичного сбоя сначала
проверьте, какие ресурсы созданы, затем продолжайте нужный шаг вручную. Повторная
запуск без проверки не является способом обновления VM.

1. Создайте/выберите проект Google Cloud и подключите billing. Проверьте квоту на
   VM, внешний IP и постоянный диск. Учётной записи нужны права для создания этих
   ресурсов; для SSH через IAP — роли `roles/iap.tunnelResourceAccessor` и
   `roles/compute.osAdminLogin` (либо эквивалентные разрешения владельца).
2. Склонируйте репозиторий в Cloud Shell и выберите нужный коммит:

   ```sh
   git clone https://github.com/Psychokld/spoti-chan.git
   cd spoti-chan
   git log -1 --oneline
   ```

3. Укажите свой project ID и согласованные region/zone. Скрипт создаёт платные
   ресурсы, поэтому запускайте его только после проверки этих параметров:

   ```sh
   export GCP_PROJECT='YOUR_PROJECT_ID'
   export GCP_REGION='europe-west3'
   export GCP_ZONE='europe-west3-a'
   export VM_NAME='spoti-chan'
   bash deploy/gcp/create-vm.sh
   ```

   По умолчанию используется Ubuntu 24.04 LTS, `e2-small` и диск 20 ГБ. Скрипт
   открывает web-порты 80/443; SSH 22 разрешён только из диапазона IAP. У VM нет
   привязанного service account, поскольку приложению не нужен доступ к GCP API.
   Секреты не передаются через instance metadata.

4. Добавьте DNS **A record** своего домена на IP, напечатанный скриптом. Не
   создавайте AAAA record, если IPv6 на этой VM не настроен. Дождитесь, когда DNS
   начнёт разрешаться в правильный адрес.
5. Подключитесь к VM:

   ```sh
   gcloud compute ssh "$VM_NAME" --project="$GCP_PROJECT" \
     --zone="$GCP_ZONE" --tunnel-through-iap
   ```

   Если установка ещё идёт, проверьте её журнал:

   ```sh
   sudo journalctl -u google-startup-scripts.service --no-pager -n 80
   sudo docker compose version
   ```

## 3. Настройка приложения и HTTPS

На VM выполните:

```sh
sudo -i
cd /opt/spoti-chan
git log -1 --oneline
umask 077
cp .env.example .env
chmod 600 .env
```

Отредактируйте `.env` локальным редактором на VM. Не отправляйте заполненный файл
в Git, чат или публичные скриншоты. Минимальные production-параметры:

| Переменная | Значение |
| --- | --- |
| `NODE_ENV` | `production` (также задано в Compose) |
| `DOMAIN` | Ваш DNS hostname, например `music.example.com`, без схемы/пути |
| `APP_URL` | Точно `https://` + тот же hostname, без завершающего `/` |
| `JWT_SECRET` | Случайный секрет от 32 символов; не пароль пользователя |
| `DATA_ENCRYPTION_KEY` | Отдельный ключ шифрования 2FA: ровно 64 hex-символа (32 байта) |
| `SQLITE_PATH` | `/app/data/spoti-chan.sqlite` (принудительно задано Compose) |
| `DATA_DIR` | `/app/data` (принудительно задано Compose; writable volume для runtime-данных) |
| `SMTP_HOST`, `SMTP_PORT` | Сервер и порт вашего почтового провайдера |
| `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Учётные данные отправителя и адрес From |
| `GEMINI_API_KEY` | Ключ Gemini, если нужен реальный ИИ-подбор |
| `JAMENDO_CLIENT_ID` | Client ID Jamendo, если нужен внешний музыкальный каталог |

Не используйте обычный пароль Google-аккаунта в `SMTP_PASS`. Если отправитель —
Gmail, настройте разрешённый Google способ SMTP-аутентификации; для режима app
password требуется соответствующая настройка аккаунта. Ограничения Gmail и
политика организации могут не позволять этот режим. В production подтверждение
почты должно доставляться получателю, а не оставаться в локальном dev-outbox.

Секреты можно сгенерировать на VM без установки Node.js на хост:

```sh
docker run --rm node:24-bookworm-slim node -e \
  "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
docker run --rm node:24-bookworm-slim node -e \
  "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Первый результат предназначен для `JWT_SECRET`, второй — для
`DATA_ENCRYPTION_KEY`. Сохраните их в `.env`, не в
командной строке Docker. Не меняйте ключ шифрования после подключения 2FA без
процедуры миграции: прежние секреты 2FA не получится расшифровать новым ключом.

Проверьте обязательные параметры и запустите сервисы:

```sh
docker compose --env-file .env -f deploy/compose.yaml config --quiet
docker compose --env-file .env -f deploy/compose.yaml up -d --build
docker compose --env-file .env -f deploy/compose.yaml ps
docker compose --env-file .env -f deploy/compose.yaml logs --tail=50 app caddy
```

Caddy получает сертификат после доступности домена и web-портов. Сначала откройте
`https://YOUR_DOMAIN/api/health`, затем корень сайта. Установленные secure cookies
требуют HTTPS: обычный HTTP по IP не является production-адресом для входа.
Firewall не должен публиковать порт 3001.

Не запускайте `docker compose config` без `--quiet` для публикации результата:
развёрнутая конфигурация может содержать секреты из `.env`. В журналах и
скриншотах также проверяйте отсутствие email-токенов и кодов 2FA.

## 4. Что предъявить при сдаче требования IaaS

Наличие этих файлов в GitHub доказывает подготовку конфигурации, но **не факт
облачного размещения**. После настоящего запуска зафиксируйте:

1. VM в Compute Engine: имя, zone, состояние Running, привязанный внешний IP.
2. DNS-домен и доступный HTTPS URL приложения, совпадающий с `APP_URL`.
3. Ответ `GET /api/health` и работающие контейнеры `app`/`caddy`.
4. Сквозной сценарий: регистрация → письмо реальному получателю → активация →
   вход → изменение профиля → настройка 2FA → повторный вход с кодом.
5. Сохранение пользователя после `docker compose restart app`, что проверяет
   постоянный том базы данных.
6. Номер коммита с исходниками, из которого построен контейнер.

Пароли, JWT, recovery codes, секрет TOTP, SMTP-ключи и значения `.env` в отчёт не
включаются. Реальное выполнение каждого сценария отмечается только после
проверки. Настоящее облачное развёртывание и доставка SMTP из этой VM остаются
непроверенными до предоставления аккаунта/настроек и запуска владельцем.

## 5. Обновление, данные и остановка

Обновление на VM из папки `/opt/spoti-chan`:

```sh
git pull --ff-only
docker compose --env-file .env -f deploy/compose.yaml up -d --build
docker compose --env-file .env -f deploy/compose.yaml ps
```

SQLite хранится вне контейнера. Обычные `restart`, пересборка образа и `down` без
`--volumes` сохраняют named volumes. **`down --volumes` удаляет данные и
сертификаты** — не используйте его как способ обновления.

Перед значимым обновлением создайте локальную резервную копию при остановленном
приложении, чтобы база и WAL-файлы соответствовали друг другу:

```sh
mkdir -p backups
chmod 700 backups
docker compose --env-file .env -f deploy/compose.yaml stop app
docker run --rm -v spoti-chan_app_data:/data:ro -v "$PWD/backups":/backup \
  busybox:1.37 tar czf "/backup/app-data-$(date -u +%Y%m%dT%H%M%SZ).tgz" -C /data .
docker compose --env-file .env -f deploy/compose.yaml start app
```

Резервная копия содержит пользовательские данные; храните её с ограниченным
доступом отдельно от VM. Сохраните ключ шифрования отдельно безопасным способом,
иначе восстановленная база с 2FA будет неполной. Автоматическое внешнее резервное
копирование и процедура тестового восстановления ещё требуют настройки.

Для завершения учебного размещения сначала сохраните нужные данные, затем
удалите через Google Cloud созданные этим проектом VM, постоянный диск, IP и
сетевые ресурсы. Выключение приложения или VM не гарантирует прекращение всех
расходов: отдельно проверьте оставшиеся ресурсы и billing. Скрипта автоматического
удаления нет, чтобы случайный запуск не уничтожил базу.

## Официальные материалы

- [Контейнеры на VM Compute Engine](https://docs.cloud.google.com/compute/docs/containers/deploying-containers)
- [Startup scripts Linux VM](https://docs.cloud.google.com/compute/docs/instances/startup-scripts/linux)
- [SSH через IAP и правила доступа](https://docs.cloud.google.com/iap/docs/using-tcp-forwarding)
- [Установка Docker Engine на Ubuntu](https://docs.docker.com/engine/install/ubuntu/)
- [Официальный образ Node.js](https://hub.docker.com/_/node)
- [Caddy: автоматический HTTPS](https://caddyserver.com/docs/automatic-https)
- [Caddy: reverse proxy](https://caddyserver.com/docs/quick-starts/reverse-proxy)
