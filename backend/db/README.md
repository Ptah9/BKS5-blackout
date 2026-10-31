# backend/db

Хранилище состояния: **SQLite, один файл** `data/game.db` (не коммитится).

Модуль, а не отдельный сервис: к файлу ходит только процесс сервера.
Планируемые таблицы (M2):

```sql
players(id, login UNIQUE, pass_hash, salt, name, created_at)
sessions(token UNIQUE, player_id, expires_at)
state(player_id PRIMARY KEY, x, z, yaw, chunk, inventory_json, pulse, updated_at)
npc_memory(id, npc_id, player_id, role, text, created_at)
world_flags(key PRIMARY KEY, value)
```

`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;` — чтобы база переживала
не только падение процесса, но и выключение ноутбука.
