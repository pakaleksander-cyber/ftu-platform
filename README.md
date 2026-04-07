# Платформа Финтех Юнит — Инструкция по развёртыванию

## Что нужно установить (один раз)

### 1. Node.js
Скачайте и установите: https://nodejs.org (нажмите кнопку LTS)
После установки откройте терминал (командную строку) и проверьте:
```
node --version
```
Должно показать что-то вроде `v20.x.x`

### 2. Git
Скачайте и установите: https://git-scm.com
Проверьте:
```
git --version
```

---

## Как развернуть проект

### Шаг 1. Распакуйте архив
Распакуйте `ftu-platform.zip` в любую папку на компьютере.

### Шаг 2. Откройте терминал в папке проекта
- Windows: откройте папку `ftu-platform`, кликните правой кнопкой → «Открыть в терминале»
- Mac: откройте Terminal, напишите `cd ` (с пробелом), перетащите папку в окно, нажмите Enter

### Шаг 3. Установите зависимости
```
npm install
```
Подождите 1-2 минуты, пока скачаются библиотеки.

### Шаг 4. Проверьте локально
```
npm run dev
```
Откройте в браузере адрес, который покажет терминал (обычно http://localhost:5173).
Проверьте, что всё работает: логин, загрузка файлов, скачивание документов.

### Шаг 5. Соберите для продакшна
```
npm run build
```
Появится папка `dist/` — это готовый сайт.

---

## Как выложить на GitHub Pages (бесплатно)

### Шаг 1. Создайте аккаунт на GitHub
Зайдите на https://github.com и зарегистрируйтесь (если ещё нет аккаунта).

### Шаг 2. Создайте репозиторий
- Нажмите «+» → «New repository»
- Название: `ftu-platform`
- Тип: Public
- Нажмите «Create repository»

### Шаг 3. Залейте проект
В терминале (в папке проекта):
```
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/ВАШЕ_ИМЯ/ftu-platform.git
git push -u origin main
```
Замените `ВАШЕ_ИМЯ` на ваш логин на GitHub.

### Шаг 4. Включите GitHub Pages
- Зайдите в настройки репозитория (Settings)
- Слева: Pages
- Source: «GitHub Actions»
- Создайте файл `.github/workflows/deploy.yml` (содержимое ниже)

### Шаг 5. Создайте файл деплоя
Создайте папку `.github/workflows/` в корне проекта и файл `deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

### Шаг 6. Запушьте и ждите
```
git add .
git commit -m "Add deploy workflow"
git push
```

Через 2-3 минуты сайт будет доступен по адресу:
`https://ВАШЕ_ИМЯ.github.io/ftu-platform/`

---

## Как подключить свой домен (опционально)

1. Купите домен (например, на reg.ru)
2. В DNS-настройках домена добавьте CNAME запись:
   - Имя: `platform` (или `@` для корня)
   - Значение: `ВАШЕ_ИМЯ.github.io`
3. В настройках GitHub Pages (Settings → Pages) впишите свой домен
4. Через 10-30 минут сайт будет доступен по вашему домену

---

## Как вносить изменения

1. Отредактируйте файл `src/App.jsx` в любом редакторе
2. Проверьте локально: `npm run dev`
3. Залейте на GitHub:
```
git add .
git commit -m "Описание изменения"
git push
```
Через 2-3 минуты изменения появятся на сайте.

---

## Учётные записи по умолчанию

| Роль | Логин | Пароль |
|------|-------|--------|
| Администратор | admin | admin123 |
| Исполнитель | executor | exec123 |
| Заказчик | client | client123 |

Пароли можно увидеть и изменить в админке (Пользователи).
