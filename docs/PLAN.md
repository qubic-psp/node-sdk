# План реализации node-sdk

npm-пакет `@qubiq/psp-sdk` — SDK для бекенда мерчанта: подписанные запросы к `/api/v1` gateway, инвойсы, настройки вебхука и журнал доставок, проверка подписи вебхуков. Каждая стадия заканчивается проверкой (`yarn ci`) и коммитом в `dev`; этот файл обновляется в том же коммите.

Легенда: `[x]` — сделано, `[~]` — в работе, `[ ]` — не начато.

## Источники требований

- подпись запросов, методы, повторы и ошибки — gateway [`docs/13-merchant-api.md`](../../gateway/docs/13-merchant-api.md): 13.2 подпись, 13.5 векторы, 13.10 повторы, 13.14 ошибки;
- методы и схемы — [`api/openapi.v1.json`](../api/openapi.v1.json), копия `gateway/docs/openapi.public.json` (`yarn api:sync`);
- формат, подпись и доставка вебхуков — webhook-service [`docs/13-merchant-webhooks.md`](../../webhook-service/docs/13-merchant-webhooks.md): 13.3 события, 13.6 подпись и векторы, 13.8 повторы;
- готовый код для переноса — `merchant-test-ui/src/server/signer.ts` и `webhook-verify.ts`.

## Правила

- Рантайм без зависимостей: глобальный `fetch` и `node:crypto`, Node ≥ 18. Сборка ESM + CJS (tsup).
- Всё строго типизировано: публичные типы пишутся вручную с JSDoc на английском, их совпадение со схемами OpenAPI проверяет `yarn typecheck`.
- Документация для мерчанта — README на английском.
- Тяжёлые прогоны — через `psp/.claude/heavy.sh`, vitest — не больше 2 воркеров.
- Push — пачками (origin `git@qubic-psp:qubic-psp/node-sdk.git` создаёт владелец).

## Решения владельца проекта

| Дата       | Вопрос                       | Решение                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-28 | Какие методы покрывает SDK   | Только 13 публичных, как в `/docs`: `getAccount`; `createInvoice`, `listInvoices`, `getInvoice`, `listInvoiceEvents`, `cancelInvoice`; `getWebhookSettings`, `setWebhookUrl`, `removeWebhookUrl`, `sendTestWebhook`, `listDeliveries`, `getDelivery`, `redeliverDelivery`. Балансы, операции, депозиты, выплаты, сети и тариф — в кабинете |
| 2026-10-28 | Имя пакета и реестр          | `@qubiq/psp-sdk` на публичном npmjs.com; организацию npm `qubiq` создаёт владелец при публикации                                                                                                                                                                                                                                           |
| 2026-10-28 | Прогресс, типы, документация | Файл прогресса (этот), всё типизировано, документация по использованию на английском                                                                                                                                                                                                                                                       |

## Стадии

- [x] 0. Каркас: package.json (`exports`, `files`, `sideEffects`), tsconfig, tsup, eslint, prettier, vitest, `.yarnrc` + lockfile-lint, LICENSE (MIT), README-заглушка, этот план; `yarn ci` зелёный
- [x] 1. Подпись и query + тесты на все 12 векторов 13.5 (`src/signing.ts`, `src/query.ts`): строка подписи, `signRequest` с заголовками, сборщик query (список — через запятую, без `%2C`), TARGET = `url.pathname + url.search`
- [x] 2. Синхронизация спеки: `yarn api:sync` (копия `api/openapi.v1.json` и `src/generated/schema.d.ts`), `yarn api:check` — только локально, нужен соседний gateway; публичные типы `src/types.ts` вручную с JSDoc, их совпадение со схемами — `src/types.test-d.ts` (ответы, тела, ключи query); `src/routes.ts` — 13 операций с правилом повтора, тест покрытия `src/routes.test.ts` (13 в SDK + 14 исключённых = 27, `x-idempotency` нигде нет)
- [x] 3. HTTP-ядро (`src/config.ts`, `src/transport.ts`, `src/errors.ts`): опции и env `PSP_API_KEY`/`PSP_API_SECRET`/`PSP_API_URL`, проверка формата ключа и секрета и их сети, https кроме localhost; URL и тело собираются один раз, каждая попытка подписывается заново; `redirect: 'manual'`, таймаут 180 с; ошибки `PspApiError` (+ `is()` и `isPspApiError` с типами `details`), `PspAuthError` (обе строки подписи, расхождение часов, подсказка), `PspConnectionError` (`not_sent`/`unknown`), `PspTimeoutError`, `PspUnexpectedResponseError`; предупреждение `X-Api-Key-Deprecated`; хуки `onResponse`, `onRetry`, `onWarning`; `getResponseMeta()`. Тесты — локальный сервер `test/fake-gateway.ts` со своей проверкой подписи и nonce
- [x] 4. Повторы по 13.10 (`src/transport.ts`, `#retryDelay`), сделаны одним коммитом со стадией 3: `safe` — сбой связи, таймаут, `503 service_unavailable`/`address_pool_unavailable`/`net_unavailable`, `502`–`504` без тела API, `500` один раз, `429` и `503 maintenance` — по `Retry-After` не дольше `maxRetryAfterSeconds` (30 с), `401 timestamp_out_of_window` — один раз; `once` (redeliver) — один повтор; `never` (тест вебхука) — только если вызов точно не выполнился (`not_sent`, `503 service_unavailable` без `outcome`, `net_unavailable`); пауза 1/2/4/8 с ±20 %, `maxRetries` 4
- [x] 5. Ресурсы и клиент: `new PspClient(options)` (`src/client.ts`) — `psp.account.get()`; `psp.invoices` — `create`, `list`, `listAll`, `get`, `listEvents`, `listAllEvents`, `cancel`; `psp.webhook` — `get`, `setUrl`, `removeUrl`, `sendTest` и `psp.webhook.deliveries` — `list`, `listAll`, `get`, `redeliver`; `listAll*` — async-итератор по страницам (`src/pagination.ts`, 100 на страницу, повтор id на следующей странице пропускается); `psp.net`/`isLive` по ключу, секрет не виден в `JSON.stringify` и `inspect`. Публичный вход — `src/index.ts`. Тесты `src/client.test.ts`
- [x] 6. Вебхуки (`src/webhooks/`): `verifyWebhookSignature` (шаги 1–6 13.6: окно ±300 с, формат `v1=`, HMAC, сравнение за постоянное время, `secret` + `previousSecret`), `verifyWebhook` (ещё JSON, `id`/`type` = заголовки, `version` 1, `expectedMerchantId`, сеть ключа ↔ `chain`), `psp.webhook.verify()` с секретом и сетью клиента и `previousApiSecret` (env `PSP_API_PREVIOUS_SECRET`), `signWebhook` для тестов мерчанта; `WebhookVerificationError` с `reason` и `status` для ответа (401/400); типы событий — объединение по `type` (8 с платежом, 3 без, `webhook.test`), `WebhookPayment` отдельно от платежа API (нет `creditStatus`, есть `aml.flags`), `aml: null` → `{ status: null }`. Тесты: таблица 13.7 (9 строк), обе попытки `invoice.paid`, прежний секрет, `Headers` и любой регистр, поля `data.invoice`/`data.payment` против схем API; тела векторов — байт в байт в `test/vectors/`
- [x] 7. Пакет: tsup → `dist/index.js` (ESM) + `dist/index.cjs` + `.d.ts`/`.d.cts` (≈ 104 кБ в tarball, 10 файлов, в типах нет схем OpenAPI и русских описаний); `publint --strict` и `attw --pack` чистые (node10, node16 CJS/ESM, bundler); `yarn smoke` (`scripts/smoke.mjs`) — `npm pack`, установка tarball во временный проект, `test/smoke/consumer.{mjs,cjs}`: вектор подписи, вебхук, настоящий `fetch` к локальному серверу, `instanceof PspApiError` — пройден на Node 20.10, 22.20, 24.9 (Node 18 локально нет — проверит матрица CI); тесты публичного API `test/types/public-api.test-d.ts`. `yarn ci` включает `smoke`
- [x] 8. Документация пакета: `README.md` на английском — установка, быстрый старт, опции и env, testnet/mainnet по ключу, рецепты NestJS (провайдер `useFactory` + `rawBody: true`), Express (`express.raw`), Fastify (парсер `Buffer` в своей области), Next.js (`request.arrayBuffer()`), чистый Node.js; инвойсы (идемпотентность по `externalId`, списки и `listAll`, отмена, статусы), вебхуки (шаги проверки, коды отказа и ответы, события и что делать, правила обработчика, `signWebhook` для тестов), настройки и журнал доставок, ошибки (классы, коды 13.14 с `details`, разбор `401`, неизвестный исход), повторы, опции запроса и `getResponseMeta`, логирование, смена секрета, форматы данных, низкоуровневая подпись; `CHANGELOG.md`; `examples/` — `create-invoice.ts`, `express-webhook.ts`, `fastify-webhook.ts`, `nextjs-route.ts`, `nestjs/` (модуль, сервис, контроллер, `main.ts`), общий `handle-event.ts`. Примеры проверяет `yarn typecheck` (`tsc -p examples`, путь `@qubiq/psp-sdk` → `src`), для этого в devDependencies — express, fastify, @nestjs/common и core
- [ ] 9. CI: `ci.yml`, `release.yml`
- [ ] 10. Живая проверка на testnet (`yarn test:live`, ключ test-мерчанта от владельца)
- [ ] 11. Первая публикация 0.1.0 (шаги владельца по одному)
- [ ] 12. Документация вокруг: страница «SDK» в merchant-ui `/docs` (ru + en), DOCS, отчёт security-auditor

## Коммиты стадий

| Стадия | Коммит    |
| ------ | --------- |
| 0      | `d9ba072` |
| 1      | `81807e2` |
| 2      | `443713a` |
| 3–4    | `373fd7f` |
| 5      | `0db728c` |
| 6      | `dae2ae3` |
| 7      | `af976e2` |

## Найденные расхождения со спекой

| Стадия | Где                                           | Что в спеке                                                                                 | Что по факту                                                                                   | Решение                                                                                                    |
| ------ | --------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 2      | `openapi.public.json`, query `status`, `type` | 13.2 и 13.7: список значений — один параметр через запятую (`status=active,partially_paid`) | В OpenAPI у массивов нет `style`/`explode`: генераторы клиентов отправят `status=a&status=b`   | SDK собирает query сам (`src/query.ts`), через запятую, как в векторе 2                                    |
| 2      | `openapi.public.json`, описания полей         | Описания для мерчанта                                                                       | В описаниях внутренние пометки (`balance-service`, `networks.code`), у `asset` — «USDT or TRX» | Схемы в пакет не идут: публичные типы и JSDoc написаны вручную, совпадение проверяет `src/types.test-d.ts` |

## Как продолжить

Открыть первую стадию с `[ ]` или `[~]`, прочитать её источники, сделать, прогнать `yarn ci`, отметить стадию и записать коммит предыдущей стадии в таблицу.
