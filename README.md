# REPO PRINT · Panel del administrador

App de **INROPRIN / Roland Print** para configurar el registro fotográfico en campo: árbol de
carpetas de profundidad libre, técnicos con PIN y bitácora de subidas. Backend en **Supabase**.

## Estructura

```
index.html        · Shell de la app (login + panel)
css/styles.css    · Identidad Roland Print (Manrope, acento como token --accent)
js/config.js      · URL y anon key de Supabase (públicas, protegidas por RLS)
js/app.js         · Lógica: auth, árbol, técnicos, bitácora
assets/logo.svg   · Marca Roland Print
```

## Cómo correr

Es estático, sin build. Sirve la carpeta con cualquier servidor:

```bash
python3 -m http.server 8080
# luego abre http://localhost:8080
```

## Acceso admin

- **Usuario:** `m.torres@rolandprint.pe`
- **Contraseña temporal:** `RepoPrint2026!` — cámbiala desde el panel de Supabase Auth.

## Backend (Supabase)

Proyecto `kgchykdtkwksywkikwyu`. Modelo de datos:

| Tabla | Rol |
|---|---|
| `nodos` | Árbol de carpetas (adjacency list `parent_id`). Reglas de árbol forzadas por triggers. |
| `tecnicos` | Técnicos con PIN bcrypt (`pgcrypto`). |
| `lotes` | Sesiones de subida del técnico. |
| `subidas` | Bitácora de fotos/documentos. |
| `configuracion` | Color de acento, logo, raíz de Drive (singleton). |
| `v_bitacora` | Vista con breadcrumb (`A › B › C`) y nombre del técnico. |

### Reglas del árbol (en la base de datos)

- Un nodo es **contenedor** o **de subida**, nunca ambos.
- A un nodo de subida no se le pueden agregar hijos (trigger).
- No se puede marcar “de subida” un nodo que ya tiene hijos (trigger).
- Los nodos no se borran: se **archivan** (`estado = archivado`).

### Funciones RPC

- `crear_tecnico(nombre, pin)` / `restablecer_pin(id, pin)` — solo admin autenticado.
- `tecnicos_activos()`, `tecnico_login(id, pin)` — para la app del técnico.
- `iniciar_lote(...)`, `registrar_subida(...)` — registro en campo.
- `nodo_ruta(id)` — breadcrumb de un nodo.

## Pendiente / próximos pasos

- Integración real con **Google Drive** (crear carpeta por nodo y guardar `drive_url`) vía Edge Function.
- App móvil del técnico (login por PIN + captura con máscara).
