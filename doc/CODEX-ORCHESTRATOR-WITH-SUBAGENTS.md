# Codex Orchestrator + Sub-Agents (Qwen/OpenRouter/Search)

Статус: технический дизайн под текущую архитектуру Paperclip (V1)  
Дата: 2026-03-08

## 1) Как сейчас в проекте вызывается Codex

Ниже фактическая цепочка вызова по коду.

1. Адаптеры регистрируются в `server/src/adapters/registry.ts`.
   - Для Codex тип: `codex_local`.
   - Для него подключены: `execute`, `testEnvironment`, `sessionCodec`, `models/listModels`.

2. Сердце оркестрации: `server/src/services/heartbeat.ts`.
   - Heartbeat забирает агента, контекст, runtime session.
   - Вызывает `getServerAdapter(agent.adapterType)`.
   - Затем вызывает `adapter.execute(ctx)`.
   - Логи, события, usage, session params сохраняются в `heartbeat_runs` и related events.

3. Реальный запуск Codex происходит в `packages/adapters/codex-local/src/server/execute.ts`.
   - По умолчанию команда: `codex` (можно переопределить через `adapterConfig.command`).
   - Запуск: `codex exec --json ...`.
   - Поддержан resume-сессии через `sessionParams.sessionId`.
   - Пробрасываются env: `PAPERCLIP_*` (task id, wake reason, approval id и т.д.).
   - Перед запуском есть проверка доступности команды (`ensureCommandResolvable`) и `PATH`.
   - В `CODEX_HOME/skills` инжектятся paperclip skills.

4. Проверка окружения из UI кнопки “Test environment”:
   - endpoint: `POST /companies/:companyId/adapters/:type/test-environment`
   - код: `server/src/routes/agents.ts`
   - вызывается `adapter.testEnvironment(...)`.

## 2) Целевая система: Codex как “мозг”, другие ИИ как “сотрудники”

Идея: **не заменять** текущий heartbeat-контур, а расширить его адаптерами и правилами делегирования.

- `codex_local` = orchestrator/manager agent.
- `qwen_cli_local` = дешевый локальный worker (CLI).
- `openrouter_http` = дешевый/бесплатный remote worker через OpenRouter.
- `search_worker` = агент/инструмент для внешнего поиска (например Tavily-like API).

Codex получает задачу -> декомпозирует -> создает/назначает подзадачи worker-агентам -> собирает ответы -> финализирует решение.

## 3) Практичный план внедрения

### Phase A. Новые адаптеры

1. Добавить пакет `packages/adapters/qwen-local` (по шаблону `codex-local`/`opencode-local`).
   - Реализовать `src/index.ts`, `src/server/execute.ts`, `src/server/test.ts`, `src/server/session.ts`, UI/CLI части.
   - `execute`: запуск `qwen` CLI, парсинг stdout/jsonl, возврат `AdapterExecutionResult`.

2. Добавить пакет `packages/adapters/openrouter-http`.
   - HTTP-вызов OpenRouter Chat Completions (или Responses-совместимый режим).
   - Таймауты, retry/backoff, нормализация usage/cost.

3. Зарегистрировать оба адаптера:
   - `server/src/adapters/registry.ts`
   - `ui/src/adapters/registry.ts`
   - `cli/src/adapters/registry.ts`
   - обновить перечисления/лейблы в UI (где ограничены enabled adapter types).

### Phase B. Делегирование как бизнес-процесс (без “магии”)

1. Codex-оркестратор работает через Paperclip API:
   - создает issues-подзадачи,
   - назначает их на worker-агентов,
   - ставит dependency/приоритеты,
   - ждет комментарии/статусы.

2. Контракт результата от worker-агентов:
   - короткий summary,
   - артефакты/ссылки,
   - confidence + risk flags.

3. Правила маршрутизации задач:
   - cheap-first: сначала Qwen/OpenRouter free,
   - fallback на Codex только если задача сложная/критичная/неуспешный cheap run.

### Phase C. Автономность и контур управления

1. Включить heartbeat policy для manager/worker:
   - интервал, cooldown, maxConcurrentRuns.

2. Для Codex manager задать “dispatch policy” в `instructionsFilePath`:
   - когда делегировать,
   - когда эскалировать на себя,
   - когда запрашивать approval.

3. Ввести guardrails в prompt policy:
   - запрещать бесконечные циклы делегирования,
   - лимит числа подзадач на один root task,
   - обязательное закрытие цикла с итоговым комментарием.

## 4) Безопасность (что важно не сломать)

Обязательные требования (в стиле текущего AGENTS/SPEC):

1. Company scope везде.
   - Любой worker должен видеть/менять только сущности своей компании.

2. Секреты только через secret refs.
   - Не хранить `OPENROUTER_API_KEY`/search keys в открытом `adapterConfig`.
   - Использовать секрет-хранилище и strict mode (`PAPERCLIP_SECRETS_STRICT_MODE=true`).

3. Минимальные права worker-ов.
   - Для дешевых worker-агентов ограничить роль/инструкции.
   - Codex manager не должен раздавать им привилегии вне их зоны.

4. Audit trail на мутации.
   - Делегирование, изменение статусов, финальные решения должны логироваться в activity/events.

5. Approval gates на рискованные действия.
   - Внешние side effects (prod deploy, destructive ops, sensitive data) только через approval flow.

## 5) Минимальный MVP (быстро запустить)

1. Оставить `codex_local` как есть (manager).
2. Добавить только `qwen_local` как первый worker.
3. Делегирование реализовать через обычные issues + comments (без нового протокола).
4. Добавить `openrouter_http` вторым шагом.
5. Поисковый API подключить третьим шагом как отдельного worker-а или tool-агента.

## 6) Почему это оптимально для token-cost

- Codex тратится только на orchestration + сложные решения.
- Рутинные задачи уходят на free/cheap workers.
- Все остается в существующей control-plane модели Paperclip (heartbeat, issue lifecycle, approvals, audit).

## 7) Чеклист реализации по файлам

- Новые пакеты:
  - `packages/adapters/qwen-local/*`
  - `packages/adapters/openrouter-http/*`
- Регистрация:
  - `server/src/adapters/registry.ts`
  - `ui/src/adapters/registry.ts`
  - `cli/src/adapters/registry.ts`
- UI форма агента (типы/лейблы/дефолты):
  - `ui/src/components/AgentConfigForm.tsx`
  - `ui/src/components/NewAgentDialog.tsx`
  - `ui/src/components/AgentProperties.tsx`
  - `ui/src/pages/NewAgent.tsx`
- Валидация окружения:
  - `packages/adapters/*/src/server/test.ts`
- Документация адаптеров:
  - `packages/adapters/*/src/index.ts` (`agentConfigurationDoc`)

---

Если делать в следующем шаге кодом: начни с `qwen_local` (как process-like adapter), затем `openrouter_http`, и только потом добавляй более сложную multi-agent policy automation.
